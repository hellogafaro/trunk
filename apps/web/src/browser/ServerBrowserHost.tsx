"use client";

import { parseScopedThreadKey } from "@t3tools/client-runtime/environment";
import type {
  PreviewBrowserFrame,
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
import { type BrowserInputPayload, createBrowserInputPump } from "./browserInputPump";

const DEFAULT_HIDDEN_SIZE = { width: 1280, height: 800 } as const;

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
  const lastPointRef = useRef<{ readonly x: number; readonly y: number } | null>(null);
  const pressedButtonsRef = useRef(new Set<"left" | "middle" | "right">());
  const pressedKeysRef = useRef(new Set<string>());
  const keyboardActiveRef = useRef(false);
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

  const inputPump = useMemo(
    () =>
      createBrowserInputPump(async (input) => {
        await sendInput({
          environmentId: threadRef.environmentId,
          input: { ...input, threadId: threadRef.threadId, tabId },
        });
      }),
    [sendInput, tabId, threadRef.environmentId, threadRef.threadId],
  );

  useEffect(() => () => inputPump.dispose(), [inputPump]);

  const dispatchInput = useCallback(
    (input: BrowserInputPayload) => inputPump.push(input),
    [inputPump],
  );

  const releasePressedInput = useCallback(() => {
    const point = lastPointRef.current;
    if (point) {
      for (const button of pressedButtonsRef.current) {
        dispatchInput({ kind: "pointer", action: "up", ...point, button });
      }
    }
    pressedButtonsRef.current.clear();
    for (const key of pressedKeysRef.current) {
      dispatchInput({ kind: "keyboard", action: "up", key });
    }
    pressedKeysRef.current.clear();
  }, [dispatchInput]);

  useEffect(() => {
    const handlePointerDown = (event: PointerEvent): void => {
      const insideBrowser =
        event.target instanceof Node && inputElementRef.current?.contains(event.target);
      keyboardActiveRef.current = Boolean(insideBrowser);
      if (!insideBrowser) releasePressedInput();
    };
    const handleKeyDown = (event: KeyboardEvent): void => {
      if (!keyboardActiveRef.current || !active || annotationActive) return;
      event.preventDefault();
      event.stopPropagation();
      if (event.repeat || pressedKeysRef.current.has(event.key)) return;
      pressedKeysRef.current.add(event.key);
      dispatchInput({ kind: "keyboard", action: "down", key: event.key });
    };
    const handleKeyUp = (event: KeyboardEvent): void => {
      if (!keyboardActiveRef.current || !active || annotationActive) return;
      event.preventDefault();
      event.stopPropagation();
      pressedKeysRef.current.delete(event.key);
      dispatchInput({ kind: "keyboard", action: "up", key: event.key });
    };
    const handleWindowBlur = (): void => {
      keyboardActiveRef.current = false;
      releasePressedInput();
    };
    document.addEventListener("pointerdown", handlePointerDown, true);
    window.addEventListener("keydown", handleKeyDown, true);
    window.addEventListener("keyup", handleKeyUp, true);
    window.addEventListener("blur", handleWindowBlur);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown, true);
      window.removeEventListener("keydown", handleKeyDown, true);
      window.removeEventListener("keyup", handleKeyUp, true);
      window.removeEventListener("blur", handleWindowBlur);
    };
  }, [active, annotationActive, dispatchInput, releasePressedInput]);

  useEffect(() => {
    if (active && !annotationActive) return;
    keyboardActiveRef.current = false;
    releasePressedInput();
  }, [active, annotationActive, releasePressedInput]);

  useEffect(() => {
    const element = inputElementRef.current;
    if (!element) return;
    const handleWheel = (event: WheelEvent): void => {
      event.preventDefault();
      if (annotationActive) return;
      const point = pagePoint(event.clientX, event.clientY);
      if (!point) return;
      lastPointRef.current = point;
      dispatchInput({
        kind: "wheel",
        ...point,
        deltaX: event.deltaX,
        deltaY: event.deltaY,
      });
    };
    element.addEventListener("wheel", handleWheel, { passive: false });
    return () => element.removeEventListener("wheel", handleWheel);
  }, [annotationActive, dispatchInput, pagePoint]);

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
        if (!point) return;
        lastPointRef.current = point;
        dispatchInput({ kind: "pointer", action: "move", ...point });
      }}
      onPointerDown={(event) => {
        if (annotationActive) return;
        const point = pagePoint(event.clientX, event.clientY);
        if (!point) return;
        event.preventDefault();
        lastPointRef.current = point;
        keyboardActiveRef.current = true;
        inputElementRef.current?.focus({ preventScroll: true });
        try {
          inputElementRef.current?.setPointerCapture(event.pointerId);
        } catch {
          // Synthetic pointer events and a disappearing surface may not own capture.
        }
        const button = pointerButton(event.button);
        pressedButtonsRef.current.add(button);
        dispatchInput({
          kind: "pointer",
          action: "down",
          ...point,
          button,
          clickCount: Math.min(3, Math.max(1, event.detail || 1)),
        });
      }}
      onPointerUp={(event) => {
        if (annotationActive) return;
        const point = pagePoint(event.clientX, event.clientY);
        if (!point) return;
        event.preventDefault();
        lastPointRef.current = point;
        const button = pointerButton(event.button);
        pressedButtonsRef.current.delete(button);
        dispatchInput({
          kind: "pointer",
          action: "up",
          ...point,
          button,
          clickCount: Math.min(3, Math.max(1, event.detail || 1)),
        });
        try {
          if (inputElementRef.current?.hasPointerCapture(event.pointerId)) {
            inputElementRef.current.releasePointerCapture(event.pointerId);
          }
        } catch {
          // The pointer can be released by the browser before this handler runs.
        }
      }}
      onPointerCancel={(event) => {
        const point = pagePoint(event.clientX, event.clientY) ?? lastPointRef.current;
        if (point) lastPointRef.current = point;
        releasePressedInput();
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
