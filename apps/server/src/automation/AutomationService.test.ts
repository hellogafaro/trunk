import * as NodeServices from "@effect/platform-node/NodeServices";
import {
  AutomationId,
  DEFAULT_PROVIDER_INTERACTION_MODE,
  type OrchestrationCommand,
  type OrchestrationReadModel,
  type OrchestrationThreadShell,
  ProjectId,
  ProviderInstanceId,
  ThreadId,
} from "@t3tools/contracts";
import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Ref from "effect/Ref";
import * as Stream from "effect/Stream";

import { OrchestrationEngineService } from "../orchestration/Services/OrchestrationEngine.ts";
import { ProjectionSnapshotQuery } from "../orchestration/Services/ProjectionSnapshotQuery.ts";
import { AutomationRepositoryLive } from "../persistence/Layers/Automations.ts";
import { SqlitePersistenceMemory } from "../persistence/Layers/Sqlite.ts";
import { AutomationRepository } from "../persistence/Services/Automations.ts";
import { AutomationService, layer as AutomationServiceLive } from "./AutomationService.ts";

const projectId = ProjectId.make("project:automations");
const threadId = ThreadId.make("thread:automations");
const modelSelection = {
  instanceId: ProviderInstanceId.make("codex"),
  model: "gpt-5.4",
} as const;
const now = "2026-07-18T12:00:00.000Z";

function thread(overrides: Partial<OrchestrationReadModel["threads"][number]> = {}) {
  return {
    id: threadId,
    projectId,
    title: "Automation target",
    modelSelection,
    interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
    runtimeMode: "full-access" as const,
    branch: null,
    worktreePath: null,
    createdAt: now,
    updatedAt: now,
    archivedAt: null,
    latestTurn: null,
    messages: [],
    session: null,
    activities: [],
    proposedPlans: [],
    checkpoints: [],
    deletedAt: null,
    ...overrides,
  } satisfies OrchestrationReadModel["threads"][number];
}

function readModel(
  targetThread: OrchestrationReadModel["threads"][number],
): OrchestrationReadModel {
  return {
    snapshotSequence: 1,
    updatedAt: now,
    projects: [
      {
        id: projectId,
        title: "Automation project",
        workspaceRoot: "/tmp/automations",
        defaultModelSelection: modelSelection,
        scripts: [],
        createdAt: now,
        updatedAt: now,
        deletedAt: null,
      },
    ],
    threads: [targetThread],
  };
}

function shell(
  source: OrchestrationReadModel["threads"][number],
  overrides: Partial<OrchestrationThreadShell> = {},
): OrchestrationThreadShell {
  return {
    id: source.id,
    projectId: source.projectId,
    title: source.title,
    modelSelection: source.modelSelection,
    runtimeMode: source.runtimeMode,
    interactionMode: source.interactionMode,
    branch: source.branch,
    worktreePath: source.worktreePath,
    latestTurn: source.latestTurn,
    createdAt: source.createdAt,
    updatedAt: source.updatedAt,
    archivedAt: source.archivedAt,
    session: source.session,
    latestUserMessageAt: null,
    hasPendingApprovals: false,
    hasPendingUserInput: false,
    hasActionableProposedPlan: false,
    ...overrides,
  };
}

