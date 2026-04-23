import { randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import type { TerminalTab } from '@craft-agent/shared/protocol'

interface TerminalProcess {
  write(data: string): void
  resize(cols: number, rows: number): void
  kill(): void
  onData(listener: (data: string) => void): { dispose(): void } | void
  onExit(listener: () => void): { dispose(): void } | void
}

interface SpawnTerminalInput {
  shell: string
  args: string[]
  cwd: string
  cols: number
  rows: number
  env: NodeJS.ProcessEnv
}

export type SpawnTerminal = (input: SpawnTerminalInput) => Promise<TerminalProcess> | TerminalProcess

interface TerminalTabRecord {
  id: string
  sessionId: string
  clientId: string
  title: string
  cwd: string
  pty: TerminalProcess
}

interface TerminalManagerEvents {
  onData: (clientId: string, event: { sessionId: string; tabId: string; data: string }) => void
  onTabsChanged: (clientId: string, event: { sessionId: string; tabs: TerminalTab[] }) => void
}

let nodePtyModulePromise: Promise<typeof import('node-pty')> | null = null

function getSessionKey(clientId: string, sessionId: string): string {
  return `${clientId}:${sessionId}`
}

function toTerminalTab(record: TerminalTabRecord): TerminalTab {
  return {
    id: record.id,
    sessionId: record.sessionId,
    title: record.title,
    cwd: record.cwd,
  }
}

function resolveShell(): { shell: string; args: string[] } {
  if (process.platform === 'win32') {
    const shell = process.env.COMSPEC || 'powershell.exe'
    return { shell, args: [] }
  }

  const shell = [process.env.SHELL, '/bin/bash', '/bin/sh']
    .find((candidate) => typeof candidate === 'string' && candidate.length > 0 && existsSync(candidate))
    ?? '/bin/sh'

  return { shell, args: ['-i'] }
}

async function loadNodePty(): Promise<typeof import('node-pty')> {
  if (!nodePtyModulePromise) {
    nodePtyModulePromise = import('node-pty')
  }
  return await nodePtyModulePromise
}

async function spawnNodePty(input: SpawnTerminalInput): Promise<TerminalProcess> {
  const nodePty = await loadNodePty()
  return nodePty.spawn(input.shell, input.args, {
    name: 'xterm-256color',
    cols: input.cols,
    rows: input.rows,
    cwd: input.cwd,
    env: input.env,
  })
}

export async function isTerminalRuntimeSupported(): Promise<boolean> {
  try {
    await loadNodePty()
    return true
  } catch {
    return false
  }
}

export class TerminalManager {
  private readonly tabs = new Map<string, TerminalTabRecord>()
  private readonly sessionTabs = new Map<string, Set<string>>()

  constructor(
    private readonly events: TerminalManagerEvents,
    private readonly spawnTerminal: SpawnTerminal = spawnNodePty,
  ) {
    process.once('SIGTERM', () => this.cleanup())
    process.once('SIGINT', () => this.cleanup())
    process.once('exit', () => this.cleanup())
  }

  async createTab(input: {
    clientId: string
    sessionId: string
    cwd: string
  }): Promise<TerminalTab> {
    const sessionKey = getSessionKey(input.clientId, input.sessionId)
    const existingTabs = this.sessionTabs.get(sessionKey) ?? new Set<string>()
    const { shell, args } = resolveShell()
    const tabId = randomUUID()
    const title = `Terminal ${existingTabs.size + 1}`
    const terminal = await this.spawnTerminal({
      shell,
      args,
      cwd: input.cwd,
      cols: 80,
      rows: 24,
      env: {
        ...process.env,
        TERM: 'xterm-256color',
        COLORTERM: 'truecolor',
      },
    })

    const record: TerminalTabRecord = {
      id: tabId,
      sessionId: input.sessionId,
      clientId: input.clientId,
      title,
      cwd: input.cwd,
      pty: terminal,
    }

    terminal.onData((data) => {
      if (!this.tabs.has(tabId)) return
      this.events.onData(record.clientId, {
        sessionId: record.sessionId,
        tabId,
        data,
      })
    })

    terminal.onExit(() => {
      const current = this.tabs.get(tabId)
      if (!current) return
      this.removeRecord(current)
      this.pushTabsChanged(current.clientId, current.sessionId)
    })

    existingTabs.add(tabId)
    this.sessionTabs.set(sessionKey, existingTabs)
    this.tabs.set(tabId, record)
    this.pushTabsChanged(record.clientId, record.sessionId)

    return toTerminalTab(record)
  }

  write(clientId: string, tabId: string, data: string): void {
    if (!data) return
    const record = this.getOwnedTab(clientId, tabId)
    record.pty.write(data)
  }

  resize(clientId: string, tabId: string, cols: number, rows: number): void {
    const record = this.getOwnedTab(clientId, tabId)
    const safeCols = Number.isFinite(cols) ? Math.max(1, Math.floor(cols)) : 80
    const safeRows = Number.isFinite(rows) ? Math.max(1, Math.floor(rows)) : 24
    record.pty.resize(safeCols, safeRows)
  }

  closeTab(clientId: string, tabId: string): void {
    const record = this.getOwnedTab(clientId, tabId)
    this.removeRecord(record)
    try {
      record.pty.kill()
    } catch {
      // Ignore kill failures - process may already be gone.
    }
    this.pushTabsChanged(record.clientId, record.sessionId)
  }

  closeSession(clientId: string, sessionId: string): void {
    const sessionKey = getSessionKey(clientId, sessionId)
    const tabIds = Array.from(this.sessionTabs.get(sessionKey) ?? [])
    for (const tabId of tabIds) {
      const record = this.tabs.get(tabId)
      if (!record) continue
      this.removeRecord(record)
      try {
        record.pty.kill()
      } catch {
        // Ignore kill failures - process may already be gone.
      }
    }
    this.pushTabsChanged(clientId, sessionId)
  }

  cleanupClient(clientId: string): void {
    const tabIds = Array.from(this.tabs.values())
      .filter((record) => record.clientId === clientId)
      .map((record) => record.id)

    for (const tabId of tabIds) {
      const record = this.tabs.get(tabId)
      if (!record) continue
      this.removeRecord(record)
      try {
        record.pty.kill()
      } catch {
        // Ignore kill failures - process may already be gone.
      }
    }
  }

  cleanup(): void {
    const tabIds = Array.from(this.tabs.keys())
    for (const tabId of tabIds) {
      const record = this.tabs.get(tabId)
      if (!record) continue
      this.removeRecord(record)
      try {
        record.pty.kill()
      } catch {
        // Ignore kill failures - process may already be gone.
      }
    }
  }

  private getOwnedTab(clientId: string, tabId: string): TerminalTabRecord {
    const record = this.tabs.get(tabId)
    if (!record || record.clientId !== clientId) {
      throw new Error(`Terminal tab not found: ${tabId}`)
    }
    return record
  }

  private removeRecord(record: TerminalTabRecord): void {
    this.tabs.delete(record.id)
    const sessionKey = getSessionKey(record.clientId, record.sessionId)
    const tabIds = this.sessionTabs.get(sessionKey)
    if (!tabIds) return
    tabIds.delete(record.id)
    if (tabIds.size === 0) {
      this.sessionTabs.delete(sessionKey)
      return
    }
    this.sessionTabs.set(sessionKey, tabIds)
  }

  private pushTabsChanged(clientId: string, sessionId: string): void {
    const sessionKey = getSessionKey(clientId, sessionId)
    const tabs = Array.from(this.sessionTabs.get(sessionKey) ?? [])
      .map((tabId) => this.tabs.get(tabId))
      .filter((record): record is TerminalTabRecord => record !== undefined)
      .map(toTerminalTab)

    this.events.onTabsChanged(clientId, { sessionId, tabs })
  }
}
