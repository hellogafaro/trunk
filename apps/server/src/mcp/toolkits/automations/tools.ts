import {
  Automation,
  AutomationOperationError,
  AutomationSchedule,
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

export const AutomationCreateTool = Tool.make("automation_create", {
  description:
    "Create a scheduled task after interviewing the user and confirming the task, schedule, time zone, and chat behavior. Use a five-field cron expression for recurring schedules or an ISO-8601 timestamp for a one-time schedule. target defaults to current-chat; use dedicated-chat for one separate chat reused forever, or new-chat-each-run for an independent chat on every run.",
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

export const AutomationToolkit = Toolkit.make(AutomationCreateTool);
