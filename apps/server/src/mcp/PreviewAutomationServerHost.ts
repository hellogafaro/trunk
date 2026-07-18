import {
  PREVIEW_AUTOMATION_OPERATIONS,
  PreviewBrowserOperationError,
  type PreviewAutomationRequest,
  type PreviewAutomationResponse,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";

import * as ServerEnvironment from "../environment/ServerEnvironment.ts";
import * as PreviewManager from "../preview/Manager.ts";
import * as PreviewAutomationBroker from "./PreviewAutomationBroker.ts";

const isPreviewBrowserOperationError = Schema.is(PreviewBrowserOperationError);

const responseDetail = (request: PreviewAutomationRequest) => {
  if (typeof request.input !== "object" || request.input === null) return undefined;
  const input = request.input as { readonly locator?: unknown; readonly selector?: unknown };
  if (typeof input.locator === "string") {
    return { selectorKind: "locator" as const, selectorLength: input.locator.length };
  }
  if (typeof input.selector === "string") {
    return { selectorKind: "selector" as const, selectorLength: input.selector.length };
  }
  return request.operation === "type" ? { selectorKind: "focused-element" as const } : undefined;
};

export function serializeServerAutomationError(
  request: PreviewAutomationRequest,
  error: unknown,
): NonNullable<PreviewAutomationResponse["error"]> {
  const message = error instanceof Error ? error.message : String(error);
  if (isPreviewBrowserOperationError(error)) {
    switch (error.operation) {
      case "automation-tab-not-found":
        return { _tag: "PreviewAutomationTabNotFoundError", message };
      case "automation-timeout":
        return { _tag: "PreviewAutomationTimeoutError", message };
      case "automation-invalid-selector":
        return {
          _tag: "PreviewAutomationInvalidSelectorError",
          message,
          detail: responseDetail(request),
        };
      case "automation-target-not-editable":
        return {
          _tag: "PreviewAutomationTargetNotEditableError",
          message,
          detail: responseDetail(request),
        };
      case "automation-result-too-large":
        return {
          _tag: "PreviewAutomationResultTooLargeError",
          message,
          detail: { maximumBytes: 64_000 },
        };
    }
  }
  return { _tag: "PreviewAutomationExecutionError", message };
}

export const layer = Layer.effectDiscard(
  Effect.gen(function* () {
    const broker = yield* PreviewAutomationBroker.PreviewAutomationBroker;
    const previewManager = yield* PreviewManager.PreviewManager;
    const environment = yield* ServerEnvironment.ServerEnvironment;
    const environmentId = yield* environment.getEnvironmentId;
    const clientId = `server-browser:${environmentId}`;
    const events = yield* broker.connect({
      clientId,
      environmentId,
      supportedOperations: [...PREVIEW_AUTOMATION_OPERATIONS],
    });

    yield* Stream.runForEach(events, (event) => {
      if (event.type === "connected") return Effect.void;
      const request = event.request;
      const respond = (response: Omit<PreviewAutomationResponse, "clientId" | "connectionId">) =>
        broker.respond({
          clientId,
          connectionId: event.connectionId,
          ...response,
        });
      return previewManager.automate(request).pipe(
        Effect.matchEffect({
          onFailure: (error) =>
            respond({
              requestId: request.requestId,
              ok: false,
              error: serializeServerAutomationError(request, error),
            }),
          onSuccess: (result) =>
            respond({
              requestId: request.requestId,
              ok: true,
              ...(result === undefined ? {} : { result }),
            }),
        }),
        Effect.forkScoped,
        Effect.asVoid,
      );
    }).pipe(Effect.forkScoped);
  }),
);
