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
        schedule: { type: "cron", expression: "0 9 * * 1-5", timeZone: "Europe/Berlin" },
        target: {
          type: "persistent-thread",
          threadId: ThreadId.make("automation-thread:test"),
        },
        status: "active",
        stopReason: null,
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
        assert.equal(deleted.value.status, "stopped");
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
        schedule: { type: "once", runAt: "2026-07-20T07:00:00.000Z" },
        target: { type: "fresh-thread" },
        status: "active",
        stopReason: null,
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
});
