import type { PreviewEvent, ScopedThreadRef } from "@t3tools/contracts";

import { applyPreviewServerEvent } from "~/previewStateStore";
import { useRightPanelStore } from "~/rightPanelStore";

export function applyPreviewPresentationEvent(
  threadRef: ScopedThreadRef,
  event: PreviewEvent,
): void {
  applyPreviewServerEvent(threadRef, event);
  if (event.type === "automationPresented") {
    useRightPanelStore.getState().openBrowser(threadRef, event.tabId);
  }
}
