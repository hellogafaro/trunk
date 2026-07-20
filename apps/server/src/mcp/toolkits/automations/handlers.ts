import { AutomationId, AutomationOperationError, ThreadId } from "@t3tools/contracts";
import * as Crypto from "effect/Crypto";
import * as Effect from "effect/Effect";

import { AutomationService } from "../../../automation/AutomationService.ts";
import { ProjectionSnapshotQuery } from "../../../orchestration/Services/ProjectionSnapshotQuery.ts";
import * as McpInvocationContext from "../../McpInvocationContext.ts";
import { AutomationToolkit } from "./tools.ts";
import type { AssistantAutomationCreateInput } from "./tools.ts";
import type { AssistantAutomationUpdateInput } from "./tools.ts";

const operationError = (message: string, cause?: unknown) =>
  new AutomationOperationError({ message, ...(cause === undefined ? {} : { cause }) });

const requireCapability = Effect.fn("automation.requireCapability")(function* () {
  const invocation = yield* McpInvocationContext.McpInvocationContext;
  if (!invocation.capabilities.has("automations")) {
    return yield* operationError("This chat does not have permission to manage scheduled tasks.");
  }
  return invocation;
});

export const createAutomationFromChat = Effect.fn("automation.createFromChat")(function* (
  input: AssistantAutomationCreateInput,
) {
  const invocation = yield* requireCapability();
  const automations = yield* AutomationService;
  const snapshots = yield* ProjectionSnapshotQuery;
  const crypto = yield* Crypto.Crypto;
  const readModel = yield* snapshots
    .getCommandReadModel()
    .pipe(
      Effect.mapError((cause) =>
        operationError("Could not read the current chat before creating the schedule.", cause),
      ),
    );
  const thread = readModel.threads.find(
    (candidate) => candidate.id === invocation.threadId && candidate.deletedAt === null,
  );
  if (!thread) {
    return yield* operationError("The current chat is unavailable for scheduled tasks.");
  }

  const targetKind = input.target ?? "dedicated-chat";
  if (targetKind !== "current-chat" && thread.modelSelection === null) {
    return yield* operationError(
      "Choose a provider and model in this chat before creating a new automation chat.",
    );
  }
  const uuid = yield* crypto.randomUUIDv4.pipe(
    Effect.mapError((cause) => operationError("Could not create an automation identifier.", cause)),
  );
  const target =
    targetKind === "current-chat"
      ? ({ type: "existing-thread", threadId: invocation.threadId } as const)
      : targetKind === "dedicated-chat"
        ? ({
            type: "persistent-thread",
            threadId: ThreadId.make(`automation-thread:${uuid}`),
          } as const)
        : ({ type: "fresh-thread" } as const);

  return yield* automations.create({
    automationId: AutomationId.make(`automation:${uuid}`),
    title: input.title,
    prompt: input.prompt,
    projectId: thread.projectId,
    modelSelection: targetKind === "current-chat" ? null : thread.modelSelection,
    runtimeMode: input.runtimeMode ?? "approval-required",
    fullAccessAcknowledged: input.acknowledgeFullAccess ?? false,
    schedule: input.schedule,
    target,
  });
});

const listAutomations = Effect.fn("automation.list")(function* () {
  yield* requireCapability();
  return yield* (yield* AutomationService).getSnapshot;
});

const updateAutomation = Effect.fn("automation.update")(function* (
  input: AssistantAutomationUpdateInput,
) {
  yield* requireCapability();
  const automations = yield* AutomationService;
  const snapshot = yield* automations.getSnapshot;
  const current = snapshot.automations.find((automation) => automation.id === input.automationId);
  if (current === undefined) {
    return yield* operationError(`Automation '${input.automationId}' was not found.`);
  }
  return yield* automations.update({
    automationId: current.id,
    title: input.title ?? current.title,
    prompt: input.prompt ?? current.prompt,
    projectId: current.projectId,
    modelSelection: current.modelSelection,
    runtimeMode: input.runtimeMode ?? current.runtimeMode,
    fullAccessAcknowledged:
      input.acknowledgeFullAccess ??
      (current.runtimeMode === "full-access" && input.runtimeMode === undefined),
    schedule: input.schedule ?? current.schedule,
    target: current.target,
  });
});

const setAutomationStatus = Effect.fn("automation.setStatus")(function* (input: {
  readonly automationId: AutomationId;
  readonly status: "enabled" | "disabled";
}) {
  yield* requireCapability();
  return yield* (yield* AutomationService).setStatus(input);
});

const runAutomationNow = Effect.fn("automation.runNow")(function* (input: {
  readonly automationId: AutomationId;
}) {
  yield* requireCapability();
  return yield* (yield* AutomationService).runNow(input);
});

const deleteAutomation = Effect.fn("automation.delete")(function* (input: {
  readonly automationId: AutomationId;
}) {
  yield* requireCapability();
  yield* (yield* AutomationService).delete(input.automationId);
  return { deleted: true } as const;
});

const handlers = {
  automation_create: createAutomationFromChat,
  automation_list: listAutomations,
  automation_update: updateAutomation,
  automation_set_status: setAutomationStatus,
  automation_run_now: runAutomationNow,
  automation_delete: deleteAutomation,
} satisfies Parameters<typeof AutomationToolkit.toLayer>[0];

export const AutomationToolkitHandlersLive = AutomationToolkit.toLayer(handlers);
