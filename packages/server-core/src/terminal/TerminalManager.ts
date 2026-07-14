import { randomUUID } from 'node:crypto'
import { accessSync, chmodSync, constants, existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, isAbsolute, join } from 'node:path'
import * as nodePty from 'node-pty'
import type { TerminalEvent, TerminalSessionDto } from '@craft-agent/shared/protocol'
import { spawnNodePtyBridge } from './NodePtyBridge'

const DEFAULT_COLS = 100
const DEFAULT_ROWS = 30
const MAX_BUFFER_CHARS = 1_000_000

interface ManagedTerminal {
  dto: TerminalSessionDto
  process: PtyProcess | null
  disposables: Array<{ dispose(): void }>
}

interface PtyProcess {
  pid: number
  write(data: string): void
  resize(cols: number, rows: number): void
  kill(signal?: string): void
  onData(listener: (data: string) => void): { dispose(): void }
  onExit(listener: (event: { exitCode: number; signal?: number }) => void): { dispose(): void }
}

export type PtyFactory = (
  shell: string,
  args: string[],
  options: Parameters<typeof nodePty.spawn>[2],
) => PtyProcess

export interface TerminalOpenOptions {
  cwd?: string
  cols?: number
  rows?: number
}

export type TerminalEventListener = (event: TerminalEvent) => void

const defaultPtyFactory: PtyFactory = process.versions.bun && process.platform === 'linux'
  ? spawnNodePtyBridge
  : nodePty.spawn

function shellEnvironment(): Record<string, string> {
  const blocked = new Set([
    'CRAFT_SERVER_TOKEN',
    'CRAFT_WEBUI_PASSWORD',
    'CRAFT_RPC_TLS_KEY',
  ])
  return Object.fromEntries(
    Object.entries(process.env)
      .filter(([key, value]) => value !== undefined && !blocked.has(key))
      .map(([key, value]) => [key, value as string]),
  )
}

/** Bun may extract node-pty's Unix helper without its executable bit. */
function ensureSpawnHelperExecutable(): void {
  if (process.platform === 'win32') return
  try {
    const require = createRequire(import.meta.url)
    const packageDir = dirname(require.resolve('node-pty/package.json'))
    const candidates = [
      join(packageDir, 'build', 'Release', 'spawn-helper'),
      join(packageDir, 'build', 'Debug', 'spawn-helper'),
      join(packageDir, 'prebuilds', `${process.platform}-${process.arch}`, 'spawn-helper'),
    ]
    const helper = candidates.find(existsSync)
    if (helper) chmodSync(helper, 0o755)
  } catch {
    // Best effort. node-pty will report a useful spawn error if this was required.
  }
}

function clampDimension(value: number | undefined, fallback: number): number {
  if (!Number.isFinite(value)) return fallback
  return Math.max(2, Math.min(1000, Math.floor(value!)))
}

export class TerminalManager {
  private readonly sessions = new Map<string, ManagedTerminal>()
  private readonly listeners = new Set<TerminalEventListener>()

  constructor(private readonly spawnPty: PtyFactory = defaultPtyFactory) {}

  onEvent(listener: TerminalEventListener): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  list(workspaceId: string): TerminalSessionDto[] {
    return [...this.sessions.values()]
      .filter((entry) => entry.dto.workspaceId === workspaceId)
      .sort((a, b) => a.dto.createdAt - b.dto.createdAt)
      .map((entry) => ({ ...entry.dto }))
  }

  get(workspaceId: string, terminalId: string): TerminalSessionDto {
    return { ...this.require(workspaceId, terminalId).dto }
  }

  open(workspaceId: string, workspaceRoot: string, options: TerminalOpenOptions = {}): TerminalSessionDto {
    const cwd = options.cwd ?? workspaceRoot
    if (!isAbsolute(cwd)) throw new Error('Terminal working directory must be absolute')
    accessSync(cwd, constants.R_OK | constants.X_OK)

    const terminalId = randomUUID()
    const number = this.list(workspaceId).length + 1
    const now = Date.now()
    const entry: ManagedTerminal = {
      dto: {
        id: terminalId,
        workspaceId,
        label: `Terminal ${number}`,
        cwd,
        pid: null,
        status: 'running',
        exitCode: null,
        createdAt: now,
        updatedAt: now,
        buffer: '',
        seq: 0,
      },
      process: null,
      disposables: [],
    }
    this.sessions.set(terminalId, entry)
    this.spawn(entry, options.cols, options.rows)
    this.emit({ workspaceId, terminalId, type: 'open', session: { ...entry.dto } })
    return { ...entry.dto }
  }