function withAutomationRuntime<A, E, R>(
  targetThread: OrchestrationReadModel["threads"][number],
  commands: Ref.Ref<ReadonlyArray<OrchestrationCommand>>,
  effect: Effect.Effect<A, E, AutomationService | AutomationRepository | R>,
) {
  const model = readModel(targetThread);
  const snapshotService = ProjectionSnapshotQuery.of({
    getCommandReadModel: () => Effect.succeed(model),
    getSnapshot: () => Effect.succeed(model),
    getShellSnapshot: () => Effect.die("unused"),
    getArchivedShellSnapshot: () => Effect.die("unused"),
    getSnapshotSequence: () => Effect.succeed({ snapshotSequence: model.snapshotSequence }),
    getCounts: () => Effect.succeed({ projectCount: 1, threadCount: 1 }),
    getActiveProjectByWorkspaceRoot: () => Effect.succeed(Option.none()),
    getProjectShellById: () => Effect.succeed(Option.none()),
    getFirstActiveThreadIdByProjectId: () => Effect.succeed(Option.none()),
    getThreadCheckpointContext: () => Effect.succeed(Option.none()),
    getFullThreadDiffContext: () => Effect.succeed(Option.none()),
    getThreadShellById: (id) =>
      Effect.succeed(id === targetThread.id ? Option.some(shell(targetThread)) : Option.none()),
    getThreadDetailById: () => Effect.succeed(Option.none()),
  });
  const engine = OrchestrationEngineService.of({
    readEvents: () => Stream.empty,
    dispatch: (command) =>
      Ref.update(commands, (existing) => [...existing, command]).pipe(Effect.as({ sequence: 1 })),
    streamDomainEvents: Stream.empty,
  });
  const persistence = AutomationRepositoryLive.pipe(Layer.provideMerge(SqlitePersistenceMemory));
  const dependencies = Layer.mergeAll(
    persistence,
    Layer.succeed(ProjectionSnapshotQuery, snapshotService),
    Layer.succeed(OrchestrationEngineService, engine),
    NodeServices.layer,
  );
  return effect.pipe(
    Effect.provide(
      Layer.mergeAll(dependencies, AutomationServiceLive.pipe(Layer.provide(dependencies))),
    ),
  );
}

it.effect("coalesces repeated due/manual ticks while an existing target chat is busy", () =>
  Effect.gen(function* () {
    const commands = yield* Ref.make<ReadonlyArray<OrchestrationCommand>>([]);
    const busyThread = thread({
      latestTurn: {
        turnId: "turn:busy" as NonNullable<
          OrchestrationReadModel["threads"][number]["latestTurn"]
        >["turnId"],
        state: "running",
        requestedAt: now,
        startedAt: now,
        completedAt: null,
        assistantMessageId: null,
      },
    });
    yield* withAutomationRuntime(
      busyThread,
      commands,
      Effect.gen(function* () {
        const service = yield* AutomationService;
        const repository = yield* AutomationRepository;
        const automationId = AutomationId.make("automation:coalescing");
        yield* service.create({
          automationId,
          title: "Busy target",
          prompt: "Continue the task.",
          projectId,
          modelSelection: null,
          schedule: { type: "cron", expression: "0 9 * * *", timeZone: "UTC" },
          target: { type: "existing-thread", threadId },
        });
        yield* service.runNow({ automationId });
        yield* service.runNow({ automationId });
        for (let index = 0; index < 10; index += 1) yield* Effect.yieldNow;

        const runs = yield* repository.listRunsByAutomation(automationId, 10);
        assert.equal(runs.length, 1);
        assert.equal(runs[0]?.status, "queued");
        assert.equal(runs[0]?.coalescedCount, 1);
        assert.deepEqual(yield* Ref.get(commands), []);
      }),
    );
  }),
);

it.effect(
  "unarchives a target and restores its configured/default modes before starting its turn",
  () =>
    Effect.gen(function* () {
      const commands = yield* Ref.make<ReadonlyArray<OrchestrationCommand>>([]);
      const archivedThread = thread({
        archivedAt: "2026-07-18T11:00:00.000Z",
        runtimeMode: "approval-required",
        interactionMode: "plan",
      });
      yield* withAutomationRuntime(
        archivedThread,
        commands,
        Effect.gen(function* () {
          const service = yield* AutomationService;
          const automationId = AutomationId.make("automation:archived-target");
          yield* service.create({
            automationId,
            title: "Archived target",
            prompt: "Resume the task.",
            projectId,
            modelSelection: null,
            schedule: { type: "cron", expression: "0 9 * * *", timeZone: "UTC" },
            target: { type: "existing-thread", threadId },
          });
          yield* service.runNow({ automationId });
          for (let index = 0; index < 10; index += 1) yield* Effect.yieldNow;

          assert.deepEqual(
            (yield* Ref.get(commands)).map((command) => command.type),
            [
              "thread.unarchive",
              "thread.runtime-mode.set",
              "thread.interaction-mode.set",
              "thread.turn.start",
            ],
          );
        }),
      );
    }),
);

