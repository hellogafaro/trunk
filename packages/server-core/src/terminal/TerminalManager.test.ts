import { describe, expect, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { TerminalManager, type PtyFactory } from './TerminalManager'

class FakePty {
  pid = 4242
  writes: string[] = []
  sizes: Array<[number, number]> = []
  killed = false
  private dataListeners = new Set<(data: string) => void>()
  private exitListeners = new Set<(event: { exitCode: number }) => void>()

  write(data: string) { this.writes.push(data) }
  resize(cols: number, rows: number) { this.sizes.push([cols, rows]) }
  kill() { this.killed = true }
  onData(listener: (data: string) => void) {
    this.dataListeners.add(listener)
    return { dispose: () => this.dataListeners.delete(listener) }
  }
  onExit(listener: (event: { exitCode: number }) => void) {
    this.exitListeners.add(listener)
    return { dispose: () => this.exitListeners.delete(listener) }
  }
  emitData(data: string) { for (const listener of this.dataListeners) listener(data) }
  emitExit(exitCode: number) { for (const listener of this.exitListeners) listener({ exitCode }) }
}

describe('TerminalManager', () => {
  test('owns independent tabs and replays buffered output on attach', () => {
    const cwd = mkdtempSync(join(tmpdir(), 'hellogafaro-terminal-'))
    const processes: FakePty[] = []
    const spawn: PtyFactory = () => {
      const process = new FakePty()
      processes.push(process)
      return process
    }
    const manager = new TerminalManager(spawn)

    try {
      const first = manager.open('workspace-1', cwd)
      const second = manager.open('workspace-1', cwd)
      expect(first.label).toBe('Terminal 1')
      expect(second.label).toBe('Terminal 2')
      expect(manager.list('workspace-1')).toHaveLength(2)

      processes[0].emitData('hello\r\n')
      const attached = manager.get('workspace-1', first.id)
      expect(attached.buffer).toBe('hello\r\n')
      expect(attached.seq).toBe(1)
      expect(manager.get('workspace-1', second.id).buffer).toBe('')

      manager.write('workspace-1', first.id, 'pwd\r')
      manager.resize('workspace-1', first.id, 120, 40)
      expect(processes[0].writes).toEqual(['pwd\r'])
      expect(processes[0].sizes).toEqual([[120, 40]])
    } finally {
      manager.dispose()
      rmSync(cwd, { recursive: true, force: true })
    }
  })

  test('keeps an exited tab attachable and can restart it', () => {
    const cwd = mkdtempSync(join(tmpdir(), 'hellogafaro-terminal-'))
    const processes: FakePty[] = []
    const manager = new TerminalManager(() => {
      const process = new FakePty()
      processes.push(process)
      return process
    })

    try {
      const session = manager.open('workspace-1', cwd)
      processes[0].emitExit(7)
      expect(manager.get('workspace-1', session.id)).toMatchObject({ status: 'exited', exitCode: 7 })

      const restarted = manager.restart('workspace-1', session.id, 90, 25)
      expect(restarted).toMatchObject({ status: 'running', exitCode: null, buffer: '', seq: 0 })
      expect(processes).toHaveLength(2)
    } finally {
      manager.dispose()
      rmSync(cwd, { recursive: true, force: true })
    }
  })
})
