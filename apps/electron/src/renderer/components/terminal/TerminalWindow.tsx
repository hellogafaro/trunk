import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import * as Icons from 'lucide-react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import '@xterm/xterm/css/xterm.css'
import type { TerminalEvent, TerminalSessionDto } from '@craft-agent/shared/protocol'
import { cn } from '@/lib/utils'
import { useTranslation } from 'react-i18next'
import { HeaderIconButton } from '@/components/ui/HeaderIconButton'
import { Button } from '@/components/ui/button'

interface TerminalWindowProps {
  workspaceId: string
}

function terminalTheme() {
  const styles = getComputedStyle(document.documentElement)
  return {
    background: styles.getPropertyValue('--background').trim() || '#111111',
    foreground: styles.getPropertyValue('--foreground').trim() || '#eeeeee',
    cursor: styles.getPropertyValue('--foreground').trim() || '#eeeeee',
    selectionBackground: 'rgba(128, 128, 128, 0.3)',
  }
}

function TerminalViewport({ workspaceId, session }: { workspaceId: string; session: TerminalSessionDto }) {
  const hostRef = useRef<HTMLDivElement>(null)
  const { t } = useTranslation()

  useEffect(() => {
    const host = hostRef.current
    if (!host) return

    const terminal = new Terminal({
      cursorBlink: true,
      fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
      fontSize: 13,
      lineHeight: 1.12,
      scrollback: 5000,
      convertEol: false,
      theme: terminalTheme(),
    })
    const fitAddon = new FitAddon()
    terminal.loadAddon(fitAddon)
    terminal.open(host)

    let disposed = false
    let hydrated = false
    let lastSeq = 0
    const pending: TerminalEvent[] = []

    const applyEvent = (event: TerminalEvent) => {
      if (event.terminalId !== session.id) return
      if (!hydrated) {
        pending.push(event)
        return
      }
      if (event.type === 'data' && event.data && (event.seq ?? 0) > lastSeq) {
        lastSeq = event.seq ?? lastSeq
        terminal.write(event.data)
      } else if (event.type === 'clear') {
        terminal.clear()
      } else if (event.type === 'restart') {
        terminal.reset()
        if (event.session) {
          lastSeq = event.session.seq
          if (event.session.buffer) terminal.write(event.session.buffer)
        }
      }
    }

    const unsubscribe = window.electronAPI.onTerminalEvent(applyEvent)
    const input = terminal.onData((data) => {
      void window.electronAPI.writeTerminal(workspaceId, session.id, data).catch((error) => {
        console.warn('[TerminalWindow] Failed to write terminal input:', error)
      })
    })

    const fit = () => {
      if (disposed || !host.isConnected) return
      try {
        fitAddon.fit()
        if (terminal.cols > 1 && terminal.rows > 1) {
          void window.electronAPI.resizeTerminal(workspaceId, session.id, terminal.cols, terminal.rows)
        }
      } catch {
        // The terminal can be between layout and unmount during tab switches.
      }
    }
    const observer = new ResizeObserver(() => requestAnimationFrame(fit))
    observer.observe(host)

    void window.electronAPI.attachTerminal(workspaceId, session.id)
      .then((snapshot) => {
        if (disposed) return
        lastSeq = snapshot.seq
        terminal.write(snapshot.buffer, () => {
          if (disposed) return
          hydrated = true
          for (const event of pending.splice(0)) applyEvent(event)
          fit()
          terminal.focus()
        })
      })
      .catch((error) => {
        if (!disposed) terminal.writeln(`\r\n${t('terminal.unableToAttach', { error: String(error) })}`)
      })

    requestAnimationFrame(fit)
    return () => {
      disposed = true
      observer.disconnect()
      unsubscribe()
      input.dispose()
      terminal.dispose()
    }
  }, [workspaceId, session.id, t])

  return <div ref={hostRef} className="h-full w-full overflow-hidden px-3 py-2" />
}

