"use client";

import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import type {
  PreviewAnnotationElementTarget,
  PreviewAnnotationPayload,
  PreviewAnnotationRect,
  PreviewAnnotationRegionTarget,
  PreviewAnnotationStrokeTarget,
  PreviewBrowserFrame,
  PreviewBrowserInspectedElement,
  PreviewSessionSnapshot,
  ScopedThreadRef,
} from "@t3tools/contracts";
import { Check, Eraser, MousePointer2, Pencil, SquareDashed, Undo2, X } from "lucide-react";
import {
  type PointerEvent as ReactPointerEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { useComposerDraftStore } from "~/composerDraftStore";
import { Button } from "~/components/ui/button";
import { Textarea } from "~/components/ui/textarea";
import { toastManager } from "~/components/ui/toast";
import { previewAnnotationScreenshotFile } from "~/lib/previewAnnotation";
import { previewEnvironment } from "~/state/preview";
import { useAtomCommand } from "~/state/use-atom-command";
import { cn, randomUUID } from "~/lib/utils";

import { createBrowserAnnotationScreenshot } from "./browserAnnotationScreenshot";
import {
  annotationPointInRect,
  annotationRectFromPoints,
  annotationStrokeBounds,
  type BrowserAnnotationPoint,
} from "./browserAnnotationGeometry";
import type { BrowserViewportLayout } from "./browserViewportLayout";

type AnnotationTool = "select" | "region" | "draw" | "erase";
type AnnotationMark =
  | { readonly kind: "element"; readonly target: PreviewAnnotationElementTarget }
  | { readonly kind: "region"; readonly target: PreviewAnnotationRegionTarget }
  | { readonly kind: "stroke"; readonly target: PreviewAnnotationStrokeTarget };

const DRAW_COLOR = "#2563eb";
const TOOL_ITEMS = [
  { id: "select" as const, label: "Select element", icon: MousePointer2 },
  { id: "region" as const, label: "Select region", icon: SquareDashed },
  { id: "draw" as const, label: "Draw", icon: Pencil },
  { id: "erase" as const, label: "Erase annotation", icon: Eraser },
];

const newId = (prefix: string): string => `${prefix}-${randomUUID()}`;

const markRect = (mark: AnnotationMark): PreviewAnnotationRect =>
  mark.kind === "stroke" ? mark.target.bounds : mark.target.rect;

const frameDataUrl = (frame: PreviewBrowserFrame): string =>
  `data:${frame.mimeType};base64,${frame.data}`;

export function BrowserAnnotationOverlay(props: {
  readonly threadRef: ScopedThreadRef;
  readonly snapshot: PreviewSessionSnapshot;
  readonly frame: PreviewBrowserFrame;
  readonly layout: BrowserViewportLayout;
  readonly container: { readonly width: number; readonly height: number };
  readonly onCancel: () => void;
}) {
  const { threadRef, snapshot, frame, layout, container, onCancel } = props;
  const inspectBrowserPoint = useAtomCommand(previewEnvironment.inspectBrowserPoint, {
    reportFailure: false,
  });
  const addPreviewAnnotation = useComposerDraftStore((store) => store.addPreviewAnnotation);
  const addImage = useComposerDraftStore((store) => store.addImage);
  const [tool, setTool] = useState<AnnotationTool>("select");
  const [marks, setMarks] = useState<ReadonlyArray<AnnotationMark>>([]);
  const [hovered, setHovered] = useState<PreviewBrowserInspectedElement | null>(null);
  const [activeMarkId, setActiveMarkId] = useState<string | null>(null);
  const [comment, setComment] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [dragStart, setDragStart] = useState<BrowserAnnotationPoint | null>(null);
  const [dragPoint, setDragPoint] = useState<BrowserAnnotationPoint | null>(null);
  const [drawing, setDrawing] = useState<ReadonlyArray<BrowserAnnotationPoint>>([]);
  const inspectionTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inspectionSequenceRef = useRef(0);
  const pickingRef = useRef(false);
  const surfaceRef = useRef<HTMLDivElement | null>(null);

  const pagePoint = useCallback(
    (event: {
      readonly clientX: number;
      readonly clientY: number;
    }): BrowserAnnotationPoint | null => {
      const rect = surfaceRef.current?.getBoundingClientRect();
      if (!rect || rect.width <= 0 || rect.height <= 0) return null;
      return {
        x: Math.min(
          frame.width,
          Math.max(0, ((event.clientX - rect.left) / rect.width) * frame.width),
        ),
        y: Math.min(
          frame.height,
          Math.max(0, ((event.clientY - rect.top) / rect.height) * frame.height),
        ),
      };
    },
    [frame.height, frame.width],
  );

  const inspectPoint = useCallback(
    async (
      point: BrowserAnnotationPoint,
    ): Promise<ReadonlyArray<PreviewBrowserInspectedElement>> => {
      const result = await inspectBrowserPoint({
        environmentId: threadRef.environmentId,
        input: {
          threadId: threadRef.threadId,
          tabId: snapshot.tabId,
          x: point.x,
          y: point.y,
        },
      });
      if (result._tag === "Failure") throw squashAtomCommandFailure(result);
      return result.value;
    },
    [inspectBrowserPoint, snapshot.tabId, threadRef],
  );

  const queueInspection = useCallback(
    (point: BrowserAnnotationPoint) => {
      if (inspectionTimerRef.current !== null) clearTimeout(inspectionTimerRef.current);
      const sequence = ++inspectionSequenceRef.current;
      inspectionTimerRef.current = setTimeout(() => {
        inspectionTimerRef.current = null;
        void inspectPoint(point)
          .then((elements) => {
            if (sequence === inspectionSequenceRef.current) setHovered(elements[0] ?? null);
          })
          .catch(() => undefined);
      }, 60);
    },
    [inspectPoint],
  );

  useEffect(
    () => () => {
      if (inspectionTimerRef.current !== null) clearTimeout(inspectionTimerRef.current);
    },
    [],
  );

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      onCancel();
    };
    window.addEventListener("keydown", handleKeyDown, true);
    return () => window.removeEventListener("keydown", handleKeyDown, true);
  }, [onCancel]);

  const addMark = useCallback((mark: AnnotationMark) => {
    setMarks((current) => [...current, mark]);
    setActiveMarkId(mark.target.id);
  }, []);

  const eraseAt = useCallback((point: BrowserAnnotationPoint) => {
    setMarks((current) => {
      const index = current.findLastIndex((mark) =>
        annotationPointInRect(point, markRect(mark), 8),
      );
      if (index < 0) return current;
      const removed = current[index];
      const next = current.filter((_, markIndex) => markIndex !== index);
      setActiveMarkId((active) =>
        active === removed?.target.id ? (next.at(-1)?.target.id ?? null) : active,
      );
      return next;
    });
  }, []);

  const handlePointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (
      event.target instanceof HTMLElement &&
      event.target.closest("[data-browser-annotation-target]")
    ) {
      return;
    }
    const point = pagePoint(event);
    if (!point) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    setHovered(null);
    if (tool === "select") {
      if (inspectionTimerRef.current !== null) {
        clearTimeout(inspectionTimerRef.current);
        inspectionTimerRef.current = null;
      }
      const sequence = ++inspectionSequenceRef.current;
      pickingRef.current = true;
      void inspectPoint(point)
        .then((elements) => {
          if (sequence !== inspectionSequenceRef.current) return;
          const inspected = elements[0];
          if (!inspected) return;
          addMark({
            kind: "element",
            target: { id: newId("element"), element: inspected.element, rect: inspected.rect },
          });
        })
        .catch((error) => {
          toastManager.add({
            type: "error",
            title: "Unable to inspect browser element",
            description: error instanceof Error ? error.message : "An error occurred.",
          });
        })
        .finally(() => {
          if (sequence === inspectionSequenceRef.current) pickingRef.current = false;
        });
      return;
    }
    if (tool === "erase") {
      eraseAt(point);
      return;
    }
    setDragStart(point);
    setDragPoint(point);
    if (tool === "draw") setDrawing([point]);
  };

  const handlePointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const point = pagePoint(event);
    if (!point) return;
    if (!dragStart) {
      if (tool === "select" && !pickingRef.current) queueInspection(point);
      return;
    }
    setDragPoint(point);
    if (tool === "draw") {
      setDrawing((current) => {
        const last = current.at(-1);
        if (last && Math.hypot(point.x - last.x, point.y - last.y) < 2) return current;
        return [...current, point];
      });
    }
  };

  const finishPointerGesture = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!dragStart) return;
    const end = pagePoint(event) ?? dragPoint ?? dragStart;
    if (tool === "region") {
      const rect = annotationRectFromPoints(dragStart, end);
      if (rect.width >= 4 && rect.height >= 4) {
        addMark({ kind: "region", target: { id: newId("region"), rect } });
      }
    } else if (tool === "draw" && drawing.length > 1) {
      const width = Math.max(3, frame.width / 420);
      addMark({
        kind: "stroke",
        target: {
          id: newId("stroke"),
          color: DRAW_COLOR,
          width,
          points: drawing,
          bounds: annotationStrokeBounds(drawing, width),
        },
      });
    }
    setDragStart(null);
    setDragPoint(null);
    setDrawing([]);
  };

  const elements = useMemo(
    () => marks.flatMap((mark) => (mark.kind === "element" ? [mark.target] : [])),
    [marks],
  );
  const regions = useMemo(
    () => marks.flatMap((mark) => (mark.kind === "region" ? [mark.target] : [])),
    [marks],
  );
  const strokes = useMemo(
    () => marks.flatMap((mark) => (mark.kind === "stroke" ? [mark.target] : [])),
    [marks],
  );
  const activeMark = marks.find((mark) => mark.target.id === activeMarkId) ?? marks.at(-1) ?? null;
  const activeRect = activeMark ? markRect(activeMark) : null;
  const surfaceScaleX = layout.viewportWidth / frame.width;
  const surfaceScaleY = layout.viewportHeight / frame.height;
  const editorWidth = Math.min(304, Math.max(240, container.width - 16));
  const editorPosition = (() => {
    if (!activeRect) {
      return { left: Math.max(8, (container.width - editorWidth) / 2), top: 52 };
    }
    const targetLeft = layout.viewportX + activeRect.x * surfaceScaleX;
    const targetRight = targetLeft + activeRect.width * surfaceScaleX;
    let left = targetRight + 10;
    if (left + editorWidth > container.width - 8) left = targetLeft - editorWidth - 10;
    return {
      left: Math.max(8, Math.min(container.width - editorWidth - 8, left)),
      top: Math.max(
        52,
        Math.min(container.height - 172, layout.viewportY + activeRect.y * surfaceScaleY),
      ),
    };
  })();
  const draftRect = dragStart && dragPoint ? annotationRectFromPoints(dragStart, dragPoint) : null;

  const submit = async () => {
    if (submitting || marks.length === 0) return;
    setSubmitting(true);
    try {
      const screenshot = await createBrowserAnnotationScreenshot({
        frame,
        elements,
        regions,
        strokes,
      });
      const navStatus = snapshot.navStatus;
      const annotation: PreviewAnnotationPayload = {
        id: newId("annotation"),
        pageUrl: navStatus._tag === "Idle" ? "about:blank" : navStatus.url,
        pageTitle: navStatus._tag === "Idle" ? null : navStatus.title || null,
        comment: comment.trim(),
        elements,
        regions,
        strokes,
        styleChanges: [],
        screenshot,
        createdAt: new Date().toISOString(),
      };
      addPreviewAnnotation(threadRef, annotation);
      const screenshotFile = await previewAnnotationScreenshotFile(annotation);
      if (screenshotFile) {
        addImage(threadRef, {
          type: "image",
          id: annotation.id,
          name: screenshotFile.name,
          mimeType: screenshotFile.type,
          sizeBytes: screenshotFile.size,
          previewUrl: screenshot.dataUrl,
          file: screenshotFile,
        });
      }
      onCancel();
    } catch (error) {
      toastManager.add({
        type: "error",
        title: "Unable to add browser annotation",
        description: error instanceof Error ? error.message : "An error occurred.",
      });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="pointer-events-none absolute inset-0 z-[60]" data-browser-annotation-overlay>
      <div
        ref={surfaceRef}
        className={cn(
          "pointer-events-auto absolute touch-none overflow-hidden outline-none",
          tool === "select" && "cursor-default",
          tool === "region" && "cursor-crosshair",
          tool === "draw" && "cursor-cell",
          tool === "erase" && "cursor-not-allowed",
        )}
        style={{
          left: layout.viewportX,
          top: layout.viewportY,
          width: layout.viewportWidth,
          height: layout.viewportHeight,
        }}
        role="application"
        aria-label="Browser annotation canvas"
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={finishPointerGesture}
        onPointerCancel={() => {
          setDragStart(null);
          setDragPoint(null);
          setDrawing([]);
        }}
      >
        <img
          src={frameDataUrl(frame)}
          alt=""
          draggable={false}
          className="pointer-events-none absolute inset-0 size-full select-none"
        />
        <div className="pointer-events-none absolute inset-0 bg-blue-500/[0.025]" />
        {hovered ? (
          <AnnotationRect
            rect={hovered.rect}
            frame={frame}
            className="border-blue-500/90 bg-blue-500/10"
          />
        ) : null}
        {marks.map((mark, index) =>
          mark.kind === "stroke" ? null : (
            <AnnotationRect
              key={mark.target.id}
              rect={mark.target.rect}
              frame={frame}
              label={index + 1}
              active={mark.target.id === activeMarkId}
              dashed={mark.kind === "region"}
              onSelect={() => {
                if (tool === "erase") {
                  setMarks((current) =>
                    current.filter((candidate) => candidate.target.id !== mark.target.id),
                  );
                  setActiveMarkId(null);
                } else {
                  setActiveMarkId(mark.target.id);
                }
              }}
            />
          ),
        )}
        {draftRect && tool === "region" ? (
          <AnnotationRect rect={draftRect} frame={frame} dashed className="bg-blue-500/10" />
        ) : null}
        <svg
          className="pointer-events-none absolute inset-0 size-full overflow-visible"
          viewBox={`0 0 ${frame.width} ${frame.height}`}
          preserveAspectRatio="none"
          aria-hidden="true"
        >
          {strokes.map((stroke) => (
            <polyline
              key={stroke.id}
              points={stroke.points.map((point) => `${point.x},${point.y}`).join(" ")}
              fill="none"
              stroke={stroke.color}
              strokeWidth={stroke.width}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          ))}
          {drawing.length > 1 ? (
            <polyline
              points={drawing.map((point) => `${point.x},${point.y}`).join(" ")}
              fill="none"
              stroke={DRAW_COLOR}
              strokeWidth={Math.max(3, frame.width / 420)}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          ) : null}
        </svg>
      </div>

      <div
        className="pointer-events-auto absolute left-1/2 top-2 flex -translate-x-1/2 items-center gap-0.5 rounded-lg border border-border/80 bg-background/95 p-1 shadow-lg backdrop-blur-md"
        role="toolbar"
        aria-label="Annotation tools"
      >
        {TOOL_ITEMS.map((item) => {
          const Icon = item.icon;
          return (
            <Button
              key={item.id}
              variant="ghost"
              size="icon-sm"
              aria-label={item.label}
              aria-pressed={tool === item.id}
              title={item.label}
              className={cn(
                tool === item.id &&
                  "bg-blue-500/15 text-blue-600 hover:bg-blue-500/20 hover:text-blue-600 dark:text-blue-400",
              )}
              onClick={() => setTool(item.id)}
            >
              <Icon />
            </Button>
          );
        })}
        <span className="mx-0.5 h-5 w-px bg-border" aria-hidden="true" />
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Undo annotation"
          title="Undo"
          disabled={marks.length === 0}
          onClick={() => {
            setMarks((current) => current.slice(0, -1));
            setActiveMarkId((current) =>
              marks.at(-1)?.target.id === current ? (marks.at(-2)?.target.id ?? null) : current,
            );
          }}
        >
          <Undo2 />
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Cancel annotation"
          title="Cancel (Esc)"
          onClick={onCancel}
        >
          <X />
        </Button>
      </div>

      {marks.length > 0 ? (
        <div
          className="pointer-events-auto absolute rounded-xl border border-border/80 bg-background/95 p-2.5 shadow-xl backdrop-blur-md"
          style={{ width: editorWidth, ...editorPosition }}
          data-browser-annotation-editor
        >
          <div className="mb-2 flex items-center justify-between gap-2">
            <div className="min-w-0">
              <p className="truncate text-xs font-medium">Describe the change</p>
              <p className="text-[11px] text-muted-foreground">
                {marks.length} {marks.length === 1 ? "annotation" : "annotations"}
              </p>
            </div>
            <Button
              variant="ghost"
              size="icon-xs"
              aria-label="Remove selected annotation"
              title="Remove selected"
              onClick={() => {
                const targetId = activeMark?.target.id;
                if (!targetId) return;
                setMarks((current) => current.filter((mark) => mark.target.id !== targetId));
                setActiveMarkId(null);
              }}
            >
              <X />
            </Button>
          </div>
          <Textarea
            size="sm"
            value={comment}
            onChange={(event) => setComment(event.target.value)}
            placeholder="What should change here?"
            aria-label="Annotation comment"
            className="mb-2"
          />
          <Button className="w-full" size="sm" disabled={submitting} onClick={() => void submit()}>
            <Check />
            {submitting ? "Adding…" : "Add to chat"}
          </Button>
        </div>
      ) : (
        <div className="pointer-events-none absolute left-1/2 top-13 -translate-x-1/2 rounded-md border border-border/70 bg-background/90 px-2.5 py-1.5 text-xs text-muted-foreground shadow-md backdrop-blur-sm">
          {tool === "select"
            ? "Click an element"
            : tool === "region"
              ? "Drag around a region"
              : tool === "draw"
                ? "Draw over the page"
                : "Click an annotation to erase it"}
        </div>
      )}
    </div>
  );
}

