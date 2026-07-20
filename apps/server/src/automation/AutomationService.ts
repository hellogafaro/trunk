import {
  type Automation,
  type AutomationCreateInput,
  AutomationId,
  AutomationOperationError,
  type AutomationRun,
  AutomationRunId,
  type AutomationRunNowInput,
  type AutomationSetStatusInput,
  type AutomationSnapshot,
  type AutomationUpdateInput,
  CommandId,
  DEFAULT_PROVIDER_INTERACTION_MODE,
  MessageId,
  ThreadId,
} from "@t3tools/contracts";
import * as Clock from "effect/Clock";
import * as Cause from "effect/Cause";
import * as Context from "effect/Context";
import * as Crypto from "effect/Crypto";
import * as DateTime from "effect/DateTime";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Queue from "effect/Queue";
import * as Semaphore from "effect/Semaphore";
import * as Stream from "effect/Stream";
import * as SubscriptionRef from "effect/SubscriptionRef";

import { OrchestrationEngineService } from "../orchestration/Services/OrchestrationEngine.ts";
import { ProjectionSnapshotQuery } from "../orchestration/Services/ProjectionSnapshotQuery.ts";
import { AutomationRepository } from "../persistence/Services/Automations.ts";
import { calculateNextRunAt, validateFutureSchedule } from "./schedule.ts";

const SNAPSHOT_RUN_LIMIT = 250;
const ACTIVE_POLL_INTERVAL = Duration.millis(500);
const IDLE_POLL_INTERVAL = Duration.seconds(30);
const SCHEDULER_LEASE_DURATION = Duration.minutes(2);

export interface AutomationServiceShape {
  readonly snapshots: Stream.Stream<AutomationSnapshot>;
  readonly getSnapshot: Effect.Effect<AutomationSnapshot, AutomationOperationError>;
  readonly create: (
    input: AutomationCreateInput,
  ) => Effect.Effect<Automation, AutomationOperationError>;
  readonly update: (
    input: AutomationUpdateInput,
  ) => Effect.Effect<Automation, AutomationOperationError>;
  readonly setStatus: (
    input: AutomationSetStatusInput,
  ) => Effect.Effect<Automation, AutomationOperationError>;
  readonly runNow: (
    input: AutomationRunNowInput,
  ) => Effect.Effect<AutomationRun, AutomationOperationError>;
  readonly delete: (automationId: AutomationId) => Effect.Effect<void, AutomationOperationError>;
}

export class AutomationService extends Context.Service<AutomationService, AutomationServiceShape>()(
  "t3/automation/AutomationService",
) {}

function operationError(message: string, cause?: unknown): AutomationOperationError {
  return new AutomationOperationError({ message, ...(cause === undefined ? {} : { cause }) });
}

function failureMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

function preserveOperationError(message: string) {
  return (cause: unknown) =>
    typeof cause === "object" &&
    cause !== null &&
    "_tag" in cause &&
    cause._tag === "AutomationOperationError"
      ? (cause as AutomationOperationError)
      : operationError(message, cause);
}

function isThreadBusy(thread: {
  readonly session: { readonly status: string; readonly activeTurnId: unknown } | null;
  readonly latestTurn: { readonly state: string; readonly completedAt: string | null } | null;
  readonly hasPendingApprovals: boolean;
  readonly hasPendingUserInput: boolean;
}): boolean {
  return (
    (thread.session?.status === "running" && thread.session.activeTurnId !== null) ||
    thread.latestTurn?.state === "pending" ||
    thread.latestTurn?.state === "running" ||
    thread.latestTurn?.completedAt === null ||
    thread.hasPendingApprovals ||
    thread.hasPendingUserInput
  );
}

