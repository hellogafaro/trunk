import {
  AutomationId,
  AutomationRunId,
  MessageId,
  ProjectId,
  ProviderInstanceId,
  ThreadId,
} from "@t3tools/contracts";
import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";

import { AutomationRepository } from "../Services/Automations.ts";
import { AutomationRepositoryLive } from "./Automations.ts";
import { SqlitePersistenceMemory } from "./Sqlite.ts";

const layer = it.layer(AutomationRepositoryLive.pipe(Layer.provideMerge(SqlitePersistenceMemory)));

layer("AutomationRepository", (it) => {
  it.effect("round-trips definitions and soft deletes them without removing run history", () =>
    Effect.gen(function* () {
      const repository = yield* AutomationRepository;
      const automationId = AutomationId.make("automation:test-round-trip");
      yield* repository.upsert({
        id: automationId,
        title: "Daily brief",
        prompt: "Summarize the repository.",
        projectId: ProjectId.make("project:test"),
        modelSelection: {
          instanceId: ProviderInstanceId.make("codex"),
          model: "gpt-5.4",
        },
        runtimeMode: "approval-required",
        schedule: { type: "cron", expression: "0 9 * * 1-5", timeZone: "Europe/Berlin" },
        target: {
          type: "persistent-thread",
          threadId: ThreadId.make("automation-thread:test"),
        },
        status: "enabled",
        disableReason: null,
        nextRunAt: "2026-07-20T07:00:00.000Z",
        createdAt: "2026-07-18T12:00:00.000Z",
        updatedAt: "2026-07-18T12:00:00.000Z",
        deletedAt: null,
      });
      yield* repository.upsertRun({
        id: AutomationRunId.make("automation-run:test"),
        automationId,
        trigger: "scheduled",
        status: "queued",
        scheduledFor: "2026-07-20T07:00:00.000Z",
        latestScheduledFor: "2026-07-20T07:00:00.000Z",
        coalescedCount: 0,
        threadId: null,
        messageId: null,
        error: null,
        createdAt: "2026-07-20T07:00:00.000Z",
        startedAt: null,
        finishedAt: null,
      });
      assert.deepEqual(
        (yield* repository.listActionableRuns()).map((run) => run.id),
        [AutomationRunId.make("automation-run:test")],
      );

      const stored = yield* repository.getById(automationId);
      assert.isTrue(Option.isSome(stored));
      if (Option.isSome(stored)) {
        assert.deepEqual(stored.value.schedule, {
          type: "cron",
          expression: "0 9 * * 1-5",
          timeZone: "Europe/Berlin",
        });
        assert.equal(stored.value.modelSelection?.instanceId, "codex");
      }

      yield* repository.softDelete(automationId, "2026-07-18T13:00:00.000Z");
      const deleted = yield* repository.getById(automationId);
      assert.isTrue(Option.isSome(deleted));
      if (Option.isSome(deleted)) {
        assert.equal(deleted.value.status, "disabled");
        assert.equal(deleted.value.deletedAt, "2026-07-18T13:00:00.000Z");
      }
      assert.equal((yield* repository.listRunsByAutomation(automationId, 10)).length, 1);
    }),
  );

  it.effect("enforces at most one queued and one running run per automation", () =>
    Effect.gen(function* () {
      const repository = yield* AutomationRepository;
      const automationId = AutomationId.make("automation:test-unique-runs");
      yield* repository.upsert({
        id: automationId,
        title: "Unique runs",
        prompt: "Run once.",
        projectId: ProjectId.make("project:test"),
        modelSelection: null,
        runtimeMode: "approval-required",
        schedule: { type: "once", runAt: "2026-07-20T07:00:00.000Z" },
        target: { type: "fresh-thread" },
        status: "enabled",
        disableReason: null,
        nextRunAt: "2026-07-20T07:00:00.000Z",
        createdAt: "2026-07-18T12:00:00.000Z",
        updatedAt: "2026-07-18T12:00:00.000Z",
        deletedAt: null,
      });
      const base = {
        automationId,
        trigger: "scheduled" as const,
        scheduledFor: "2026-07-20T07:00:00.000Z",
        latestScheduledFor: "2026-07-20T07:00:00.000Z",
        coalescedCount: 0,
        threadId: null,
        messageId: null,
        error: null,
        createdAt: "2026-07-20T07:00:00.000Z",
        startedAt: null,
        finishedAt: null,
      };
      yield* repository.upsertRun({
        ...base,
        id: AutomationRunId.make("automation-run:queued-1"),
        status: "queued",
      });
      const duplicate = yield* Effect.exit(
        repository.upsertRun({
          ...base,
          id: AutomationRunId.make("automation-run:queued-2"),
          status: "queued",
        }),
      );
      assert.equal(duplicate._tag, "Failure");
    }),
  );

  it.effect("looks up automation turns by their pending message id", () =>
    Effect.gen(function* () {
      const repository = yield* AutomationRepository;
      const missing = yield* repository.getTurnState({
        threadId: ThreadId.make("thread:missing"),
        messageId: MessageId.make("message:missing"),
      });
      assert.isTrue(Option.isNone(missing));
    }),
  );

  it.effect(
    "atomically advances a definition while coalescing queued work and leases scheduling",
    () =>
      Effect.gen(function* () {
        const repository = yield* AutomationRepository;
        const automationId = AutomationId.make("automation:atomic-enqueue");
        const automation = {
          id: automationId,
          title: "Atomic routine",
          prompt: "Inspect the project.",
          projectId: ProjectId.make("project:test"),
          modelSelection: null,
          runtimeMode: "approval-required" as const,
          schedule: { type: "cron" as const, expression: "0 9 * * *", timeZone: "UTC" },
          target: { type: "existing-thread" as const, threadId: ThreadId.make("thread:test") },
          status: "enabled" as const,
          disableReason: null,
          nextRunAt: "2026-07-21T09:00:00.000Z",
          createdAt: "2026-07-18T12:00:00.000Z",
          updatedAt: "2026-07-18T12:00:00.000Z",
          deletedAt: null,
        };
        yield* repository.upsert(automation);
        const makeRun = (id: string, scheduledFor: string) => ({
          id: AutomationRunId.make(id),
          automationId,
          trigger: "scheduled" as const,
          status: "queued" as const,
          scheduledFor,
          latestScheduledFor: scheduledFor,
          coalescedCount: 0,
          threadId: null,
          messageId: null,
          error: null,
          createdAt: scheduledFor,
          startedAt: null,
          finishedAt: null,
        });
        yield* repository.enqueueRun({
          run: makeRun("automation-run:atomic-1", "2026-07-20T09:00:00.000Z"),
          automation: { ...automation, nextRunAt: "2026-07-22T09:00:00.000Z" },
        });
        const coalesced = yield* repository.enqueueRun({
          run: makeRun("automation-run:atomic-2", "2026-07-21T09:00:00.000Z"),
          automation: null,
        });
        assert.equal(coalesced.coalescedCount, 1);
        assert.equal((yield* repository.listRunsByAutomation(automationId, 10)).length, 1);
        const stored = yield* repository.getById(automationId);
        assert.equal(Option.getOrThrow(stored).nextRunAt, "2026-07-22T09:00:00.000Z");

        assert.isTrue(
          yield* repository.acquireSchedulerLease({
            ownerId: "owner-a",
            now: "2026-07-20T09:00:00.000Z",
            expiresAt: "2026-07-20T09:00:10.000Z",
          }),
        );
        assert.isFalse(
          yield* repository.acquireSchedulerLease({
            ownerId: "owner-b",
            now: "2026-07-20T09:00:01.000Z",
            expiresAt: "2026-07-20T09:00:11.000Z",
          }),
        );
        assert.isTrue(
          yield* repository.acquireSchedulerLease({
            ownerId: "owner-b",
            now: "2026-07-20T09:00:10.000Z",
            expiresAt: "2026-07-20T09:00:20.000Z",
          }),
        );
      }),
  );
});
