"use client";

import type { DesktopPreviewPointerEvent } from "@t3tools/contracts";

import { useBrowserPointerStore } from "~/browser/browserPointerStore";
import { useBrowserSurfaceStore } from "~/browser/browserSurfaceStore";

export function AgentBrowserCursor(props: { readonly tabId: string; readonly zoomFactor: number }) {
  const { tabId, zoomFactor } = props;
  const event = useBrowserPointerStore((state) => state.byTabId[tabId] ?? null);
  const content = useBrowserSurfaceStore((state) => state.byTabId[tabId]?.content ?? null);

  if (!event) return null;

  return (
    <AgentBrowserCursorEvent
      key={event.sequence}
      event={event}
      content={content}
      zoomFactor={zoomFactor}
    />
  );
}

function AgentBrowserCursorEvent(props: {
  readonly event: DesktopPreviewPointerEvent;
  readonly content: {
    readonly x: number;
    readonly y: number;
    readonly scale: number;
    readonly scrollLeft: number;
    readonly scrollTop: number;
  } | null;
  readonly zoomFactor: number;
}) {
  const { event, content, zoomFactor } = props;

  return (
    <div
      className="pointer-events-none absolute left-0 top-0 z-40 transition-transform duration-150 ease-out motion-reduce:transition-none"
      style={{
        transform: `translate3d(${event.x * zoomFactor * (content?.scale ?? 1) + (content?.x ?? 0) - (content?.scrollLeft ?? 0)}px, ${event.y * zoomFactor * (content?.scale ?? 1) + (content?.y ?? 0) - (content?.scrollTop ?? 0)}px, 0)`,
      }}
      aria-hidden="true"
      data-agent-browser-cursor
    >
      <svg
        viewBox="0 0 24 25"
        className="relative size-6.5 -translate-x-[3px] -translate-y-[3px] fill-blue-600 text-blue-600"
        style={{
          filter: "drop-shadow(0 2px 2px rgb(107 114 128))",
        }}
        aria-hidden="true"
      >
        <path
          d="M3.6 2.7 21 16.25c.75.58.33 1.78-.62 1.78h-8.1a1 1 0 0 0-.75.34l-5.15 5.78c-.64.72-1.83.27-1.83-.7V3.52c0-.78.89-1.22 1.5-.74Z"
          stroke="currentColor"
          strokeWidth="1.35"
          strokeLinejoin="round"
          strokeLinecap="round"
        />
      </svg>
    </div>
  );
}