  write(workspaceId: string, terminalId: string, data: string): void {
    const entry = this.require(workspaceId, terminalId)
    if (!entry.process || entry.dto.status !== 'running') throw new Error('Terminal is not running')
    entry.process.write(data)
  }

  resize(workspaceId: string, terminalId: string, cols: number, rows: number): void {
    const entry = this.require(workspaceId, terminalId)
    if (!entry.process || entry.dto.status !== 'running') return
    entry.process.resize(clampDimension(cols, DEFAULT_COLS), clampDimension(rows, DEFAULT_ROWS))
  }

  clear(workspaceId: string, terminalId: string): TerminalSessionDto {
    const entry = this.require(workspaceId, terminalId)
    entry.dto.buffer = ''
    entry.dto.updatedAt = Date.now()
    this.emit({ workspaceId, terminalId, type: 'clear', session: { ...entry.dto } })
    return { ...entry.dto }
  }

  restart(workspaceId: string, terminalId: string, cols?: number, rows?: number): TerminalSessionDto {
    const entry = this.require(workspaceId, terminalId)
    this.disposeProcess(entry)
    entry.dto.buffer = ''
    entry.dto.seq = 0
    entry.dto.exitCode = null
    entry.dto.status = 'running'
    entry.dto.updatedAt = Date.now()
    this.spawn(entry, cols, rows)
    this.emit({ workspaceId, terminalId, type: 'restart', session: { ...entry.dto } })
    return { ...entry.dto }
  }

  close(workspaceId: string, terminalId: string): void {
    const entry = this.require(workspaceId, terminalId)
    this.sessions.delete(terminalId)
    this.disposeProcess(entry)
    this.emit({ workspaceId, terminalId, type: 'close' })
  }

  dispose(): void {
    for (const entry of this.sessions.values()) this.disposeProcess(entry)
    this.sessions.clear()
    this.listeners.clear()
  }

  private spawn(entry: ManagedTerminal, cols?: number, rows?: number): void {
    ensureSpawnHelperExecutable()
    const shell = process.env.SHELL || (process.platform === 'win32' ? 'powershell.exe' : '/bin/bash')
    const args = process.platform === 'win32' ? [] : ['-l']
    const pty = this.spawnPty(shell, args, {
      name: process.platform === 'win32' ? 'xterm-color' : 'xterm-256color',
      cwd: entry.dto.cwd,
      cols: clampDimension(cols, DEFAULT_COLS),
      rows: clampDimension(rows, DEFAULT_ROWS),
      env: shellEnvironment(),
    })
    entry.process = pty
    entry.dto.pid = pty.pid
    entry.dto.status = 'running'
    entry.dto.updatedAt = Date.now()

    entry.disposables.push(pty.onData((data) => {
      entry.dto.seq += 1
      entry.dto.updatedAt = Date.now()
      entry.dto.buffer += data
      if (entry.dto.buffer.length > MAX_BUFFER_CHARS) {
        entry.dto.buffer = entry.dto.buffer.slice(-MAX_BUFFER_CHARS)
      }
      this.emit({
        workspaceId: entry.dto.workspaceId,
        terminalId: entry.dto.id,
        type: 'data',
        data,
        seq: entry.dto.seq,
      })
    }))
    entry.disposables.push(pty.onExit(({ exitCode }) => {
      if (entry.process !== pty) return
      entry.process = null
      entry.dto.pid = null
      entry.dto.status = 'exited'
      entry.dto.exitCode = exitCode
      entry.dto.updatedAt = Date.now()
      this.emit({
        workspaceId: entry.dto.workspaceId,
        terminalId: entry.dto.id,
        type: 'exit',
        session: { ...entry.dto },
      })
    }))
  }

  private disposeProcess(entry: ManagedTerminal): void {
    for (const disposable of entry.disposables.splice(0)) disposable.dispose()
    const process = entry.process
    entry.process = null
    if (process) {
      try { process.kill() } catch { /* already exited */ }
    }
    entry.dto.pid = null
  }

  private require(workspaceId: string, terminalId: string): ManagedTerminal {
    const entry = this.sessions.get(terminalId)
    if (!entry || entry.dto.workspaceId !== workspaceId) throw new Error('Terminal not found')
    return entry
  }

  private emit(event: TerminalEvent): void {
    for (const listener of this.listeners) listener(event)
  }
}