function AnnotationRect(props: {
  readonly rect: PreviewAnnotationRect;
  readonly frame: Pick<PreviewBrowserFrame, "width" | "height">;
  readonly label?: number;
  readonly active?: boolean;
  readonly dashed?: boolean;
  readonly className?: string;
  readonly onSelect?: () => void;
}) {
  const { rect, frame, label, active, dashed, className, onSelect } = props;
  return (
    <button
      type="button"
      tabIndex={-1}
      className={cn(
        "pointer-events-none absolute border-2 border-blue-500 bg-blue-500/[0.08] p-0",
        dashed && "border-dashed",
        active && "ring-2 ring-blue-500/30 ring-offset-1",
        onSelect && "pointer-events-auto",
        className,
      )}
      style={{
        left: `${(rect.x / frame.width) * 100}%`,
        top: `${(rect.y / frame.height) * 100}%`,
        width: `${(rect.width / frame.width) * 100}%`,
        height: `${(rect.height / frame.height) * 100}%`,
      }}
      onClick={(event) => {
        event.stopPropagation();
        onSelect?.();
      }}
      aria-label={label ? `Annotation ${label}` : undefined}
      data-browser-annotation-target
    >
      {label ? (
        <span className="absolute -left-2 -top-2 flex size-5 items-center justify-center rounded-full bg-blue-600 text-[10px] font-semibold text-white shadow-sm">
          {label}
        </span>
      ) : null}
    </button>
  );
}
