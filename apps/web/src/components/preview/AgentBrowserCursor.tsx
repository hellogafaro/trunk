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
        viewBox="-0.5 -0.5 16 16"
        className="relative size-5 -translate-x-[2px] -translate-y-[2px] fill-blue-600 text-blue-600"
        style={{
          filter: "drop-shadow(0 0 4.5px rgb(107 114 128 / 55%))",
        }}
        aria-hidden="true"
      >
        <path
          fillRule="evenodd"
          clipRule="evenodd"
          d="M13.2403125 5.168375c.9875625.401125.9121875 1.82375-.11225 2.1181875L7.958875 8.7725l-2.3609375 4.8326875c-.4679375.9576875-1.8820625.784875-2.1055625-.25725L1.0856875 2.1243125C.8968125 1.2435 1.7705.510375 2.6051875.8493125L13.2403125 5.168375Z"
          stroke="white"
          strokeWidth="2"
          strokeLinejoin="round"
          strokeLinecap="round"
          paintOrder="stroke fill"
        />
      </svg>
    </div>
  );
}
