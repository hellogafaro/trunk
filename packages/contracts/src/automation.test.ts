import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import { AutomationCreateInput, AutomationSnapshot } from "./automation.ts";

const decodeCreateInput = Schema.decodeUnknownEffect(AutomationCreateInput);
const decodeSnapshot = Schema.decodeUnknownEffect(AutomationSnapshot);

describe("automation contracts", () => {
  it.effect("decodes canonical create inputs", () =>
    Effect.gen(function* () {
      const decoded = yield* decodeCreateInput({
        automationId: "automation:test",
        title: "Daily brief",
        prompt: "Summarize the repository.",
        projectId: "project:test",
        modelSelection: { instanceId: "codex", model: "gpt-5.4" },
        schedule: { type: "cron", expression: "0 9 * * 1-5", timeZone: "Europe/Berlin" },
        target: { type: "persistent-thread", threadId: "thread:automation" },
      });
      assert.equal(decoded.schedule.type, "cron");
      assert.equal(decoded.target.type, "persistent-thread");
    }),
  );

  it.effect("rejects blank prompts and malformed target variants", () =>
    Effect.gen(function* () {
      const result = yield* Effect.exit(
        decodeCreateInput({
          automationId: "automation:test",
          title: "Daily brief",
          prompt: "   ",
          projectId: "project:test",
          modelSelection: null,
          schedule: { type: "once", runAt: "2026-07-20T09:00:00.000Z" },
          target: { type: "existing-thread" },
        }),
      );
      assert.equal(result._tag, "Failure");
    }),
  );

  it.effect("requires non-negative coalesced run counts in snapshots", () =>
    Effect.gen(function* () {
      const result = yield* Effect.exit(
        decodeSnapshot({
          automations: [],
          updatedAt: "2026-07-18T12:00:00.000Z",
          runs: [
            {
              id: "automation-run:test",
              automationId: "automation:test",
              trigger: "manual",
              status: "queued",
              scheduledFor: "2026-07-18T12:00:00.000Z",
              latestScheduledFor: "2026-07-18T12:00:00.000Z",
              coalescedCount: -1,
              threadId: null,
              messageId: null,
              error: null,
              createdAt: "2026-07-18T12:00:00.000Z",
              startedAt: null,
              finishedAt: null,
            },
          ],
        }),
      );
      assert.equal(result._tag, "Failure");
    }),
  );
});
