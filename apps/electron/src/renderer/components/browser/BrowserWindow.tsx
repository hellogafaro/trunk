import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useAtom, useAtomValue } from 'jotai'
import * as Icons from 'lucide-react'
import { BrowserControls, Spinner } from '@craft-agent/ui'
import type { BrowserFrame, BrowserInstanceInfo } from '@craft-agent/shared/protocol'
import { cn } from '@/lib/utils'
import { HeaderIconButton } from '@/components/ui/HeaderIconButton'
import { Button } from '@/components/ui/button'
import {
  activeBrowserInstanceIdAtom,
  browserInstancesAtom,
  filterInstancesForWorkspace,
} from '@/atoms/browser-pane'

interface BrowserWindowProps {
  workspaceId: string
  remoteWorkspaceId?: string | null
}

function displayTitle(instance: BrowserInstanceInfo): string {
  if (instance.title.trim()) return instance.title
  try { return new URL(instance.url).hostname || 'New tab' } catch { return 'New tab' }
}

function browserKey(key: string): string {
  if (key === ' ') return 'Space'
  if (key === 'OS') return 'Meta'
  return key
}

function BrowserViewport({ instance }: { instance: BrowserInstanceInfo }) {
  const hostRef = useRef<HTMLDivElement>(null)
  const resizeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const moveFrameRef = useRef<number | null>(null)
  const latestMoveRef = useRef<{ x: number; y: number } | null>(null)
  const [frame, setFrame] = useState<BrowserFrame | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    setFrame(null)
    setError(null)
    const unsubscribe = window.electronAPI.browserPane.onFrame((next) => {
      if (next.instanceId === instance.id) setFrame(next)
    })
    void window.electronAPI.browserPane.focus(instance.id)
    void window.electronAPI.browserPane.screenshot(instance.id, { format: 'jpeg', jpegQuality: 72 })
      .then((shot) => setFrame({
        instanceId: instance.id,
        data: shot.base64,
        format: shot.imageFormat,
        width: hostRef.current?.clientWidth ?? 1440,
        height: hostRef.current?.clientHeight ?? 900,
        pageScaleFactor: 1,
        timestamp: Date.now(),
      }))
      .catch((reason) => setError(reason instanceof Error ? reason.message : String(reason)))
    return unsubscribe
  }, [instance.id])

  useEffect(() => {
    const host = hostRef.current
    if (!host) return
    const resize = () => {
      if (resizeTimerRef.current) clearTimeout(resizeTimerRef.current)
      resizeTimerRef.current = setTimeout(() => {
        const width = Math.max(320, Math.floor(host.clientWidth))
        const height = Math.max(240, Math.floor(host.clientHeight))
        void window.electronAPI.browserPane.resize(instance.id, width, height).catch(() => {})
      }, 120)
    }
    const observer = new ResizeObserver(resize)
    observer.observe(host)
    resize()
    return () => {
      observer.disconnect()
      if (resizeTimerRef.current) clearTimeout(resizeTimerRef.current)
    }
  }, [instance.id])

  const coordinates = useCallback((event: { clientX: number; clientY: number }) => {
    const rect = hostRef.current?.getBoundingClientRect()
    if (!rect) return { x: 0, y: 0 }
    return {
      x: Math.max(0, Math.min(rect.width, event.clientX - rect.left)),
      y: Math.max(0, Math.min(rect.height, event.clientY - rect.top)),
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

  useEffect(() => () => {
    if (moveFrameRef.current != null) cancelAnimationFrame(moveFrameRef.current)
  }, [])

  return (
    <div
      ref={hostRef}
      role="application"
      aria-label="Browser viewport"
      tabIndex={0}
      className="relative min-h-0 flex-1 overflow-hidden bg-white outline-none"
      onPointerMove={(event) => {
        const point = coordinates(event)
        sendMove(point.x, point.y)
      }}
      onPointerDown={(event) => {
        event.currentTarget.focus()
        event.currentTarget.setPointerCapture(event.pointerId)
        const point = coordinates(event)
        void window.electronAPI.browserPane.pointer(instance.id, {
          kind: 'down', ...point, button: event.button === 2 ? 'right' : event.button === 1 ? 'middle' : 'left',
        })
      }}
      onPointerUp={(event) => {
        const point = coordinates(event)
        void window.electronAPI.browserPane.pointer(instance.id, {
          kind: 'up', ...point, button: event.button === 2 ? 'right' : event.button === 1 ? 'middle' : 'left',
        })
      }}
      onContextMenu={(event) => event.preventDefault()}
      onWheel={(event) => {
        event.preventDefault()
        const point = coordinates(event)
        void window.electronAPI.browserPane.pointer(instance.id, {
          kind: 'wheel', ...point, deltaX: event.deltaX, deltaY: event.deltaY,
        })
      }}
      onKeyDown={(event) => {
        if (event.repeat) return
        event.preventDefault()
        void window.electronAPI.browserPane.keyboard(instance.id, { kind: 'down', key: browserKey(event.key) })
      }}
      onKeyUp={(event) => {
        event.preventDefault()
        void window.electronAPI.browserPane.keyboard(instance.id, { kind: 'up', key: browserKey(event.key) })
      }}
    >
      {frame ? (
        <img
          src={`data:image/${frame.format};base64,${frame.data}`}
          alt=""
          draggable={false}
          className="h-full w-full select-none object-fill"
        />
      ) : error ? (
        <div className="flex h-full flex-col items-center justify-center gap-3 text-sm text-destructive">
          <p>{error}</p>
          <Button size="sm" variant="outline" onClick={() => window.location.reload()}>Retry</Button>
        </div>
      ) : (
        <div className="flex h-full items-center justify-center text-foreground/40"><Spinner /></div>
      )}

      {instance.agentControlActive && (
        <div className="pointer-events-none absolute left-1/2 top-3 -translate-x-1/2 rounded-md bg-neutral-950/90 px-3 py-1.5 text-[11px] font-medium text-white shadow-lg">
          Agent is controlling this browser
        </div>
      )}
    </div>
  )
}

export function BrowserWindow({ workspaceId, remoteWorkspaceId = null }: BrowserWindowProps) {
  const { t } = useTranslation()
  const allInstances = useAtomValue(browserInstancesAtom)
  const instances = useMemo(
    () => filterInstancesForWorkspace(allInstances, workspaceId, remoteWorkspaceId),
    [allInstances, workspaceId, remoteWorkspaceId],
  )
  const [activeId, setActiveId] = useAtom(activeBrowserInstanceIdAtom)
  const [error, setError] = useState<string | null>(null)
  const activeInstance = instances.find((item) => item.id === activeId) ?? instances[0] ?? null

  const openBrowser = useCallback(async () => {
    setError(null)
    const id = await window.electronAPI.browserPane.create({ show: true })
    setActiveId(id)
  }, [setActiveId])

  useEffect(() => {
    if (!activeId && instances[0]) setActiveId(instances[0].id)
  }, [activeId, instances, setActiveId])

  useEffect(() => {
    if (instances.length > 0) return
    void openBrowser().catch((reason) => setError(reason instanceof Error ? reason.message : String(reason)))
  }, [instances.length, openBrowser])

  const selectInstance = useCallback((id: string) => {
    setActiveId(id)
    void window.electronAPI.browserPane.focus(id)
  }, [setActiveId])

  const closeInstance = useCallback(async (id: string) => {
    const index = instances.findIndex((item) => item.id === id)
    await window.electronAPI.browserPane.destroy(id)
    if (activeId === id) {
      const remaining = instances.filter((item) => item.id !== id)
      setActiveId(remaining[Math.max(0, index - 1)]?.id ?? remaining[0]?.id ?? null)
    }
  }, [activeId, instances, setActiveId])

  return (
    <div className="flex h-full w-full flex-col bg-background text-foreground">
      <header className="flex h-11 shrink-0 items-center border-b border-foreground/10 px-2">
        <div className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto">
          {instances.map((instance) => (
            <div
              key={instance.id}
              className={cn(
                'group flex h-8 max-w-56 shrink-0 items-center gap-2 rounded-md px-2.5 text-xs transition-colors',
                instance.id === activeInstance?.id ? 'bg-foreground/10 text-foreground' : 'text-foreground/55 hover:bg-foreground/5',
              )}
            >
              <button type="button" onClick={() => selectInstance(instance.id)} className="flex min-w-0 flex-1 items-center gap-2">
                {instance.isLoading ? <Spinner className="text-[10px]" /> : <Icons.Globe className="h-3.5 w-3.5 shrink-0" />}
                <span className="truncate">{displayTitle(instance)}</span>
              </button>
              <button
                type="button"
                aria-label="Close tab"
                className="ml-1 flex h-4 w-4 shrink-0 items-center justify-center rounded opacity-0 hover:bg-foreground/10 group-hover:opacity-70"
                onClick={() => { void closeInstance(instance.id) }}
              >
                <Icons.X className="h-3 w-3" />
              </button>
            </div>
          ))}
          <HeaderIconButton
            icon={<Icons.Plus className="h-4 w-4" />}
            onClick={() => { void openBrowser().catch((reason) => setError(String(reason))) }}
            aria-label="New browser tab"
            tooltip="New browser tab"
          />
        </div>
      </header>

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
          showProgressBar
          className="h-auto shrink-0 border-b border-border bg-background/80 px-2 py-1.5"
        />
      )}

      {error && <div className="shrink-0 border-b border-destructive/20 bg-destructive/5 px-3 py-2 text-xs text-destructive">{error}</div>}
      {activeInstance ? (
        <BrowserViewport key={activeInstance.id} instance={activeInstance} />
      ) : (
        <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 text-foreground/45">
          <Icons.Globe className="h-8 w-8" strokeWidth={1.4} />
          <Button size="sm" variant="outline" onClick={() => { void openBrowser() }}>{t('browser.newTab')}</Button>
        </div>
      )}
    </div>
  )
}
