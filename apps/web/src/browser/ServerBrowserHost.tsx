"use client";

import { parseScopedThreadKey } from "@t3tools/client-runtime/environment";
import type {
  PreviewBrowserFrame,
  PreviewBrowserInput,
  PreviewSessionSnapshot,
  ScopedThreadRef,
} from "@t3tools/contracts";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useShallow } from "zustand/react/shallow";

import { isElectron } from "~/env";
import { useEnvironmentQuery } from "~/state/query";
import { previewEnvironment } from "~/state/preview";
import { useAtomCommand } from "~/state/use-atom-command";
import { useActivePreviewSessions } from "~/previewStateStore";

import { useBrowserSurfaceStore } from "./browserSurfaceStore";
import { useBrowserPointerStore } from "./browserPointerStore";
import { resolveHostedBrowserWebviewWrapperStyle } from "./hostedBrowserWebviewStyle";
import { BrowserAnnotationOverlay } from "./BrowserAnnotationOverlay";
import { cancelBrowserAnnotation, useBrowserAnnotationStore } from "./browserAnnotationStore";
import { resolveBrowserViewportLayout } from "./browserViewportLayout";

const DEFAULT_HIDDEN_SIZE = { width: 1280, height: 800 } as const;
type BrowserInputPayload = PreviewBrowserInput extends infer T
  ? T extends PreviewBrowserInput
    ? Omit<T, "threadId" | "tabId">
    : never
  : never;

const pointerButton = (button: number): "left" | "middle" | "right" =>
  button === 1 ? "middle" : button === 2 ? "right" : "left";

export function ServerBrowserHost() {
  const previewByThreadKey = useActivePreviewSessions();
  const sessions = useMemo(
    () =>
      Object.entries(previewByThreadKey).flatMap(([threadKey, previewState]) => {
        const threadRef = parseScopedThreadKey(threadKey);
        return threadRef
          ? Object.values(previewState.sessions).map((snapshot) => ({ threadRef, snapshot }))
          : [];
      }),
    [previewByThreadKey],
  );

  if (isElectron) return null;
  return (
    <div className="contents" data-server-browser-host>
      {sessions.map(({ threadRef, snapshot }) => (
        <ServerBrowserTab key={snapshot.tabId} threadRef={threadRef} snapshot={snapshot} />
      ))}
    </div>
  );
}

