import * as React from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { RPC_CHANNELS, type TerminalTab } from '../../../shared/types'

export interface TerminalPaneHandle {
  clear: () => void
}

interface TerminalPaneProps {
  tab: TerminalTab
  active: boolean
}

export const TerminalPane = React.forwardRef<TerminalPaneHandle, TerminalPaneProps>(function TerminalPane(
  { tab, active },
  ref,
) {
  const containerRef = React.useRef<HTMLDivElement | null>(null)
  const terminalRef = React.useRef<Terminal | null>(null)
  const fitAddonRef = React.useRef<FitAddon | null>(null)
  const lastSizeRef = React.useRef<{ cols: number; rows: number } | null>(null)
  const activeRef = React.useRef(active)

  const syncSize = React.useCallback(() => {
    const terminal = terminalRef.current
    const fitAddon = fitAddonRef.current
    if (!terminal || !fitAddon || !window.electronAPI.isChannelAvailable(RPC_CHANNELS.terminal.RESIZE)) return

    fitAddon.fit()
    const nextSize = { cols: terminal.cols, rows: terminal.rows }
    const lastSize = lastSizeRef.current
    if (lastSize && lastSize.cols === nextSize.cols && lastSize.rows === nextSize.rows) return
    lastSizeRef.current = nextSize
    void window.electronAPI.terminal.resize(tab.id, nextSize.cols, nextSize.rows).catch(() => {})
  }, [tab.id])

  React.useEffect(() => {
    activeRef.current = active
  }, [active])

  React.useImperativeHandle(ref, () => ({
    clear: () => terminalRef.current?.clear(),
  }), [])

  React.useEffect(() => {
    const container = containerRef.current
    if (!container) return

    const terminal = new Terminal({
      convertEol: true,
      cursorBlink: true,
      fontFamily: 'JetBrains Mono, monospace',
      fontSize: 12,
      theme: {
        background: '#0f1115',
        foreground: '#e5e7eb',
      },
    })
    const fitAddon = new FitAddon()
    terminal.loadAddon(fitAddon)
    terminal.open(container)
    terminalRef.current = terminal
    fitAddonRef.current = fitAddon

    const dataDisposable = terminal.onData((data) => {
      void window.electronAPI.terminal.write(tab.id, data).catch(() => {})
    })

    const resizeObserver = new ResizeObserver(() => {
      if (activeRef.current) syncSize()
    })
    resizeObserver.observe(container)

    requestAnimationFrame(() => syncSize())

    return () => {
      resizeObserver.disconnect()
      dataDisposable.dispose()
      terminal.dispose()
      terminalRef.current = null
      fitAddonRef.current = null
      lastSizeRef.current = null
    }
  }, [syncSize, tab.id])

  React.useEffect(() => {
    if (!window.electronAPI.isChannelAvailable(RPC_CHANNELS.terminal.DATA)) return

    return window.electronAPI.terminal.onData((event) => {
      if (event.tabId !== tab.id) return
      terminalRef.current?.write(event.data)
    })
  }, [tab.id])

  React.useEffect(() => {
    if (!active) return
    requestAnimationFrame(() => syncSize())
  }, [active, syncSize])

  return <div ref={containerRef} className="h-full w-full overflow-hidden" />
})