export function TerminalWindow({ workspaceId }: TerminalWindowProps) {
  const { t } = useTranslation()
  const [sessions, setSessions] = useState<TerminalSessionDto[]>([])
  const [activeId, setActiveId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const activeSession = useMemo(
    () => sessions.find((session) => session.id === activeId) ?? null,
    [sessions, activeId],
  )

  const openTerminal = useCallback(async () => {
    setError(null)
    const session = await window.electronAPI.openTerminal(workspaceId)
    setSessions((current) => [...current.filter((item) => item.id !== session.id), session])
    setActiveId(session.id)
  }, [workspaceId])

  const closeTerminal = useCallback(async (terminalId: string) => {
    await window.electronAPI.closeTerminal(workspaceId, terminalId)
    setSessions((current) => {
      const index = current.findIndex((item) => item.id === terminalId)
      const next = current.filter((item) => item.id !== terminalId)
      setActiveId((selected) => selected === terminalId
        ? (next[Math.max(0, index - 1)]?.id ?? next[0]?.id ?? null)
        : selected)
      return next
    })
  }, [workspaceId])

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    void window.electronAPI.listTerminals(workspaceId)
      .then(async (existing) => {
        if (cancelled) return
        if (existing.length === 0) {
          await openTerminal()
        } else {
          setSessions(existing)
          setActiveId(existing[0].id)
        }
      })
      .catch((reason) => {
        if (!cancelled) setError(reason instanceof Error ? reason.message : String(reason))
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => { cancelled = true }
  }, [workspaceId, openTerminal])

  useEffect(() => window.electronAPI.onTerminalEvent((event) => {
    if (event.workspaceId !== workspaceId) return
    if (event.type === 'close') {
      setSessions((current) => current.filter((item) => item.id !== event.terminalId))
      return
    }
    if (event.session) {
      setSessions((current) => current.some((item) => item.id === event.terminalId)
        ? current.map((item) => item.id === event.terminalId ? event.session! : item)
        : [...current, event.session!])
    }
  }), [workspaceId])

  return (
    <div className="flex h-full w-full flex-col bg-background text-foreground">
      <header className="flex h-11 shrink-0 items-center border-b border-foreground/10 px-2">
        <div className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto">
          {sessions.map((session) => (
            <div
              key={session.id}
              className={cn(
                'group flex h-8 max-w-52 shrink-0 items-center gap-2 rounded-md px-2.5 text-xs transition-colors',
                session.id === activeId ? 'bg-foreground/10 text-foreground' : 'text-foreground/55 hover:bg-foreground/5',
              )}
            >
              <button
                type="button"
                onClick={() => setActiveId(session.id)}
                className="flex min-w-0 flex-1 items-center gap-2"
              >
                <Icons.Terminal className="h-3.5 w-3.5 shrink-0" />
                <span className="truncate">{session.label}</span>
                {session.status === 'exited' && <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-destructive" />}
              </button>
              <button
                type="button"
                aria-label={t('terminal.close')}
                className="ml-1 flex h-4 w-4 shrink-0 items-center justify-center rounded opacity-0 hover:bg-foreground/10 group-hover:opacity-70"
                onClick={() => { void closeTerminal(session.id) }}
              >
                <Icons.X className="h-3 w-3" />
              </button>
            </div>
          ))}
          <HeaderIconButton
            icon={<Icons.Plus className="h-4 w-4" />}
            onClick={() => { void openTerminal().catch((reason) => setError(String(reason))) }}
            aria-label={t('terminal.new')}
            tooltip={t('terminal.new')}
          />
        </div>

        {activeSession && (
          <div className="ml-3 flex shrink-0 items-center gap-1">
            <HeaderIconButton
              icon={<Icons.Eraser className="h-3.5 w-3.5" />}
              onClick={() => { void window.electronAPI.clearTerminal(workspaceId, activeSession.id) }}
              aria-label={t('terminal.clear')}
              tooltip={t('terminal.clear')}
            />
            <HeaderIconButton
              icon={<Icons.RotateCcw className="h-3.5 w-3.5" />}
              onClick={() => { void window.electronAPI.restartTerminal(workspaceId, activeSession.id) }}
              aria-label={t('terminal.restart')}
              tooltip={t('terminal.restart')}
            />
          </div>
        )}
      </header>

      <main className="relative min-h-0 flex-1">
        {loading ? (
          <div className="flex h-full items-center justify-center text-sm text-foreground/45">{t('terminal.opening')}</div>
        ) : error ? (
          <div className="flex h-full flex-col items-center justify-center gap-3 text-sm text-destructive">
            <p>{error}</p>
            <Button size="sm" variant="outline" onClick={() => window.location.reload()}>{t('terminal.retry')}</Button>
          </div>
        ) : activeSession ? (
          <TerminalViewport key={activeSession.id} workspaceId={workspaceId} session={activeSession} />
        ) : (
          <div className="flex h-full flex-col items-center justify-center gap-3 text-foreground/45">
            <Icons.Terminal className="h-8 w-8" strokeWidth={1.4} />
            <Button size="sm" variant="outline" onClick={() => { void openTerminal() }}>{t('terminal.new')}</Button>
          </div>
        )}
      </main>
    </div>
  )
}