function ServerBrowserTab(props: {
  readonly threadRef: ScopedThreadRef;
  readonly snapshot: PreviewSessionSnapshot;
}) {
  const { threadRef, snapshot } = props;
  const tabId = snapshot.tabId;
  const sendInput = useAtomCommand(previewEnvironment.sendBrowserInput, {
    reportFailure: false,
  });
  const setViewport = useAtomCommand(previewEnvironment.setBrowserViewport, {
    reportFailure: false,
  });
  const [frozenFrame, setFrozenFrame] = useState<PreviewBrowserFrame | null>(null);
  const annotationActive = useBrowserAnnotationStore((state) =>
    Boolean(state.activeByTabId[tabId]),
  );
  const presentation = useBrowserSurfaceStore(
    useShallow((state) => {
      const current = state.byTabId[tabId];
      return {
        rect: current?.rect ?? null,
        visible: current?.visible ?? false,
      };
    }),
  );
  const frames = useEnvironmentQuery(
    previewEnvironment.browserFrames({
      environmentId: threadRef.environmentId,
      input: { threadId: threadRef.threadId, tabId },
    }),
  );
  const hasFrame = frames.data !== undefined;
  const active = presentation.visible && presentation.rect !== null;
  const viewportSetting = snapshot.viewport ?? { _tag: "fill" as const };
  const hiddenSize =
    viewportSetting._tag === "fill"
      ? DEFAULT_HIDDEN_SIZE
      : { width: viewportSetting.width, height: viewportSetting.height };
  const container = active && presentation.rect ? presentation.rect : hiddenSize;
  const layout = resolveBrowserViewportLayout(container, viewportSetting);
  const wrapperStyle = resolveHostedBrowserWebviewWrapperStyle({
    active,
    rect: presentation.rect,
    hiddenSize,
  });
  const inputElementRef = useRef<HTMLDivElement | null>(null);
  const pendingMoveRef = useRef<{ readonly x: number; readonly y: number } | null>(null);
  const moveFrameRef = useRef<number | null>(null);
  const annotationUrlRef = useRef<string | null>(null);

  const targetViewport =
    viewportSetting._tag === "fill"
      ? {
          width: Math.max(1, Math.round(container.width)),
          height: Math.max(1, Math.round(container.height)),
        }
      : { width: viewportSetting.width, height: viewportSetting.height };

  useEffect(() => {
    if (!annotationActive) {
      annotationUrlRef.current = null;
      setFrozenFrame(null);
      return;
    }
    setFrozenFrame((current) => current ?? frames.data ?? null);
    const currentUrl = snapshot.navStatus._tag === "Idle" ? "about:blank" : snapshot.navStatus.url;
    if (annotationUrlRef.current === null) annotationUrlRef.current = currentUrl;
    else if (annotationUrlRef.current !== currentUrl) cancelBrowserAnnotation(tabId);
  }, [annotationActive, frames.data, snapshot.navStatus, tabId]);

  useEffect(() => {
    if (!annotationActive || presentation.visible) return;
    cancelBrowserAnnotation(tabId);
  }, [annotationActive, presentation.visible, tabId]);

  useEffect(() => () => cancelBrowserAnnotation(tabId), [tabId]);

  useEffect(() => {
    const cursor = frames.data?.cursor;
    if (!cursor) return;
    useBrowserPointerStore.getState().apply({
      tabId,
      ...cursor,
      sequence: frames.data.sequence,
      createdAt: new Date().toISOString(),
    });
  }, [frames.data, tabId]);

  useEffect(() => () => useBrowserPointerStore.getState().clear(tabId), [tabId]);

  useEffect(() => {
    if (!active || !hasFrame) return;
    void setViewport({
      environmentId: threadRef.environmentId,
      input: {
        threadId: threadRef.threadId,
        tabId,
        ...targetViewport,
      },
    });
  }, [
    active,
    hasFrame,
    setViewport,
    tabId,
    targetViewport.height,
    targetViewport.width,
    threadRef,
  ]);

  const pagePoint = useCallback(
    (clientX: number, clientY: number) => {
      const rect = presentation.rect;
      if (!rect) return null;
      const x = (clientX - rect.x - layout.viewportX) / layout.viewportScale;
      const y = (clientY - rect.y - layout.viewportY) / layout.viewportScale;
      if (x < 0 || y < 0 || x > targetViewport.width || y > targetViewport.height) return null;
      return {
        x: Math.min(targetViewport.width - 1, Math.max(0, x)),
        y: Math.min(targetViewport.height - 1, Math.max(0, y)),
      };
    },
    [layout, presentation.rect, targetViewport],
  );

  const dispatchInput = useCallback(
    (input: BrowserInputPayload) => {
      void sendInput({
        environmentId: threadRef.environmentId,
        input: { ...input, threadId: threadRef.threadId, tabId } as PreviewBrowserInput,
      });
    },
    [sendInput, tabId, threadRef],
  );

  const scheduleMove = useCallback(
    (point: { readonly x: number; readonly y: number }) => {
      pendingMoveRef.current = point;
      if (moveFrameRef.current !== null) return;
      moveFrameRef.current = window.requestAnimationFrame(() => {
        moveFrameRef.current = null;
        const next = pendingMoveRef.current;
        pendingMoveRef.current = null;
        if (next) dispatchInput({ kind: "pointer", action: "move", ...next });
      });
    },
    [dispatchInput],
  );

  useEffect(
    () => () => {
      if (moveFrameRef.current !== null) window.cancelAnimationFrame(moveFrameRef.current);
    },
    [],
  );

  useEffect(() => {
    const frameId = window.requestAnimationFrame(() => {
      useBrowserSurfaceStore.getState().presentContent(tabId, {
        x: layout.viewportX,
        y: layout.viewportY,
        width: layout.viewportWidth,
        height: layout.viewportHeight,
        scale: layout.viewportScale,
        scrollLeft: 0,
        scrollTop: 0,
      });
    });
    return () => window.cancelAnimationFrame(frameId);
  }, [layout, tabId]);

  const displayFrame = frozenFrame ?? frames.data;

  return (
    <div
      ref={inputElementRef}
      className="fixed overflow-hidden bg-background outline-none"
      style={wrapperStyle}
      tabIndex={active ? 0 : -1}
      aria-label="Hosted browser preview"
      onContextMenu={(event) => event.preventDefault()}
      onPointerMove={(event) => {
        if (annotationActive) return;
        const point = pagePoint(event.clientX, event.clientY);
        if (point) scheduleMove(point);
      }}
      onPointerDown={(event) => {
        if (annotationActive) return;
        const point = pagePoint(event.clientX, event.clientY);
        if (!point) return;
        event.preventDefault();
        inputElementRef.current?.focus({ preventScroll: true });
        inputElementRef.current?.setPointerCapture(event.pointerId);
        dispatchInput({
          kind: "pointer",
          action: "down",
          ...point,
          button: pointerButton(event.button),
        });
      }}
      onPointerUp={(event) => {
        if (annotationActive) return;
        const point = pagePoint(event.clientX, event.clientY);
        if (!point) return;
        event.preventDefault();
        dispatchInput({
          kind: "pointer",
          action: "up",
          ...point,
          button: pointerButton(event.button),
        });
      }}
      onWheel={(event) => {
        if (annotationActive) {
          event.preventDefault();
          return;
        }
        const point = pagePoint(event.clientX, event.clientY);
        if (!point) return;
        event.preventDefault();
        dispatchInput({
          kind: "wheel",
          ...point,
          deltaX: event.deltaX,
          deltaY: event.deltaY,
        });
      }}
      onKeyDown={(event) => {
        if (annotationActive) return;
        event.preventDefault();
        if (event.repeat) return;
        dispatchInput({ kind: "keyboard", action: "down", key: event.key });
      }}
      onKeyUp={(event) => {
        if (annotationActive) return;
        event.preventDefault();
        dispatchInput({ kind: "keyboard", action: "up", key: event.key });
      }}
      data-server-browser-tab={tabId}
    >
      <div className="relative" style={{ width: layout.canvasWidth, height: layout.canvasHeight }}>
        {displayFrame ? (
          <img
            src={`data:${displayFrame.mimeType};base64,${displayFrame.data}`}
            alt=""
            draggable={false}
            className="pointer-events-none absolute select-none bg-background"
            style={{
              left: layout.viewportX,
              top: layout.viewportY,
              width: layout.viewportWidth,
              height: layout.viewportHeight,
            }}
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-xs text-muted-foreground">
            {frames.error ?? "Starting browser…"}
          </div>
        )}
        {annotationActive && frozenFrame ? (
          <BrowserAnnotationOverlay
            threadRef={threadRef}
            snapshot={snapshot}
            frame={frozenFrame}
            layout={layout}
            container={container}
            onCancel={() => cancelBrowserAnnotation(tabId)}
          />
        ) : null}
      </div>
    </div>
  );
}
