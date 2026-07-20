import {
  Automation,
  AutomationId,
  AutomationOperationError,
  AutomationRun,
  AutomationSchedule,
  AutomationSnapshot,
  RuntimeMode,
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
  runtimeMode: Schema.optionalKey(RuntimeMode),
  acknowledgeFullAccess: Schema.optionalKey(Schema.Boolean),
});
export type AssistantAutomationCreateInput = typeof AssistantAutomationCreateInput.Type;

export const AssistantAutomationUpdateInput = Schema.Struct({
  automationId: AutomationId,
  title: Schema.optionalKey(TrimmedNonEmptyString),
  prompt: Schema.optionalKey(TrimmedNonEmptyString),
  schedule: Schema.optionalKey(AutomationSchedule),
  runtimeMode: Schema.optionalKey(RuntimeMode),
  acknowledgeFullAccess: Schema.optionalKey(Schema.Boolean),
});
export type AssistantAutomationUpdateInput = typeof AssistantAutomationUpdateInput.Type;

export const AutomationCreateTool = Tool.make("automation_create", {
  description:
    "Create a scheduled task after interviewing the user and confirming the task, schedule, time zone, chat behavior, and permissions. Use a five-field cron expression for recurring schedules or an ISO-8601 timestamp for a one-time schedule. target defaults to dedicated-chat. runtimeMode defaults to approval-required; full-access requires acknowledgeFullAccess=true after explicit user confirmation.",
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
  .annotate(Tool.Title, "Create scheduled task")
  .annotate(Tool.Readonly, false)
  .annotate(Tool.Destructive, false)
  .annotate(Tool.Idempotent, false)
  .annotate(Tool.OpenWorld, false);

export const AutomationListTool = Tool.make("automation_list", {
  description: "List scheduled tasks and their recent runs in this environment.",
  parameters: Schema.Struct({}),
  success: AutomationSnapshot,
  failure: AutomationOperationError,
  dependencies: [McpInvocationContext.McpInvocationContext, AutomationService],
})
  .annotate(Tool.Readonly, true)
  .annotate(Tool.OpenWorld, false);

export const AutomationUpdateTool = Tool.make("automation_update", {
  description: "Update the name, prompt, schedule, or permissions of a scheduled task.",
  parameters: AssistantAutomationUpdateInput,
  success: Automation,
  failure: AutomationOperationError,
  dependencies: [McpInvocationContext.McpInvocationContext, AutomationService],
})
  .annotate(Tool.Readonly, false)
  .annotate(Tool.Destructive, false)
  .annotate(Tool.OpenWorld, false);

export const AutomationSetStatusTool = Tool.make("automation_set_status", {
  description:
    "Pause or resume a scheduled task. Pausing cancels queued work; a current run may finish.",
  parameters: Schema.Struct({
    automationId: AutomationId,
    status: Schema.Literals(["active", "stopped"]),
  }),
  success: Automation,
  failure: AutomationOperationError,
  dependencies: [McpInvocationContext.McpInvocationContext, AutomationService],
})
  .annotate(Tool.Readonly, false)
  .annotate(Tool.Destructive, false)
  .annotate(Tool.OpenWorld, false);

export const AutomationRunNowTool = Tool.make("automation_run_now", {
  description: "Queue a scheduled task immediately through the same durable run queue.",
  parameters: Schema.Struct({ automationId: AutomationId }),
  success: AutomationRun,
  failure: AutomationOperationError,
  dependencies: [McpInvocationContext.McpInvocationContext, AutomationService],
})
  .annotate(Tool.Readonly, false)
  .annotate(Tool.Destructive, false)
  .annotate(Tool.OpenWorld, false);

export const AutomationDeleteTool = Tool.make("automation_delete", {
  description: "Permanently delete a scheduled task and cancel its queued or running work.",
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
