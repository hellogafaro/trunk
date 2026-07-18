import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import { type EnvironmentId, ThreadId } from "@t3tools/contracts";
import { beforeEach, describe, expect, it } from "vite-plus/test";

import { resetPreviewStateForTests } from "~/previewStateStore";
import { selectThreadRightPanelState, useRightPanelStore } from "~/rightPanelStore";

import { applyPreviewPresentationEvent } from "./applyPreviewPresentationEvent";

const threadRef = scopeThreadRef("env-1" as EnvironmentId, ThreadId.make("thread-1"));

beforeEach(() => {
  resetPreviewStateForTests();
  useRightPanelStore.setState({ byThreadKey: {} });
});

describe("applyPreviewPresentationEvent", () => {
  it("opens the side panel and activates the exact automated browser tab", () => {
    applyPreviewPresentationEvent(threadRef, {
      type: "automationPresented",
      threadId: threadRef.threadId,
      tabId: "tab_1",
      createdAt: "2026-07-18T00:00:00.000Z",
    });

    expect(
      selectThreadRightPanelState(useRightPanelStore.getState().byThreadKey, threadRef),
    ).toEqual({
      isOpen: true,
      activeSurfaceId: "browser:tab_1",
      surfaces: [{ id: "browser:tab_1", kind: "preview", resourceId: "tab_1" }],
    });
  });
});
