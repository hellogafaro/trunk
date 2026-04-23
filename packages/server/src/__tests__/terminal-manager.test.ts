import { describe, it, expect } from 'bun:test'
import { TerminalManager, type SpawnTerminal } from '../terminal-manager'

class FakeTerminal {
  readonly writes: string[] = []
  readonly resizes: Array<{ cols: number; rows: number }> = []
  private dataListeners = new Set<(data: string) => void>()
  private exitListeners = new Set<() => void>()
  killed = false

  write(data: string): void {
    this.writes.push(data)
  }

  resize(cols: number, rows: number): void {
    this.resizes.push({ cols, rows })
  }

  kill(): void {
    this.killed = true
    this.emitExit()
  }

  onData(listener: (data: string) => void): { dispose(): void } {
    this.dataListeners.add(listener)
    return { dispose: () => this.dataListeners.delete(listener) }
  }

  onExit(listener: () => void): { dispose(): void } {
    this.exitListeners.add(listener)
    return { dispose: () => this.exitListeners.delete(listener) }
  }

  emitData(data: string): void {
    for (const listener of this.dataListeners) listener(data)
  }

  emitExit(): void {
    for (const listener of this.exitListeners) listener()
  }
}

describe('TerminalManager', () => {
  it('manages terminal tab lifecycle for a client session', async () => {
    const spawned: FakeTerminal[] = []
    const dataEvents: Array<{ clientId: string; sessionId: string; tabId: string; data: string }> = []
    const tabsEvents: Array<{ clientId: string; sessionId: string; tabs: Array<{ id: string; title: string; cwd: string }> }> = []

    const spawnTerminal: SpawnTerminal = async () => {
      const terminal = new FakeTerminal()
      spawned.push(terminal)
      return terminal
    }

    const manager = new TerminalManager({
      onData: (clientId, event) => dataEvents.push({ clientId, ...event }),
      onTabsChanged: (clientId, event) => {
        tabsEvents.push({
          clientId,
          sessionId: event.sessionId,
          tabs: event.tabs.map((tab) => ({ id: tab.id, title: tab.title, cwd: tab.cwd })),
        })
      },
    }, spawnTerminal)

    const tab = await manager.createTab({
      clientId: 'client-1',
      sessionId: 'session-1',
      cwd: '/tmp/project',
    })

    expect(tab.sessionId).toBe('session-1')
    expect(tab.title).toBe('Terminal 1')
    expect(tabsEvents.at(-1)).toEqual({
      clientId: 'client-1',
      sessionId: 'session-1',
      tabs: [{ id: tab.id, title: 'Terminal 1', cwd: '/tmp/project' }],
    })

    spawned[0].emitData('hello')
    expect(dataEvents).toEqual([
      {
        clientId: 'client-1',
        sessionId: 'session-1',
        tabId: tab.id,
        data: 'hello',
      },
    ])

    manager.write('client-1', tab.id, 'ls\n')
    manager.resize('client-1', tab.id, 120.8, 0)
    expect(spawned[0].writes).toEqual(['ls\n'])
    expect(spawned[0].resizes).toEqual([{ cols: 120, rows: 1 }])

    manager.closeSession('client-1', 'session-1')
    expect(spawned[0].killed).toBe(true)
    expect(tabsEvents.at(-1)).toEqual({
      clientId: 'client-1',
      sessionId: 'session-1',
      tabs: [],
    })
  })

  it('rejects access to tabs owned by another client', async () => {
    const manager = new TerminalManager({
      onData: () => {},
      onTabsChanged: () => {},
    }, async () => new FakeTerminal())

    const tab = await manager.createTab({
      clientId: 'client-1',
      sessionId: 'session-1',
      cwd: '/tmp/project',
    })

    expect(() => manager.write('client-2', tab.id, 'pwd\n')).toThrow(`Terminal tab not found: ${tab.id}`)
  })
})
