import {
  Automation,
  AutomationId,
  AutomationOperationError,
  AutomationRun,
  AutomationSchedule,
  AutomationSnapshot,
  TrimmedNonEmptyString,
} from "@t3tools/contracts";
import * as Crypto from "effect/Crypto";
import * as Schema from "effect/Schema";
import { Tool, Toolkit } from "effect/unstable/ai";

import { AutomationService } from "../../../automation/AutomationService.ts";
import { ProjectionSnapshotQuery } from "../../../orchestration/Services/ProjectionSnapshotQuery.ts";
import * as McpInvocationContext from "../../McpInvocationContext.ts";

export const AssistantAutomationTarget = Schema.Literals([
  "current-chat",
  "dedicated-chat",
  "new-chat-each-run",
]);
export type AssistantAutomationTarget = typeof AssistantAutomationTarget.Type;

export const AssistantAutomationCreateInput = Schema.Struct({
  title: TrimmedNonEmptyString,
  prompt: TrimmedNonEmptyString,
  schedule: AutomationSchedule,
  target: Schema.optionalKey(AssistantAutomationTarget),
});
export type AssistantAutomationCreateInput = typeof AssistantAutomationCreateInput.Type;

export const AssistantAutomationUpdateInput = Schema.Struct({
  automationId: AutomationId,
  title: Schema.optionalKey(TrimmedNonEmptyString),
  prompt: Schema.optionalKey(TrimmedNonEmptyString),
  schedule: Schema.optionalKey(AutomationSchedule),
});
export type AssistantAutomationUpdateInput = typeof AssistantAutomationUpdateInput.Type;

const NoParameters = Schema.Record(Schema.String, Schema.Never);

export const AutomationCreateTool = Tool.make("routine_create", {
  description:
    "Create a routine after interviewing the user and confirming its task, schedule, time zone, and chat behavior. Routines always run with full access in the current chat's project and environment. Use a five-field cron expression for recurring routines or an ISO-8601 timestamp for a one-time routine. target defaults to dedicated-chat.",
  parameters: AssistantAutomationCreateInput,
  success: Automation,
  failure: AutomationOperationError,
  dependencies: [
    McpInvocationContext.McpInvocationContext,
    AutomationService,
    ProjectionSnapshotQuery,
    Crypto.Crypto,
  ],
})
  .annotate(Tool.Title, "Create routine")
  .annotate(Tool.Readonly, false)
  .annotate(Tool.Destructive, false)
  .annotate(Tool.Idempotent, false)
  .annotate(Tool.OpenWorld, false);

export const AutomationListTool = Tool.make("routine_list", {
  description: "List routines and their recent runs in this environment.",
  parameters: NoParameters,
  success: AutomationSnapshot,
  failure: AutomationOperationError,
  dependencies: [McpInvocationContext.McpInvocationContext, AutomationService],
})
  .annotate(Tool.Readonly, true)
  .annotate(Tool.OpenWorld, false);

export const AutomationUpdateTool = Tool.make("routine_update", {
  description: "Update the name, prompt, or schedule of a routine.",
  parameters: AssistantAutomationUpdateInput,
  success: Automation,
  failure: AutomationOperationError,
  dependencies: [McpInvocationContext.McpInvocationContext, AutomationService],
})
  .annotate(Tool.Readonly, false)
  .annotate(Tool.Destructive, false)
  .annotate(Tool.OpenWorld, false);

export const AutomationSetStatusTool = Tool.make("routine_set_status", {
  description:
    "Enable or disable a routine. Disabling cancels queued work; a current run may finish.",
  parameters: Schema.Struct({
    automationId: AutomationId,
    status: Schema.Literals(["enabled", "disabled"]),
  }),
  success: Automation,
  failure: AutomationOperationError,
  dependencies: [McpInvocationContext.McpInvocationContext, AutomationService],
})
  .annotate(Tool.Readonly, false)
  .annotate(Tool.Destructive, false)
  .annotate(Tool.OpenWorld, false);

export const AutomationRunNowTool = Tool.make("routine_run_now", {
  description: "Queue a routine immediately through the same durable run queue.",
  parameters: Schema.Struct({ automationId: AutomationId }),
  success: AutomationRun,
  failure: AutomationOperationError,
  dependencies: [McpInvocationContext.McpInvocationContext, AutomationService],
})
  .annotate(Tool.Readonly, false)
  .annotate(Tool.Destructive, false)
  .annotate(Tool.OpenWorld, false);

export const AutomationDeleteTool = Tool.make("routine_delete", {
  description: "Permanently delete a routine and cancel its queued or running work.",
  parameters: Schema.Struct({ automationId: AutomationId }),
  success: Schema.Struct({ deleted: Schema.Boolean }),
  failure: AutomationOperationError,
  dependencies: [McpInvocationContext.McpInvocationContext, AutomationService],
})
  .annotate(Tool.Readonly, false)
  .annotate(Tool.Destructive, true)
  .annotate(Tool.OpenWorld, false);

export const AutomationToolkit = Toolkit.make(
  AutomationCreateTool,
  AutomationListTool,
  AutomationUpdateTool,
  AutomationSetStatusTool,
  AutomationRunNowTool,
  AutomationDeleteTool,
);
