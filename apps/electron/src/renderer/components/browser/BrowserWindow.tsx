import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useAtom, useAtomValue } from 'jotai'
import * as Icons from 'lucide-react'
import {
  BrowserControls,
  BrowserEmptyStateCard,
  Spinner,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@craft-agent/ui'
import type { BrowserElementInfo, BrowserFrame, BrowserInstanceInfo, FileAttachment } from '@craft-agent/shared/protocol'
import { cn } from '@/lib/utils'
import { HeaderIconButton } from '@/components/ui/HeaderIconButton'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import {
  activeBrowserInstanceIdAtom,
  browserInstancesAtom,
  filterInstancesForWorkspace,
} from '@/atoms/browser-pane'
import {
  mapBrowserPointer,
  normalizeBrowserAnnotationRegion,
  resolveBrowserAnnotationDraftRect,
  resolveBrowserFrameSize,
  resolveBrowserViewportSize,
  type BrowserAnnotationDraftRect,
  type BrowserAnnotationRegion,
  type BrowserViewportMode,
} from './browser-viewport'

interface BrowserWindowProps {
  workspaceId: string
  remoteWorkspaceId?: string | null
  sessionId?: string | null
}

interface BrowserAnnotationEventDetail {
  sessionId: string
  attachment: FileAttachment
  text: string
}

interface BrowserAnnotationComment extends BrowserAnnotationRegion {
  target: 'element' | 'area'
  element?: BrowserElementInfo
}

interface BrowserViewportProps {
  instance: BrowserInstanceInfo
  mode: BrowserViewportMode
  annotationActive: boolean
  onCancelAnnotation: () => void
  onCompleteAnnotation: (attachment: FileAttachment, text: string) => void
}

function browserKey(key: string): string {
  if (key === ' ') return 'Space'
  if (key === 'OS') return 'Meta'
  return key
}

function getExternalUrl(url: string): string | null {
  try {
    const parsed = new URL(url)
    return parsed.protocol === 'http:' || parsed.protocol === 'https:' ? url : null
  } catch {
    return null
  }
}

async function createAnnotatedAttachment(
  frame: BrowserFrame,
  regions: BrowserAnnotationComment[],
  url: string,
): Promise<{ attachment: FileAttachment; text: string }> {
  const image = new Image()
  image.src = `data:image/${frame.format};base64,${frame.data}`
  await new Promise<void>((resolve, reject) => {
    image.onload = () => resolve()
    image.onerror = () => reject(new Error('Failed to load browser frame for annotation'))
  })

  const canvas = document.createElement('canvas')
  canvas.width = frame.width
  canvas.height = frame.height
  const context = canvas.getContext('2d')
  if (!context) throw new Error('Canvas is unavailable')
  context.drawImage(image, 0, 0, frame.width, frame.height)

  const lineWidth = Math.max(3, Math.round(frame.width / 420))
  const badgeRadius = Math.max(13, Math.round(frame.width / 55))
  context.lineWidth = lineWidth
  context.strokeStyle = '#2563eb'
  context.fillStyle = '#2563eb'
  context.font = `600 ${Math.max(13, Math.round(badgeRadius * 0.95))}px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif`
  context.textAlign = 'center'
  context.textBaseline = 'middle'

  regions.forEach((region, index) => {
    const x = region.x * frame.width
    const y = region.y * frame.height
    const width = region.width * frame.width
    const height = region.height * frame.height
    context.strokeRect(x, y, width, height)
    const badgeX = Math.max(badgeRadius + 2, x)
    const badgeY = Math.max(badgeRadius + 2, y)
    context.beginPath()
    context.arc(badgeX, badgeY, badgeRadius, 0, Math.PI * 2)
    context.fill()
    context.fillStyle = '#ffffff'
    context.fillText(String(index + 1), badgeX, badgeY + 0.5)
    context.fillStyle = '#2563eb'
  })

  const dataUrl = canvas.toDataURL('image/png')
  const base64 = dataUrl.slice(dataUrl.indexOf(',') + 1)
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
  const name = `browser-annotation-${timestamp}.png`
  const notes = regions.map((region, index) => {
    const note = region.note.trim() || 'Highlighted area'
    if (!region.element) return `${index + 1}. ${note}\n   Target: selected area`
    const component = region.element.componentPath.length > 0
      ? region.element.componentPath.join(' > ')
      : region.element.componentName
    const label = region.element.label || region.element.text?.slice(0, 80)
    const target = [
      component,
      `<${region.element.tagName}>${label ? ` “${label}”` : ''}`,
      region.element.selector,
    ].filter(Boolean).join(' · ')
    return `${index + 1}. ${note}\n   Target: ${target}`
  })

  return {
    attachment: {
      type: 'image',
      path: name,
      name,
      mimeType: 'image/png',
      base64,
      size: Math.ceil(base64.length * 0.75),
    },
    text: [`Browser annotation for ${url}`, ...notes].join('\n'),
  }
}

function annotationRegionForElement(
  element: BrowserElementInfo,
  frame: BrowserFrame,
): Omit<BrowserAnnotationComment, 'note'> {
  const left = Math.max(0, Math.min(frame.width, element.rect.x))
  const top = Math.max(0, Math.min(frame.height, element.rect.y))
  const right = Math.max(left, Math.min(frame.width, element.rect.x + element.rect.width))
  const bottom = Math.max(top, Math.min(frame.height, element.rect.y + element.rect.height))
  return {
    target: 'element',
    element,
    x: left / frame.width,
    y: top / frame.height,
    width: Math.max(1, right - left) / frame.width,
    height: Math.max(1, bottom - top) / frame.height,
  }
}

function ViewportModeToggle({
  value,
  onChange,
}: {
  value: BrowserViewportMode
  onChange: (mode: BrowserViewportMode) => void
}) {
  const { t } = useTranslation()
  const options: Array<{ value: BrowserViewportMode; label: string; icon: typeof Icons.Monitor }> = [
    { value: 'responsive', label: t('browser.viewportResponsive'), icon: Icons.Maximize2 },
    { value: 'desktop', label: t('browser.viewportDesktop'), icon: Icons.Monitor },
    { value: 'tablet', label: t('browser.viewportTablet'), icon: Icons.Tablet },
    { value: 'mobile', label: t('browser.viewportMobile'), icon: Icons.Smartphone },
  ]

  return (
    <div
      role="radiogroup"
      aria-label={t('browser.viewport')}
      className="inline-flex items-center gap-0.5 rounded-lg border border-border/60 bg-foreground/[0.02] p-0.5"
    >
      {options.map((option) => {
        const Icon = option.icon
        const active = option.value === value
        return (
          <HeaderIconButton
            key={option.value}
            icon={<Icon className="h-3.5 w-3.5" strokeWidth={1.8} />}
            role="radio"
            aria-checked={active}
            aria-label={option.label}
            tooltip={option.label}
            onClick={() => onChange(option.value)}
            className={cn(
              'h-6 w-6 rounded-md',
              active
                ? 'bg-card text-foreground shadow-minimal'
                : 'text-foreground/45 hover:text-foreground/80',
            )}
          />
        )
      })}
    </div>
  )
}

function BrowserViewport({
  instance,
  mode,
  annotationActive,
  onCancelAnnotation,
  onCompleteAnnotation,
}: BrowserViewportProps) {
  const { t } = useTranslation()
  const hostRef = useRef<HTMLDivElement>(null)
  const surfaceRef = useRef<HTMLDivElement>(null)
  const latestFrameRef = useRef<BrowserFrame | null>(null)
  const resizeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const moveFrameRef = useRef<number | null>(null)
  const inspectionTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const inspectionSequenceRef = useRef(0)
  const latestMoveRef = useRef<{ x: number; y: number } | null>(null)
  const dragOriginRef = useRef<{ x: number; y: number } | null>(null)
  const [hostSize, setHostSize] = useState({ width: 0, height: 0 })
  const [frame, setFrame] = useState<BrowserFrame | null>(null)
  const [frozenFrame, setFrozenFrame] = useState<BrowserFrame | null>(null)
  const [regions, setRegions] = useState<BrowserAnnotationComment[]>([])
  const [activeRegionIndex, setActiveRegionIndex] = useState<number | null>(null)
  const [hoveredElement, setHoveredElement] = useState<BrowserElementInfo | null>(null)
  const [elementStack, setElementStack] = useState<BrowserElementInfo[]>([])
  const [elementStackIndex, setElementStackIndex] = useState(0)
  const [draftRect, setDraftRect] = useState<BrowserAnnotationDraftRect | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    latestFrameRef.current = frame
    if (annotationActive && !frozenFrame && frame) setFrozenFrame(frame)
  }, [annotationActive, frame, frozenFrame])

  useEffect(() => {
    if (annotationActive) {
      setFrozenFrame(latestFrameRef.current)
      setRegions([])
      setActiveRegionIndex(null)
      setHoveredElement(null)
      setElementStack([])
      setElementStackIndex(0)
      setDraftRect(null)
      dragOriginRef.current = null
    } else {
      setFrozenFrame(null)
      setHoveredElement(null)
    }
  }, [annotationActive])

  useEffect(() => {
    setFrame(null)
    setFrozenFrame(null)
    setError(null)
    const unsubscribe = window.electronAPI.browserPane.onFrame((next) => {
      if (next.instanceId === instance.id) setFrame(next)
    })

    const host = hostRef.current
    const initialSize = resolveBrowserViewportSize(
      mode,
      host?.clientWidth ?? 1280,
      host?.clientHeight ?? 800,
    )
    void window.electronAPI.browserPane.focus(instance.id)
    void window.electronAPI.browserPane.resize(instance.id, initialSize.width, initialSize.height)
      .then((applied) => window.electronAPI.browserPane.screenshot(instance.id, { format: 'jpeg', jpegQuality: 80 })
        .then((shot) => setFrame({
          instanceId: instance.id,
          data: shot.base64,
          format: shot.imageFormat,
          width: applied.width,
          height: applied.height,
          pageScaleFactor: 1,
          timestamp: Date.now(),
        })))
      .catch((reason) => setError(reason instanceof Error ? reason.message : String(reason)))

    return unsubscribe
  }, [instance.id, mode])

  useEffect(() => {
    const host = hostRef.current
    if (!host) return
    const resize = () => {
      const nextHostSize = {
        width: Math.max(0, Math.floor(host.clientWidth)),
        height: Math.max(0, Math.floor(host.clientHeight)),
      }
      setHostSize(nextHostSize)
      if (resizeTimerRef.current) clearTimeout(resizeTimerRef.current)
      resizeTimerRef.current = setTimeout(() => {
        const viewport = resolveBrowserViewportSize(mode, nextHostSize.width, nextHostSize.height)
        void window.electronAPI.browserPane.resize(instance.id, viewport.width, viewport.height).catch(() => {})
      }, 120)
    }
    const observer = new ResizeObserver(resize)
    observer.observe(host)
    resize()
    return () => {
      observer.disconnect()
      if (resizeTimerRef.current) clearTimeout(resizeTimerRef.current)
    }
  }, [instance.id, mode])

  useEffect(() => () => {
    if (moveFrameRef.current != null) cancelAnimationFrame(moveFrameRef.current)
    if (inspectionTimerRef.current) clearTimeout(inspectionTimerRef.current)
  }, [])

  const displayFrame = frozenFrame ?? frame
  const showEmptyState = instance.url === 'about:blank' && !annotationActive
  const displaySize = displayFrame
    ? resolveBrowserFrameSize(hostSize.width, hostSize.height, displayFrame.width, displayFrame.height)
    : hostSize

  const browserCoordinates = useCallback((event: { clientX: number; clientY: number }) => {
    const rect = surfaceRef.current?.getBoundingClientRect()
    const currentFrame = displayFrame
    if (!rect || !currentFrame) return { x: 0, y: 0 }
    return mapBrowserPointer(event.clientX, event.clientY, rect, currentFrame.width, currentFrame.height)
  }, [displayFrame])

  const annotationCoordinates = useCallback((event: { clientX: number; clientY: number }) => {
    const rect = surfaceRef.current?.getBoundingClientRect()
    if (!rect) return { x: 0, y: 0, width: 0, height: 0 }
    return {
      x: Math.max(0, Math.min(rect.width, event.clientX - rect.left)),
      y: Math.max(0, Math.min(rect.height, event.clientY - rect.top)),
      width: rect.width,
      height: rect.height,
    }
  }, [])

  const sendMove = useCallback((x: number, y: number) => {
    latestMoveRef.current = { x, y }
    if (moveFrameRef.current != null) return
    moveFrameRef.current = requestAnimationFrame(() => {
      moveFrameRef.current = null
      const point = latestMoveRef.current
      if (point) void window.electronAPI.browserPane.pointer(instance.id, { kind: 'move', ...point })
    })
  }, [instance.id])

  const updateDraftRect = useCallback((point: { x: number; y: number }) => {
    const origin = dragOriginRef.current
    if (!origin) return
    setDraftRect(resolveBrowserAnnotationDraftRect(origin.x, origin.y, point.x, point.y))
  }, [])

  const queueElementInspection = useCallback((point: { x: number; y: number }) => {
    if (inspectionTimerRef.current) clearTimeout(inspectionTimerRef.current)
    const sequence = ++inspectionSequenceRef.current
    inspectionTimerRef.current = setTimeout(() => {
      void window.electronAPI.browserPane.elementsAt(instance.id, point.x, point.y)
        .then((elements) => {
          if (sequence === inspectionSequenceRef.current) setHoveredElement(elements[0] ?? null)
        })
        .catch(() => {
          if (sequence === inspectionSequenceRef.current) setHoveredElement(null)
        })
    }, 45)
  }, [instance.id])

  const finishAnnotationRegion = useCallback(async (event: { clientX: number; clientY: number }) => {
    const origin = dragOriginRef.current
    const point = annotationCoordinates(event)
    dragOriginRef.current = null
    setDraftRect(null)
    if (!origin) return
    const normalized = normalizeBrowserAnnotationRegion(
      origin.x,
      origin.y,
      point.x,
      point.y,
      point.width,
      point.height,
    )
    if (normalized) {
      setElementStack([])
      setElementStackIndex(0)
      setRegions((current) => {
        const next = [...current, { ...normalized, target: 'area' as const, note: '' }]
        setActiveRegionIndex(next.length - 1)
        return next
      })
      return
    }

    if (!displayFrame) return
    const browserPoint = browserCoordinates(event)
    try {
      const stack = await window.electronAPI.browserPane.elementsAt(instance.id, browserPoint.x, browserPoint.y)
      const element = stack[0]
      if (!element) return
      setElementStack(stack)
      setElementStackIndex(0)
      setHoveredElement(null)
      setRegions((current) => {
        const next = [
          ...current,
          { ...annotationRegionForElement(element, displayFrame), note: '' },
        ]
        setActiveRegionIndex(next.length - 1)
        return next
      })
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason))
    }
  }, [annotationCoordinates, browserCoordinates, displayFrame, instance.id])

  const selectElementStackIndex = useCallback((nextIndex: number) => {
    if (!displayFrame || activeRegionIndex == null) return
    const element = elementStack[nextIndex]
    if (!element) return
    setElementStackIndex(nextIndex)
    setRegions((current) => current.map((region, index) => (
      index === activeRegionIndex
        ? { ...annotationRegionForElement(element, displayFrame), note: region.note }
        : region
    )))
  }, [activeRegionIndex, displayFrame, elementStack])

  const handleAddToChat = useCallback(async () => {
    const completedRegions = regions.filter((region) => region.note.trim())
    if (!displayFrame || completedRegions.length === 0) return
    try {
      const result = await createAnnotatedAttachment(displayFrame, completedRegions, instance.url)
      onCompleteAnnotation(result.attachment, result.text)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason))
    }
  }, [displayFrame, instance.url, onCompleteAnnotation, regions])

  const completedCommentCount = regions.filter((region) => region.note.trim()).length
  const activeRegion = activeRegionIndex == null ? null : (regions[activeRegionIndex] ?? null)
  const activePopoverPosition = activeRegion
    ? {
        left: Math.max(8, Math.min(displaySize.width - 328, (activeRegion.x + activeRegion.width) * displaySize.width + 12)),
        top: Math.max(8, Math.min(displaySize.height - 190, activeRegion.y * displaySize.height)),
      }
    : null

  return (
    <div
      ref={hostRef}
      className="relative flex min-h-0 flex-1 items-center justify-center overflow-hidden bg-foreground/[0.035]"
    >
      {showEmptyState ? (
        <BrowserEmptyStateCard
          title={t('browser.readyTitle')}
          description={t('browser.readyDescription')}
          showExamplePrompts={false}
          showSafetyHint={false}
        />
      ) : displayFrame ? (
        <div
          ref={surfaceRef}
          role="application"
          aria-label={t('browser.viewport')}
          tabIndex={0}
          className={cn(
            'relative shrink-0 overflow-hidden bg-white outline-none shadow-minimal',
            annotationActive && 'cursor-crosshair select-none',
          )}
          style={{ width: displaySize.width, height: displaySize.height }}
          onPointerMove={(event) => {
            if (annotationActive) {
              if (dragOriginRef.current) {
                setHoveredElement(null)
                updateDraftRect(annotationCoordinates(event))
              } else {
                queueElementInspection(browserCoordinates(event))
              }
              return
            }
            const point = browserCoordinates(event)
            sendMove(point.x, point.y)
          }}
          onPointerDown={(event) => {
            event.currentTarget.focus()
            event.currentTarget.setPointerCapture(event.pointerId)
            if (annotationActive) {
              if (inspectionTimerRef.current) clearTimeout(inspectionTimerRef.current)
              setHoveredElement(null)
              const point = annotationCoordinates(event)
              dragOriginRef.current = { x: point.x, y: point.y }
              setDraftRect(resolveBrowserAnnotationDraftRect(point.x, point.y, point.x, point.y))
              return
            }
            const point = browserCoordinates(event)
            void window.electronAPI.browserPane.pointer(instance.id, {
              kind: 'down',
              ...point,
              button: event.button === 2 ? 'right' : event.button === 1 ? 'middle' : 'left',
            })
          }}
          onPointerUp={(event) => {
            if (annotationActive) {
              void finishAnnotationRegion(event)
              return
            }
            const point = browserCoordinates(event)
            void window.electronAPI.browserPane.pointer(instance.id, {
              kind: 'up',
              ...point,
              button: event.button === 2 ? 'right' : event.button === 1 ? 'middle' : 'left',
            })
          }}
          onPointerCancel={() => {
            dragOriginRef.current = null
            setDraftRect(null)
          }}
          onContextMenu={(event) => event.preventDefault()}
          onWheel={(event) => {
            event.preventDefault()
            if (annotationActive) return
            const point = browserCoordinates(event)
            void window.electronAPI.browserPane.pointer(instance.id, {
              kind: 'wheel', ...point, deltaX: event.deltaX, deltaY: event.deltaY,
            })
          }}
          onKeyDown={(event) => {
            if (annotationActive || event.repeat) return
            event.preventDefault()
            void window.electronAPI.browserPane.keyboard(instance.id, { kind: 'down', key: browserKey(event.key) })
          }}
          onKeyUp={(event) => {
            if (annotationActive) return
            event.preventDefault()
            void window.electronAPI.browserPane.keyboard(instance.id, { kind: 'up', key: browserKey(event.key) })
          }}
        >
          <img
            src={`data:image/${displayFrame.format};base64,${displayFrame.data}`}
            alt=""
            draggable={false}
            className="pointer-events-none h-full w-full select-none"
          />

          {annotationActive && (
            <div className="absolute inset-0 z-10">
              {hoveredElement && !draftRect && (() => {
                const hover = annotationRegionForElement(hoveredElement, displayFrame)
                const hoverLabel = hoveredElement.componentName || `<${hoveredElement.tagName}>`
                return (
                  <div
                    className="pointer-events-none absolute border border-blue-500 bg-blue-500/[0.07] ring-1 ring-inset ring-white/70"
                    style={{
                      left: `${hover.x * 100}%`,
                      top: `${hover.y * 100}%`,
                      width: `${hover.width * 100}%`,
                      height: `${hover.height * 100}%`,
                    }}
                  >
                    <span className="absolute -top-6 left-0 max-w-[260px] truncate rounded bg-blue-600 px-1.5 py-0.5 text-[10px] font-medium text-white shadow-minimal">
                      {hoverLabel} · {Math.round(hoveredElement.rect.width)} × {Math.round(hoveredElement.rect.height)}
                    </span>
                  </div>
                )
              })()}

              {regions.map((region, index) => (
                <div key={`${region.x}:${region.y}:${index}`}>
                  <div
                    className={cn(
                      'pointer-events-none absolute border-2 border-blue-600 bg-blue-500/[0.08]',
                      region.target === 'area' && 'border-dashed',
                      activeRegionIndex === index && 'ring-2 ring-white/80',
                    )}
                    style={{
                      left: `${region.x * 100}%`,
                      top: `${region.y * 100}%`,
                      width: `${region.width * 100}%`,
                      height: `${region.height * 100}%`,
                    }}
                  />
                  <Button
                    type="button"
                    size="icon"
                    aria-label={`${t('browser.annotationRegion')} ${index + 1}`}
                    onPointerDown={(event) => event.stopPropagation()}
                    onClick={(event) => {
                      event.stopPropagation()
                      setElementStack([])
                      setElementStackIndex(0)
                      setActiveRegionIndex(index)
                    }}
                    className="absolute z-20 size-6 min-w-6 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white px-1 text-[11px] shadow-strong focus-visible:ring-offset-2"
                    style={{ left: `${region.x * 100}%`, top: `${region.y * 100}%` }}
                  >
                    {index + 1}
                  </Button>
                </div>
              ))}
              {draftRect && (
                <div
                  className="pointer-events-none absolute border-2 border-dashed border-blue-500 bg-blue-500/10"
                  style={draftRect}
                />
              )}
              {regions.length === 0 && !draftRect && !hoveredElement && (
                <div className="pointer-events-none absolute left-1/2 top-4 -translate-x-1/2 rounded-lg bg-neutral-950/85 px-3 py-2 text-xs font-medium text-white shadow-strong">
                  {t('browser.annotationHint')}
                </div>
              )}

              {activeRegion && activePopoverPosition && (
                <div
                  className="absolute z-30 w-80 overflow-hidden rounded-xl border border-border/60 bg-background/95 shadow-strong backdrop-blur-xl"
                  style={activePopoverPosition}
                  onPointerDown={(event) => event.stopPropagation()}
                  onClick={(event) => event.stopPropagation()}
                >
                  <div className="flex min-w-0 items-center gap-2 border-b border-border/50 px-3 py-2">
                    <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-blue-600 px-1 text-[10px] font-semibold text-white">
                      {activeRegionIndex! + 1}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-[11px] font-medium text-foreground/80">
                        {activeRegion.element?.componentName || (activeRegion.element ? `<${activeRegion.element.tagName}>` : t('browser.annotationArea'))}
                      </div>
                      <div className="truncate font-mono text-[10px] text-foreground/40">
                        {activeRegion.element?.selector || t('browser.annotationSelectedArea')}
                      </div>
                    </div>
                    {activeRegion.element && elementStack.length > 1 && (
                      <div className="flex items-center gap-0.5">
                        <HeaderIconButton
                          icon={<Icons.ChevronDown className="h-3.5 w-3.5" />}
                          disabled={elementStackIndex === 0}
                          aria-label={t('browser.annotationSelectChild')}
                          tooltip={t('browser.annotationSelectChild')}
                          onClick={() => selectElementStackIndex(elementStackIndex - 1)}
                          className="h-6 w-6 rounded-md text-foreground/45 disabled:opacity-25"
                        />
                        <HeaderIconButton
                          icon={<Icons.ChevronUp className="h-3.5 w-3.5" />}
                          disabled={elementStackIndex >= elementStack.length - 1}
                          aria-label={t('browser.annotationSelectParent')}
                          tooltip={t('browser.annotationSelectParent')}
                          onClick={() => selectElementStackIndex(elementStackIndex + 1)}
                          className="h-6 w-6 rounded-md text-foreground/45 disabled:opacity-25"
                        />
                      </div>
                    )}
                  </div>
                  <Textarea
                    autoFocus
                    value={activeRegion.note}
                    onChange={(event) => {
                      const note = event.target.value
                      setRegions((current) => current.map((region, index) => (
                        index === activeRegionIndex ? { ...region, note } : region
                      )))
                    }}
                    onKeyDown={(event) => {
                      event.stopPropagation()
                      if (event.key === 'Escape') setActiveRegionIndex(null)
                      if (event.key === 'Enter' && (event.metaKey || event.ctrlKey) && activeRegion.note.trim()) {
                        setActiveRegionIndex(null)
                      }
                    }}
                    placeholder={t('browser.annotationPlaceholder')}
                    className="min-h-24 resize-none rounded-none border-0 bg-transparent px-3 py-2.5 text-xs leading-relaxed text-foreground shadow-none placeholder:text-foreground/35 focus-visible:border-transparent focus-visible:ring-0 md:text-xs"
                  />
                  <div className="flex items-center justify-between border-t border-border/50 px-2 py-1.5">
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      className="text-destructive hover:text-destructive"
                      onClick={() => {
                        setRegions((current) => current.filter((_, index) => index !== activeRegionIndex))
                        setActiveRegionIndex(null)
                      }}
                    >
                      {t('common.delete')}
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      disabled={!activeRegion.note.trim()}
                      onClick={() => setActiveRegionIndex(null)}
                    >
                      {t('common.done')}
                    </Button>
                  </div>
                </div>
              )}

              <div
                className="absolute bottom-3 left-1/2 z-20 flex -translate-x-1/2 items-center gap-1 rounded-xl border border-border/60 bg-background/90 p-1.5 shadow-strong backdrop-blur-xl"
                onPointerDown={(event) => event.stopPropagation()}
                onClick={(event) => event.stopPropagation()}
              >
                <div className="flex items-center gap-1.5 px-2 text-[11px] font-medium text-foreground/55">
                  <Icons.MessageSquare className="h-3.5 w-3.5" />
                  {completedCommentCount} {t('browser.annotationComments')}
                </div>
                <div className="mx-0.5 h-5 w-px bg-border/60" />
                <Button type="button" size="sm" variant="ghost" onClick={onCancelAnnotation}>
                  {t('common.cancel')}
                </Button>
                <Button type="button" size="sm" disabled={completedCommentCount === 0} onClick={() => { void handleAddToChat() }}>
                  {t('browser.annotationAddToChat')}
                </Button>
              </div>
            </div>
          )}

          {instance.agentControlActive && !annotationActive && (
            <div className="pointer-events-none absolute left-1/2 top-3 -translate-x-1/2 rounded-md bg-neutral-950/90 px-3 py-1.5 text-[11px] font-medium text-white shadow-strong">
              {t('browser.agentControlling')}
            </div>
          )}
        </div>
      ) : error ? (
        <div className="flex h-full flex-col items-center justify-center gap-3 text-sm text-destructive">
          <p>{error}</p>
          <Button size="sm" variant="outline" onClick={() => window.location.reload()}>{t('common.retry')}</Button>
        </div>
      ) : (
        <div className="flex h-full items-center justify-center text-foreground/40"><Spinner /></div>
      )}
      {error && displayFrame && (
        <div className="absolute left-1/2 top-3 z-30 -translate-x-1/2 rounded-md bg-destructive px-3 py-1.5 text-xs text-destructive-foreground shadow-strong">
          {error}
        </div>
      )}
    </div>
  )
}

