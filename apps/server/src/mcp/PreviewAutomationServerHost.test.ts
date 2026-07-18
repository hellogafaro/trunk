import {
  PreviewBrowserOperationError,
  type PreviewAutomationOperation,
  type PreviewAutomationRequest,
  ThreadId,
} from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { serializeServerAutomationError } from "./PreviewAutomationServerHost.ts";

const request = (
  operation: PreviewAutomationOperation,
  input: unknown = {},
): PreviewAutomationRequest => ({
  requestId: "request-1",
  threadId: ThreadId.make("thread-1"),
  operation,
  input,
  timeoutMs: 1_000,
});

describe("PreviewAutomationServerHost", () => {
  it.each([
    ["automation-tab-not-found", "PreviewAutomationTabNotFoundError"],
    ["automation-timeout", "PreviewAutomationTimeoutError"],
    ["automation-invalid-selector", "PreviewAutomationInvalidSelectorError"],
    ["automation-target-not-editable", "PreviewAutomationTargetNotEditableError"],
    ["automation-result-too-large", "PreviewAutomationResultTooLargeError"],
    ["automation-click", "PreviewAutomationExecutionError"],
  ])("maps %s to %s", (operation, expectedTag) => {
    const response = serializeServerAutomationError(
      request("click", { locator: "role=button[name='Apply']" }),
      new PreviewBrowserOperationError({ operation, message: "failure" }),
    );

    expect(response._tag).toBe(expectedTag);
  });

  it("preserves selector diagnostics for remote error classification", () => {
    const response = serializeServerAutomationError(
      request("type", { selector: "#name" }),
      new PreviewBrowserOperationError({
        operation: "automation-target-not-editable",
        message: "not editable",
      }),
    );

    expect(response.detail).toEqual({ selectorKind: "selector", selectorLength: 5 });
  });
});
