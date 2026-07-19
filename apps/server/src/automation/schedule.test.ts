import { assert, describe, it } from "@effect/vitest";
import * as Result from "effect/Result";

import { calculateNextRunAt, validateFutureSchedule } from "./schedule.ts";

function successValue<A>(result: Result.Result<A, unknown>): A {
  assert.isTrue(Result.isSuccess(result));
  if (Result.isFailure(result)) throw result.failure;
  return result.success;
}

describe("automation schedules", () => {
  it("keeps a future one-time run and rejects a past one", () => {
    const now = Date.parse("2026-07-18T12:00:00.000Z");
    assert.equal(
      successValue(calculateNextRunAt({ type: "once", runAt: "2026-07-18T12:05:00.000Z" }, now)),
      "2026-07-18T12:05:00.000Z",
    );
    assert.equal(
      successValue(calculateNextRunAt({ type: "once", runAt: "2026-07-18T11:55:00.000Z" }, now)),
      null,
    );
    assert.isTrue(
      Result.isFailure(
        validateFutureSchedule({ type: "once", runAt: "2026-07-18T11:55:00.000Z" }, now),
      ),
    );
  });

  it("calculates daily and weekday cron schedules in their configured time zone", () => {
    assert.equal(
      successValue(
        calculateNextRunAt(
          { type: "cron", expression: "0 9 * * *", timeZone: "Europe/Berlin" },
          Date.parse("2026-07-18T08:00:00.000Z"),
        ),
      ),
      "2026-07-19T07:00:00.000Z",
    );
    assert.equal(
      successValue(
        calculateNextRunAt(
          { type: "cron", expression: "0 9 * * 1-5", timeZone: "America/New_York" },
          Date.parse("2026-07-17T14:00:00.000Z"),
        ),
      ),
      "2026-07-20T13:00:00.000Z",
    );
  });

  it("handles daylight-saving transitions without shifting the configured wall time", () => {
    assert.equal(
      successValue(
        calculateNextRunAt(
          { type: "cron", expression: "0 9 * * *", timeZone: "America/New_York" },
          Date.parse("2026-03-07T15:00:00.000Z"),
        ),
      ),
      "2026-03-08T13:00:00.000Z",
    );
    assert.equal(
      successValue(
        calculateNextRunAt(
          { type: "cron", expression: "0 9 * * *", timeZone: "America/New_York" },
          Date.parse("2026-10-31T14:00:00.000Z"),
        ),
      ),
      "2026-11-01T14:00:00.000Z",
    );
  });

  it("rejects malformed cron expressions, unknown zones, and invalid reference times", () => {
    assert.isTrue(
      Result.isFailure(
        calculateNextRunAt(
          { type: "cron", expression: "not a cron", timeZone: "UTC" },
          Date.parse("2026-07-18T12:00:00.000Z"),
        ),
      ),
    );
    assert.isTrue(
      Result.isFailure(
        calculateNextRunAt(
          { type: "cron", expression: "0 9 * * *", timeZone: "Mars/Olympus" },
          Date.parse("2026-07-18T12:00:00.000Z"),
        ),
      ),
    );
    assert.isTrue(
      Result.isFailure(
        calculateNextRunAt({ type: "cron", expression: "0 9 * * *", timeZone: "UTC" }, NaN),
      ),
    );
  });
});