export const make = Effect.gen(function* () {
  const repository = yield* AutomationRepository;
  const orchestration = yield* OrchestrationEngineService;
  const snapshots = yield* ProjectionSnapshotQuery;
  const crypto = yield* Crypto.Crypto;
  const mutex = yield* Semaphore.make(1);
  const wakeups = yield* Queue.dropping<void>(1);

  const nowIso = Effect.map(DateTime.now, DateTime.formatIso);
  const uuid = crypto.randomUUIDv4.pipe(
    Effect.mapError((cause) =>
      operationError("Failed to generate an automation identifier.", cause),
    ),
  );
  const schedulerOwnerId = `automation-scheduler:${yield* uuid}`;

  const loadSnapshot = Effect.fn("AutomationService.loadSnapshot")(function* () {
    const [automationRows, runs] = yield* Effect.all([
      repository.list(),
      repository.listRuns(SNAPSHOT_RUN_LIMIT),
    ]);
    const automations = automationRows.filter((automation) => automation.deletedAt === null);
    const automationIds = new Set(automations.map((automation) => automation.id));
    return {
      automations: automations.map(({ deletedAt: _deletedAt, ...automation }) => automation),
      runs: runs.filter((run) => automationIds.has(run.automationId)),
      updatedAt: yield* nowIso,
    } satisfies AutomationSnapshot;
  });

  const initialSnapshot = yield* loadSnapshot();
  const snapshotRef = yield* SubscriptionRef.make(initialSnapshot);

  const publishSnapshot = Effect.fn("AutomationService.publishSnapshot")(function* () {
    yield* SubscriptionRef.set(snapshotRef, yield* loadSnapshot());
  });

  const wake = Queue.offer(wakeups, undefined).pipe(Effect.asVoid);

  const requireAutomation = Effect.fn("AutomationService.requireAutomation")(function* (
    automationId: AutomationId,
  ) {
    const option = yield* repository.getById(automationId);
    if (Option.isNone(option) || option.value.deletedAt !== null) {
      return yield* operationError(`Automation '${automationId}' was not found.`);
    }
    return option.value;
  });

  const validateDefinition = Effect.fn("AutomationService.validateDefinition")(function* (
    input: AutomationCreateInput | AutomationUpdateInput,
    nowEpochMillis: number,
  ) {
    if (input.runtimeMode === "full-access" && !input.fullAccessAcknowledged) {
      return yield* operationError(
        "Full access must be explicitly acknowledged because the routine can run commands without approval.",
      );
    }
    const nextRunAt = yield* Effect.fromResult(
      validateFutureSchedule(input.schedule, nowEpochMillis),
    ).pipe(Effect.mapError((cause) => operationError(cause.message, cause)));
    const readModel = yield* snapshots
      .getCommandReadModel()
      .pipe(
        Effect.mapError((cause) =>
          operationError("Failed to validate the automation project.", cause),
        ),
      );
    const project = readModel.projects.find(
      (candidate) => candidate.id === input.projectId && candidate.deletedAt === null,
    );
    if (!project) {
      return yield* operationError(`Project '${input.projectId}' was not found.`);
    }
    if (input.target.type !== "existing-thread" && input.modelSelection === null) {
      return yield* operationError("A provider and model are required for a new automation chat.");
    }
    const target = input.target;
    if (target.type === "existing-thread") {
      const thread = readModel.threads.find((candidate) => candidate.id === target.threadId);
      if (!thread || thread.deletedAt !== null) {
        return yield* operationError(`Thread '${target.threadId}' was not found.`);
      }
      if (thread.projectId !== input.projectId) {
        return yield* operationError("The selected chat belongs to a different project.");
      }
    }
    return nextRunAt;
  });

  const enqueueRun = Effect.fn("AutomationService.enqueueRun")(function* (input: {
    readonly automation: Automation;
    readonly trigger: "scheduled" | "manual";
    readonly scheduledFor: string;
    readonly updatedAutomation?: Automation;
  }) {
    const createdAt = yield* nowIso;
    const run = {
      id: AutomationRunId.make(`automation-run:${yield* uuid}`),
      automationId: input.automation.id,
      trigger: input.trigger,
      status: "queued",
      scheduledFor: input.scheduledFor,
      latestScheduledFor: input.scheduledFor,
      coalescedCount: 0,
      threadId: null,
      messageId: null,
      error: null,
      createdAt,
      startedAt: null,
      finishedAt: null,
    } satisfies AutomationRun;
    return yield* repository.enqueueRun({
      run,
      automation:
        input.updatedAutomation === undefined
          ? null
          : { ...input.updatedAutomation, deletedAt: null },
    });
  });

  const stopForDeletedTarget = Effect.fn("AutomationService.stopForDeletedTarget")(function* (
    automation: Automation,
    run: AutomationRun,
    now: string,
  ) {
    yield* repository.upsert({
      ...automation,
      status: "stopped",
      stopReason: "target-deleted",
      nextRunAt: null,
      updatedAt: now,
      deletedAt: null,
    });
    yield* repository.upsertRun({
      ...run,
      status: "cancelled",
      error: "Target chat was deleted.",
      finishedAt: now,
    });
  });

  const dispatchQueuedRun = Effect.fn("AutomationService.dispatchQueuedRun")(function* (
    automation: Automation,
    run: AutomationRun,
  ) {
    const readModel = yield* snapshots.getCommandReadModel();
    const project = readModel.projects.find(
      (candidate) => candidate.id === automation.projectId && candidate.deletedAt === null,
    );
    const now = yield* nowIso;
    if (!project) {
      yield* repository.upsertRun({
        ...run,
        status: "failed",
        error: "Automation project was deleted.",
        finishedAt: now,
      });
      return;
    }

    const targetThreadId =
      automation.target.type === "fresh-thread"
        ? ThreadId.make(`automation-thread:${yield* uuid}`)
        : automation.target.threadId;
    const existingThread = readModel.threads.find((thread) => thread.id === targetThreadId) ?? null;
    if (existingThread?.deletedAt !== null && existingThread !== null) {
      yield* stopForDeletedTarget(automation, run, now);
      return;
    }
    if (automation.target.type === "existing-thread" && existingThread === null) {
      yield* stopForDeletedTarget(automation, run, now);
      return;
    }

    if (existingThread !== null && existingThread.archivedAt === null) {
      const shell = yield* snapshots.getThreadShellById(targetThreadId);
      if (Option.isSome(shell) && isThreadBusy(shell.value)) {
        return;
      }
    }

    if (existingThread?.archivedAt !== null && existingThread !== null) {
      yield* orchestration.dispatch({
        type: "thread.unarchive",
        commandId: CommandId.make(`automation:${run.id}:unarchive`),
        threadId: targetThreadId,
      });
    }

    if (existingThread !== null && existingThread.runtimeMode !== automation.runtimeMode) {
      yield* orchestration.dispatch({
        type: "thread.runtime-mode.set",
        commandId: CommandId.make(`automation:${run.id}:runtime-mode`),
        threadId: targetThreadId,
        runtimeMode: automation.runtimeMode,
        createdAt: now,
      });
    }
    if (
      existingThread !== null &&
      existingThread.interactionMode !== DEFAULT_PROVIDER_INTERACTION_MODE
    ) {
      yield* orchestration.dispatch({
        type: "thread.interaction-mode.set",
        commandId: CommandId.make(`automation:${run.id}:interaction-mode`),
        threadId: targetThreadId,
        interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
        createdAt: now,
      });
    }

    const messageId = MessageId.make(`automation-message:${yield* uuid}`);
    const modelSelection =
      existingThread === null ? automation.modelSelection : existingThread.modelSelection;
    if (modelSelection === null) {
      yield* repository.upsertRun({
        ...run,
        status: "failed",
        error: "No model is configured for this automation.",
        finishedAt: now,
      });
      return;
    }

    let createdThread = false;
    if (existingThread === null) {
      yield* orchestration.dispatch({
        type: "thread.create",
        commandId: CommandId.make(`automation:${run.id}:thread-create`),
        threadId: targetThreadId,
        projectId: automation.projectId,
        title: automation.title,
        modelSelection,
        runtimeMode: automation.runtimeMode,
        interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
        branch: null,
        worktreePath: null,
        createdAt: now,
      });
      createdThread = true;
    }

    yield* orchestration
      .dispatch({
        type: "thread.turn.start",
        commandId: CommandId.make(`automation:${run.id}:turn-start`),
        threadId: targetThreadId,
        message: {
          messageId,
          role: "user",
          text: automation.prompt,
          attachments: [],
        },
        ...(existingThread === null ? { modelSelection } : {}),
        titleSeed: automation.title,
        runtimeMode: automation.runtimeMode,
        interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
        createdAt: now,
      })
      .pipe(
        Effect.catchCause((cause) =>
          Effect.gen(function* () {
            if (createdThread) {
              yield* orchestration
                .dispatch({
                  type: "thread.delete",
                  commandId: CommandId.make(`automation:${run.id}:thread-cleanup`),
                  threadId: targetThreadId,
                })
                .pipe(Effect.ignoreCause({ log: true }));
            }
            return yield* Effect.failCause(cause);
          }),
        ),
      );

    yield* repository.upsertRun({
      ...run,
      status: "running",
      threadId: targetThreadId,
      messageId,
      startedAt: now,
    });
  });

  const settleRunningRun = Effect.fn("AutomationService.settleRunningRun")(function* (
    automation: Automation,
    run: AutomationRun,
  ) {
    if (run.threadId === null || run.messageId === null) {
      return;
    }
    const turnState = yield* repository.getTurnState({
      threadId: run.threadId,
      messageId: run.messageId,
    });
    if (Option.isNone(turnState)) {
      return;
    }
    if (turnState.value.state === "pending" || turnState.value.state === "running") {
      return;
    }
    const finishedAt = turnState.value.completedAt ?? (yield* nowIso);
    const succeeded = turnState.value.state === "completed";
    yield* repository.upsertRun({
      ...run,
      status: succeeded ? "succeeded" : "failed",
      error: succeeded ? null : `Automation turn ended with ${turnState.value.state}.`,
      finishedAt,
    });
    if (automation.schedule.type === "once") {
      yield* repository.upsert({
        ...automation,
        status: "stopped",
        stopReason: "once-completed",
        nextRunAt: null,
        updatedAt: finishedAt,
        deletedAt: null,
      });
    }
  });

  const schedulerPass = Effect.fn("AutomationService.schedulerPass")(function* () {
    const nowEpochMillis = yield* Clock.currentTimeMillis;
    const nowString = DateTime.formatIso(DateTime.makeUnsafe(nowEpochMillis));
    const leaseExpiresAt = DateTime.formatIso(
      DateTime.makeUnsafe(nowEpochMillis + Duration.toMillis(SCHEDULER_LEASE_DURATION)),
    );
    if (
      !(yield* repository.acquireSchedulerLease({
        ownerId: schedulerOwnerId,
        now: nowString,
        expiresAt: leaseExpiresAt,
      }))
    ) {
      return;
    }
    const rows = yield* repository.list();
    const automations = rows.filter((row) => row.deletedAt === null);
    const automationById = new Map(automations.map((automation) => [automation.id, automation]));

    for (const automation of automations) {
      if (
        automation.status !== "active" ||
        automation.nextRunAt === null ||
        Date.parse(automation.nextRunAt) > nowEpochMillis
      ) {
        continue;
      }
      const scheduledFor = automation.nextRunAt;
      const nextRunAt =
        automation.schedule.type === "once"
          ? null
          : yield* Effect.fromResult(calculateNextRunAt(automation.schedule, nowEpochMillis));
      const updated = {
        ...automation,
        status: automation.schedule.type === "once" ? ("stopped" as const) : automation.status,
        stopReason:
          automation.schedule.type === "once" ? ("once-completed" as const) : automation.stopReason,
        nextRunAt,
        updatedAt: nowString,
        deletedAt: null,
      };
      automationById.set(updated.id, updated);
      yield* enqueueRun({
        automation,
        trigger: "scheduled",
        scheduledFor,
        updatedAutomation: updated,
      });
    }

    const runs = yield* repository.listActionableRuns();
    for (const run of runs.filter((candidate) => candidate.status === "running")) {
      const automation = automationById.get(run.automationId);
      if (automation) {
        yield* settleRunningRun(automation, run);
      }
    }

    const refreshedRuns = yield* repository.listActionableRuns();
    const runningAutomationIds = new Set(
      refreshedRuns.filter((run) => run.status === "running").map((run) => run.automationId),
    );
    for (const run of refreshedRuns.filter((candidate) => candidate.status === "queued")) {
      if (runningAutomationIds.has(run.automationId)) {
        continue;
      }
      const automation = automationById.get(run.automationId);
      if (automation) {
        yield* dispatchQueuedRun(automation, run).pipe(
          Effect.catchCause((cause) =>
            Effect.gen(function* () {
              const finishedAt = yield* nowIso;
              const error = Cause.squash(cause);
              yield* repository.upsertRun({
                ...run,
                status: "failed",
                error: failureMessage(error),
                finishedAt,
              });
              if (automation.schedule.type === "once" && automation.status !== "stopped") {
                yield* repository.upsert({
                  ...automation,
                  status: "stopped",
                  stopReason: "once-completed",
                  nextRunAt: null,
                  updatedAt: finishedAt,
                  deletedAt: null,
                });
              }
              yield* Effect.logError("automation run dispatch failed", {
                automationId: automation.id,
                runId: run.id,
                cause,
              });
            }),
          ),
        );
      }
    }
    yield* publishSnapshot();
  });

  const runLocked = mutex.withPermits(1)(
    schedulerPass().pipe(
      Effect.catch((cause) => Effect.logError("automation scheduler pass failed", { cause })),
    ),
  );

  const schedulerLoop = Effect.forever(
    Effect.gen(function* () {
      yield* runLocked;
      const snapshot = yield* SubscriptionRef.get(snapshotRef);
      const hasActiveWork = snapshot.runs.some(
        (run) => run.status === "queued" || run.status === "running",
      );
      const sleep = Effect.sleep(hasActiveWork ? ACTIVE_POLL_INTERVAL : IDLE_POLL_INTERVAL);
      yield* Effect.raceFirst(sleep, Queue.take(wakeups));
    }),
  );

  const create: AutomationServiceShape["create"] = Effect.fn("AutomationService.create")(
    function* (input) {
      return yield* mutex
        .withPermits(1)(
          Effect.gen(function* () {
            const existing = yield* repository.getById(input.automationId);
            if (Option.isSome(existing)) {
              return yield* operationError(`Automation '${input.automationId}' already exists.`);
            }
            const nowEpochMillis = yield* Clock.currentTimeMillis;
            const now = DateTime.formatIso(DateTime.makeUnsafe(nowEpochMillis));
            const nextRunAt = yield* validateDefinition(input, nowEpochMillis);
            const automation = {
              id: input.automationId,
              title: input.title,
              prompt: input.prompt,
              projectId: input.projectId,
              modelSelection: input.modelSelection,
              runtimeMode: input.runtimeMode,
              schedule: input.schedule,
              target: input.target,
              status: "active",
              stopReason: null,
              nextRunAt,
              createdAt: now,
              updatedAt: now,
            } satisfies Automation;
            yield* repository.upsert({ ...automation, deletedAt: null });
            yield* publishSnapshot();
            yield* wake;
            return automation;
          }),
        )
        .pipe(Effect.mapError(preserveOperationError("Failed to create automation.")));
    },
  );

  const update: AutomationServiceShape["update"] = Effect.fn("AutomationService.update")(
    function* (input) {
      return yield* mutex
        .withPermits(1)(
          Effect.gen(function* () {
            const existing = yield* requireAutomation(input.automationId);
            if (input.runtimeMode === "full-access" && !input.fullAccessAcknowledged) {
              return yield* operationError(
                "Full access must be explicitly acknowledged because the routine can run commands without approval.",
              );
            }
            const nowEpochMillis = yield* Clock.currentTimeMillis;
            const now = DateTime.formatIso(DateTime.makeUnsafe(nowEpochMillis));
            const nextRunAt =
              existing.status === "active"
                ? yield* validateDefinition(input, nowEpochMillis)
                : existing.nextRunAt;
            const automation = {
              ...existing,
              title: input.title,
              prompt: input.prompt,
              projectId: input.projectId,
              modelSelection: input.modelSelection,
              runtimeMode: input.runtimeMode,
              schedule: input.schedule,
              target: input.target,
              nextRunAt,
              updatedAt: now,
              deletedAt: null,
            };
            yield* repository.upsert(automation);
            yield* publishSnapshot();
            yield* wake;
            const { deletedAt: _deletedAt, ...result } = automation;
            return result;
          }),
        )
        .pipe(Effect.mapError(preserveOperationError("Failed to update automation.")));
    },
  );

  const setStatus: AutomationServiceShape["setStatus"] = Effect.fn("AutomationService.setStatus")(
    function* (input) {
      return yield* mutex
        .withPermits(1)(
          Effect.gen(function* () {
            const existing = yield* requireAutomation(input.automationId);
            const nowEpochMillis = yield* Clock.currentTimeMillis;
            const now = DateTime.formatIso(DateTime.makeUnsafe(nowEpochMillis));
            const nextRunAt =
              input.status === "active"
                ? yield* validateDefinition(
                    {
                      automationId: existing.id,
                      title: existing.title,
                      prompt: existing.prompt,
                      projectId: existing.projectId,
                      modelSelection: existing.modelSelection,
                      runtimeMode: existing.runtimeMode,
                      fullAccessAcknowledged: existing.runtimeMode === "full-access",
                      schedule: existing.schedule,
                      target: existing.target,
                    },
                    nowEpochMillis,
                  )
                : null;
            const automation = {
              ...existing,
              status: input.status,
              stopReason: input.status === "stopped" ? ("manual" as const) : null,
              nextRunAt,
              updatedAt: now,
              deletedAt: null,
            };
            if (input.status === "stopped") {
              yield* repository.stopAndCancelQueued({
                automation,
                finishedAt: now,
                error: "Automation paused before this run started.",
              });
            } else {
              yield* repository.upsert(automation);
            }
            yield* publishSnapshot();
            yield* wake;
            const { deletedAt: _deletedAt, ...result } = automation;
            return result;
          }),
        )
        .pipe(Effect.mapError(preserveOperationError("Failed to change automation status.")));
    },
  );

  const runNow: AutomationServiceShape["runNow"] = Effect.fn("AutomationService.runNow")(
    function* (input) {
      return yield* mutex
        .withPermits(1)(
          Effect.gen(function* () {
            const automation = yield* requireAutomation(input.automationId);
            if (automation.stopReason === "target-deleted") {
              return yield* operationError(
                "Choose another target chat before running this automation.",
              );
            }
            const scheduledFor = yield* nowIso;
            const { deletedAt: _deletedAt, ...definition } = automation;
            const run = yield* enqueueRun({
              automation: definition,
              trigger: "manual",
              scheduledFor,
            });
            yield* publishSnapshot();
            yield* wake;
            return run;
          }),
        )
        .pipe(Effect.mapError(preserveOperationError("Failed to queue automation run.")));
    },
  );

  const deleteAutomation: AutomationServiceShape["delete"] = Effect.fn("AutomationService.delete")(
    function* (automationId) {
      return yield* mutex
        .withPermits(1)(
          Effect.gen(function* () {
            yield* requireAutomation(automationId);
            const deletedAt = yield* nowIso;
            const actionable = (yield* repository.listRunsByAutomation(automationId, 100)).filter(
              (run) => run.status === "running" && run.threadId !== null,
            );
            for (const run of actionable) {
              yield* orchestration
                .dispatch({
                  type: "thread.turn.interrupt",
                  commandId: CommandId.make(`automation:${run.id}:delete-interrupt`),
                  threadId: run.threadId!,
                  createdAt: deletedAt,
                })
                .pipe(Effect.ignoreCause({ log: true }));
            }
            yield* repository.deleteAndCancelActionable({ automationId, deletedAt });
            yield* publishSnapshot();
            yield* wake;
          }),
        )
        .pipe(Effect.mapError(preserveOperationError("Failed to delete automation.")));
    },
  );

  const recoverInterruptedRuns = Effect.fn("AutomationService.recoverInterruptedRuns")(
    function* () {
      const recoveredAt = yield* nowIso;
      const automationRows = yield* repository.list();
      const automationById = new Map(
        automationRows.map((automation) => [automation.id, automation]),
      );
      for (const run of yield* repository.listActionableRuns()) {
        if (run.status === "running") {
          const automation = automationById.get(run.automationId);
          if (automation === undefined || run.threadId === null || run.messageId === null) {
            yield* repository.upsertRun({
              ...run,
              status: "failed",
              error: "The interrupted automation run could not be reconciled.",
              finishedAt: recoveredAt,
            });
            continue;
          }
          const turnState = yield* repository.getTurnState({
            threadId: run.threadId,
            messageId: run.messageId,
          });
          if (Option.isSome(turnState)) {
            yield* settleRunningRun(automation, run);
          } else {
            yield* repository.upsertRun({
              ...run,
              status: "failed",
              error: "The server restarted before the automation turn was recorded.",
              finishedAt: recoveredAt,
            });
          }
        }
      }
      yield* publishSnapshot();
    },
  );

  yield* mutex.withPermits(1)(recoverInterruptedRuns());
  yield* Effect.forkScoped(schedulerLoop);
  yield* orchestration.streamDomainEvents.pipe(
    Stream.runForEach(() => wake),
    Effect.forkScoped,
  );

  return AutomationService.of({
    snapshots: SubscriptionRef.changes(snapshotRef),
    getSnapshot: SubscriptionRef.get(snapshotRef).pipe(
      Effect.mapError(preserveOperationError("Failed to read automations.")),
    ),
    create,
    update,
    setStatus,
    runNow,
    delete: deleteAutomation,
  });
});

export const layer = Layer.effect(AutomationService, make);
