import * as Schema from "effect/Schema";

import {
  AutomationId,
  AutomationRunId,
  IsoDateTime,
  MessageId,
  NonNegativeInt,
  ProjectId,
  ThreadId,
  TrimmedNonEmptyString,
} from "./baseSchemas.ts";
import { ModelSelection } from "./orchestration.ts";

export const AUTOMATION_WS_METHODS = {
  subscribe: "automations.subscribe",
  create: "automations.create",
  update: "automations.update",
  setStatus: "automations.setStatus",
  runNow: "automations.runNow",
  delete: "automations.delete",
} as const;

export const AutomationSchedule = Schema.Union([
  Schema.Struct({
    type: Schema.Literal("once"),
    runAt: IsoDateTime,
  }),
  Schema.Struct({
    type: Schema.Literal("cron"),
    expression: TrimmedNonEmptyString,
    timeZone: TrimmedNonEmptyString,
  }),
]);
export type AutomationSchedule = typeof AutomationSchedule.Type;

export const AutomationTarget = Schema.Union([
  Schema.Struct({ type: Schema.Literal("fresh-thread") }),
  Schema.Struct({
    type: Schema.Literal("persistent-thread"),
    threadId: ThreadId,
  }),
  Schema.Struct({
    type: Schema.Literal("existing-thread"),
    threadId: ThreadId,
  }),
]);
export type AutomationTarget = typeof AutomationTarget.Type;

export const AutomationStatus = Schema.Literals(["active", "stopped"]);
export type AutomationStatus = typeof AutomationStatus.Type;

export const AutomationStopReason = Schema.Literals(["manual", "once-completed", "target-deleted"]);
export type AutomationStopReason = typeof AutomationStopReason.Type;

export const AutomationRunStatus = Schema.Literals([
  "queued",
  "running",
  "succeeded",
  "failed",
  "cancelled",
]);
export type AutomationRunStatus = typeof AutomationRunStatus.Type;

export const AutomationRunTrigger = Schema.Literals(["scheduled", "manual"]);
export type AutomationRunTrigger = typeof AutomationRunTrigger.Type;

export const Automation = Schema.Struct({
  id: AutomationId,
  title: TrimmedNonEmptyString,
  prompt: TrimmedNonEmptyString,
  projectId: ProjectId,
  modelSelection: Schema.NullOr(ModelSelection),
  schedule: AutomationSchedule,
  target: AutomationTarget,
  status: AutomationStatus,
  stopReason: Schema.NullOr(AutomationStopReason),
  nextRunAt: Schema.NullOr(IsoDateTime),
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
});
export type Automation = typeof Automation.Type;

export const AutomationRun = Schema.Struct({
  id: AutomationRunId,
  automationId: AutomationId,
  trigger: AutomationRunTrigger,
  status: AutomationRunStatus,
  scheduledFor: IsoDateTime,
  latestScheduledFor: IsoDateTime,
  coalescedCount: NonNegativeInt,
  threadId: Schema.NullOr(ThreadId),
  messageId: Schema.NullOr(MessageId),
  error: Schema.NullOr(Schema.String),
  createdAt: IsoDateTime,
  startedAt: Schema.NullOr(IsoDateTime),
  finishedAt: Schema.NullOr(IsoDateTime),
});
export type AutomationRun = typeof AutomationRun.Type;

export const AutomationSnapshot = Schema.Struct({
  automations: Schema.Array(Automation),
  runs: Schema.Array(AutomationRun),
  updatedAt: IsoDateTime,
});
export type AutomationSnapshot = typeof AutomationSnapshot.Type;

const AutomationWriteFields = {
  title: TrimmedNonEmptyString,
  prompt: TrimmedNonEmptyString,
  projectId: ProjectId,
  modelSelection: Schema.NullOr(ModelSelection),
  schedule: AutomationSchedule,
  target: AutomationTarget,
} as const;

export const AutomationCreateInput = Schema.Struct({
  automationId: AutomationId,
  ...AutomationWriteFields,
});
export type AutomationCreateInput = typeof AutomationCreateInput.Type;

export const AutomationUpdateInput = Schema.Struct({
  automationId: AutomationId,
  ...AutomationWriteFields,
});
export type AutomationUpdateInput = typeof AutomationUpdateInput.Type;

export const AutomationSetStatusInput = Schema.Struct({
  automationId: AutomationId,
  status: AutomationStatus,
});
export type AutomationSetStatusInput = typeof AutomationSetStatusInput.Type;

export const AutomationRunNowInput = Schema.Struct({ automationId: AutomationId });
export type AutomationRunNowInput = typeof AutomationRunNowInput.Type;

export const AutomationDeleteInput = Schema.Struct({ automationId: AutomationId });
export type AutomationDeleteInput = typeof AutomationDeleteInput.Type;

export const AutomationMutationResult = Schema.Struct({ automation: Automation });
export type AutomationMutationResult = typeof AutomationMutationResult.Type;

export const AutomationRunNowResult = Schema.Struct({ run: AutomationRun });
export type AutomationRunNowResult = typeof AutomationRunNowResult.Type;

export class AutomationOperationError extends Schema.TaggedErrorClass<AutomationOperationError>()(
  "AutomationOperationError",
  {
    message: TrimmedNonEmptyString,
    cause: Schema.optional(Schema.Defect()),
  },
) {}
