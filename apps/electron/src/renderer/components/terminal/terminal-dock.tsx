import * as React from 'react'
import '@xterm/xterm/css/xterm.css'
import { Eraser, Plus, X } from 'lucide-react'
import type { TerminalTab } from '../../../shared/types'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { TerminalPane, type TerminalPaneHandle } from './terminal-pane'

interface TerminalDockProps {
  sessionId: string
  visible: boolean
  tabs: TerminalTab[]
  activeTabId: string | null
  onSelectTab: (tabId: string) => void
  onNewTab: () => void
  onCloseTab: (tabId: string) => void
  onCloseDock: () => void
}

export function TerminalDock({
  sessionId,
  visible,
  tabs,
  activeTabId,
  onSelectTab,
  onNewTab,
  onCloseTab,
  onCloseDock,
}: TerminalDockProps) {
  const paneRefs = React.useRef(new Map<string, TerminalPaneHandle | null>())
  const activeTab = tabs.find((tab) => tab.id === activeTabId) ?? tabs[0] ?? null

  const handleClear = React.useCallback(() => {
    if (!activeTab) return
    paneRefs.current.get(activeTab.id)?.clear()
  }, [activeTab])

  return (
    <div className="shrink-0 h-[260px] min-h-0 overflow-hidden">
      <div className="h-full flex flex-col">
        <div className="h-[42px] shrink-0 flex items-center gap-2 px-3 border-b border-foreground/10 bg-background/70">
          <div className="min-w-0 flex-1 flex items-center gap-1 overflow-x-auto">
            {tabs.map((tab) => {
              const isActive = tab.id === activeTab?.id
              return (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => onSelectTab(tab.id)}
                  className={cn(
                    'group h-8 shrink-0 inline-flex items-center gap-2 rounded-[6px] px-2 text-xs shadow-minimal',
                    isActive ? 'bg-background text-foreground' : 'bg-background/40 text-muted-foreground hover:text-foreground',
                  )}
                >
                  <span className="truncate max-w-[160px]">{tab.title}</span>
                  <span className="truncate max-w-[200px] text-[11px] opacity-60">{tab.cwd}</span>
                  <span
                    role="button"
                    tabIndex={-1}
                    onClick={(event) => {
                      event.stopPropagation()
                      onCloseTab(tab.id)
                    }}
                    className="opacity-60 hover:opacity-100"
                  >
                    <X className="h-3 w-3" />
                  </span>
                </button>
              )
            })}
          </div>
          <div className="shrink-0 flex items-center gap-1">
            <Button type="button" variant="ghost" size="icon" className="h-8 w-8" onClick={onNewTab} title="New terminal tab">
              <Plus className="h-4 w-4" />
            </Button>
            <Button type="button" variant="ghost" size="icon" className="h-8 w-8" onClick={handleClear} title="Clear terminal">
              <Eraser className="h-4 w-4" />
            </Button>
            <Button type="button" variant="ghost" size="icon" className="h-8 w-8" onClick={onCloseDock} title="Close terminal">
              <X className="h-4 w-4" />
            </Button>
          </div>
        </div>

        <div className="flex-1 min-h-0 bg-[#0f1115]">
          {tabs.length === 0 ? (
            <div className="h-full flex items-center justify-center text-sm text-white/60">Opening terminal</div>
          ) : (
            tabs.map((tab) => (
              <div
                key={`${sessionId}:${tab.id}`}
                className={cn('h-full', tab.id === activeTab?.id ? 'block' : 'hidden')}
              >
                <TerminalPane
                  ref={(value) => { paneRefs.current.set(tab.id, value) }}
                  tab={tab}
                  active={visible && tab.id === activeTab?.id}
                />
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  )
}
