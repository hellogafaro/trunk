import { type AutomationSchedule } from "@t3tools/contracts";
import * as Cron from "effect/Cron";
import * as DateTime from "effect/DateTime";
import * as Result from "effect/Result";
import * as Schema from "effect/Schema";

export class AutomationScheduleError extends Schema.TaggedErrorClass<AutomationScheduleError>()(
  "AutomationScheduleError",
  { message: Schema.String },
) {}

function validDate(value: string, label: string): Result.Result<number, AutomationScheduleError> {
  const epochMillis = Date.parse(value);
  return Number.isFinite(epochMillis)
    ? Result.succeed(epochMillis)
    : Result.fail(new AutomationScheduleError({ message: `${label} is not a valid date.` }));
}

export function calculateNextRunAt(
  schedule: AutomationSchedule,
  afterEpochMillis: number,
): Result.Result<string | null, AutomationScheduleError> {
  if (!Number.isFinite(afterEpochMillis)) {
    return Result.fail(new AutomationScheduleError({ message: "The reference date is invalid." }));
  }

  if (schedule.type === "once") {
    return validDate(schedule.runAt, "Run time").pipe(
      Result.map((runAt) =>
        runAt > afterEpochMillis ? DateTime.formatIso(DateTime.makeUnsafe(runAt)) : null,
      ),
    );
  }

  return Cron.parse(schedule.expression, schedule.timeZone).pipe(
    Result.mapError(
      (cause) => new AutomationScheduleError({ message: `Invalid schedule: ${cause.message}` }),
    ),
    Result.map((cron) => Cron.next(cron, DateTime.makeUnsafe(afterEpochMillis)).toISOString()),
  );
}

export function validateFutureSchedule(
  schedule: AutomationSchedule,
  nowEpochMillis: number,
): Result.Result<string, AutomationScheduleError> {
  return calculateNextRunAt(schedule, nowEpochMillis).pipe(
    Result.flatMap((nextRunAt) =>
      nextRunAt === null
        ? Result.fail(
            new AutomationScheduleError({ message: "A one-time schedule must be in the future." }),
          )
        : Result.succeed(nextRunAt),
    ),
  );
}