export function BrowserWindow({ workspaceId, remoteWorkspaceId = null, sessionId = null }: BrowserWindowProps) {
  const { t } = useTranslation()
  const allInstances = useAtomValue(browserInstancesAtom)
  const instances = useMemo(
    () => filterInstancesForWorkspace(allInstances, workspaceId, remoteWorkspaceId),
    [allInstances, workspaceId, remoteWorkspaceId],
  )
  const [activeId, setActiveId] = useAtom(activeBrowserInstanceIdAtom)
  const [error, setError] = useState<string | null>(null)
  const [annotationActive, setAnnotationActive] = useState(false)
  const [viewportModes, setViewportModes] = useState<Record<string, BrowserViewportMode>>({})
  const activeInstance = instances.find((item) => item.id === activeId) ?? instances.at(-1) ?? null
  const viewportMode = activeInstance ? (viewportModes[activeInstance.id] ?? 'responsive') : 'responsive'
  const externalUrl = activeInstance ? getExternalUrl(activeInstance.url) : null

  const openBrowser = useCallback(async () => {
    setError(null)
    const id = activeInstance?.id ?? await window.electronAPI.browserPane.create({ show: true })
    setActiveId(id)
    await window.electronAPI.browserPane.focus(id)
  }, [activeInstance?.id, setActiveId])

  useEffect(() => {
    if (!activeId && instances.length > 0) setActiveId(instances.at(-1)?.id ?? null)
  }, [activeId, instances, setActiveId])

  useEffect(() => {
    if (instances.length > 0) return
    void openBrowser().catch((reason) => setError(reason instanceof Error ? reason.message : String(reason)))
  }, [instances.length, openBrowser])

  useEffect(() => {
    setAnnotationActive(false)
  }, [activeInstance?.id])

  const handleAnnotationComplete = useCallback((attachment: FileAttachment, text: string) => {
    if (!sessionId) return
    window.dispatchEvent(new CustomEvent<BrowserAnnotationEventDetail>('craft:add-browser-annotation', {
      detail: { sessionId, attachment, text },
    }))
    setAnnotationActive(false)
  }, [sessionId])

  return (
    <div className="flex h-full w-full flex-col bg-background text-foreground">
      {activeInstance && (
        <BrowserControls
          url={activeInstance.url}
          loading={activeInstance.isLoading}
          canGoBack={activeInstance.canGoBack}
          canGoForward={activeInstance.canGoForward}
          onNavigate={(url) => { void window.electronAPI.browserPane.navigate(activeInstance.id, url).catch((reason) => setError(String(reason))) }}
          onGoBack={() => { void window.electronAPI.browserPane.goBack(activeInstance.id) }}
          onGoForward={() => { void window.electronAPI.browserPane.goForward(activeInstance.id) }}
          onReload={() => { void window.electronAPI.browserPane.reload(activeInstance.id) }}
          onStop={() => { void window.electronAPI.browserPane.stop(activeInstance.id) }}
          trailingContent={(
            <div className="ml-2 flex shrink-0 items-center gap-1.5">
              <ViewportModeToggle
                value={viewportMode}
                onChange={(mode) => {
                  setAnnotationActive(false)
                  setViewportModes((current) => ({ ...current, [activeInstance.id]: mode }))
                }}
              />
              <HeaderIconButton
                icon={<Icons.ScanLine className="h-3.5 w-3.5" />}
                aria-label={t('browser.annotate')}
                tooltip={sessionId ? t('browser.annotate') : t('browser.annotationNeedsSession')}
                disabled={!sessionId}
                className={annotationActive ? 'bg-foreground/5 text-foreground' : undefined}
                onClick={() => setAnnotationActive((active) => !active)}
              />
              {externalUrl ? (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      asChild
                      size="icon"
                      variant="ghost"
                      className="header-icon-btn h-7 w-7 shrink-0 rounded-[4px] text-muted-foreground hover:text-foreground [&_svg]:size-3.5"
                    >
                      <a
                        href={externalUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        aria-label={t('browser.openInNewTab')}
                      >
                        <Icons.ExternalLink />
                      </a>
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>{t('browser.openInNewTab')}</TooltipContent>
                </Tooltip>
              ) : (
                <HeaderIconButton
                  icon={<Icons.ExternalLink className="h-3.5 w-3.5" />}
                  aria-label={t('browser.openInNewTab')}
                  tooltip={t('browser.openInNewTab')}
                  disabled
                />
              )}
            </div>
          )}
          showProgressBar
          className="h-auto shrink-0 border-b border-border bg-background/80 px-2 py-1.5"
        />
      )}

      {error && <div className="shrink-0 border-b border-destructive/20 bg-destructive/5 px-3 py-2 text-xs text-destructive">{error}</div>}
      {activeInstance ? (
        <BrowserViewport
          key={activeInstance.id}
          instance={activeInstance}
          mode={viewportMode}
          annotationActive={annotationActive}
          onCancelAnnotation={() => setAnnotationActive(false)}
          onCompleteAnnotation={handleAnnotationComplete}
        />
      ) : (
        <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 text-foreground/45">
          <Icons.Globe className="h-8 w-8" strokeWidth={1.4} />
          <Button size="sm" variant="outline" onClick={() => { void openBrowser() }}>{t('browser.openBrowser')}</Button>
        </div>
      )}
    </div>
  )
}