it.effect("revalidates a disabled automation before enabling it", () =>
  Effect.gen(function* () {
    const commands = yield* Ref.make<ReadonlyArray<OrchestrationCommand>>([]);
    yield* withAutomationRuntime(
      thread(),
      commands,
      Effect.gen(function* () {
        const service = yield* AutomationService;
        const automationId = AutomationId.make("automation:enable-validation");
        yield* service.create({
          automationId,
          title: "Enable validation",
          prompt: "Run the task.",
          projectId,
          modelSelection,
          schedule: { type: "cron", expression: "0 9 * * *", timeZone: "UTC" },
          target: { type: "fresh-thread" },
        });
        yield* service.setStatus({ automationId, status: "disabled" });
        yield* service.update({
          automationId,
          title: "Enable validation",
          prompt: "Run the task.",
          projectId,
          modelSelection: null,
          schedule: { type: "cron", expression: "0 9 * * *", timeZone: "UTC" },
          target: { type: "fresh-thread" },
        });

        const result = yield* Effect.exit(service.setStatus({ automationId, status: "enabled" }));
        assert.equal(result._tag, "Failure");
      }),
    );
  }),
);

it.effect("creates a persistent automation chat before starting its first turn", () =>
  Effect.gen(function* () {
    const commands = yield* Ref.make<ReadonlyArray<OrchestrationCommand>>([]);
    const targetThreadId = ThreadId.make("thread:new-persistent-automation");
    yield* withAutomationRuntime(
      thread(),
      commands,
      Effect.gen(function* () {
        const service = yield* AutomationService;
        const automationId = AutomationId.make("automation:new-persistent-chat");
        yield* service.create({
          automationId,
          title: "Persistent target",
          prompt: "Start the task.",
          projectId,
          modelSelection,
          schedule: { type: "cron", expression: "0 9 * * *", timeZone: "UTC" },
          target: { type: "persistent-thread", threadId: targetThreadId },
        });
        yield* service.runNow({ automationId });
        for (let index = 0; index < 10; index += 1) yield* Effect.yieldNow;

        const dispatched = yield* Ref.get(commands);
        assert.deepEqual(
          dispatched.map((command) => command.type),
          ["thread.create", "thread.turn.start"],
        );
        const createCommand = dispatched[0];
        const startCommand = dispatched[1];
        assert.equal(createCommand?.type, "thread.create");
        assert.equal(startCommand?.type, "thread.turn.start");
        if (createCommand?.type !== "thread.create" || startCommand?.type !== "thread.turn.start") {
          return assert.fail("Expected thread creation followed by turn start");
        }
        assert.equal(createCommand.threadId, targetThreadId);
        assert.equal(startCommand.threadId, targetThreadId);
      }),
    );
  }),
);

it.effect("always uses full access and interrupts a run when deleted", () =>
  Effect.gen(function* () {
    const commands = yield* Ref.make<ReadonlyArray<OrchestrationCommand>>([]);
    yield* withAutomationRuntime(
      thread(),
      commands,
      Effect.gen(function* () {
        const service = yield* AutomationService;
        const repository = yield* AutomationRepository;
        const automationId = AutomationId.make("automation:delete-running");
        const automation = yield* service.create({
          automationId,
          title: "Full access routine",
          prompt: "Run the task.",
          projectId,
          modelSelection: null,
          schedule: { type: "cron", expression: "0 9 * * *", timeZone: "UTC" },
          target: { type: "existing-thread", threadId },
        });
        assert.equal(automation.runtimeMode, "full-access");
        yield* service.runNow({ automationId });
        for (let index = 0; index < 10; index += 1) yield* Effect.yieldNow;
        yield* service.delete(automationId);
        const commandTypes = (yield* Ref.get(commands)).map((command) => command.type);
        assert.include(commandTypes, "thread.turn.interrupt");
        const runs = yield* repository.listRunsByAutomation(automationId, 10);
        assert.equal(runs[0]?.status, "cancelled");
      }),
    );
  }),
);
