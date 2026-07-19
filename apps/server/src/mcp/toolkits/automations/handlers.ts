import { AutomationId, AutomationOperationError, ThreadId } from "@t3tools/contracts";
import * as Crypto from "effect/Crypto";
import * as Effect from "effect/Effect";

import { AutomationService } from "../../../automation/AutomationService.ts";
import { ProjectionSnapshotQuery } from "../../../orchestration/Services/ProjectionSnapshotQuery.ts";
import * as McpInvocationContext from "../../McpInvocationContext.ts";
import { AutomationToolkit } from "./tools.ts";
import type { AssistantAutomationCreateInput } from "./tools.ts";

const operationError = (message: string, cause?: unknown) =>
  new AutomationOperationError({ message, ...(cause === undefined ? {} : { cause }) });

export const createAutomationFromChat = Effect.fn("automation.createFromChat")(function* (
  input: AssistantAutomationCreateInput,
) {
  const invocation = yield* McpInvocationContext.McpInvocationContext;
  if (!invocation.capabilities.has("automations")) {
    return yield* operationError("This chat does not have permission to create scheduled tasks.");
  }
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

  const targetKind = input.target ?? "current-chat";
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
    schedule: input.schedule,
    target,
  });
});

const handlers = {
  automation_create: createAutomationFromChat,
} satisfies Parameters<typeof AutomationToolkit.toLayer>[0];

export const AutomationToolkitHandlersLive = AutomationToolkit.toLayer(handlers);
