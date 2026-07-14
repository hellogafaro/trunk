import { spawn as spawnChildProcess, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { join } from 'node:path'
import type { PtyFactory } from './TerminalManager'

type DataListener = (data: string) => void
type ExitListener = (event: { exitCode: number; signal?: number }) => void

type WorkerMessage =
  | { type: 'ready'; pid: number }
  | { type: 'data'; data: string }
  | { type: 'exit'; exitCode: number; signal?: number }
  | { type: 'error'; message: string }

class NodePtyBridgeProcess {
  private readonly child: ChildProcessWithoutNullStreams
  private readonly dataListeners = new Set<DataListener>()
  private readonly exitListeners = new Set<ExitListener>()
  private readonly pendingData: string[] = []
  private pendingExit: { exitCode: number; signal?: number } | null = null
  private stdoutBuffer = ''
  private stderrTail = ''
  private didExit = false
  private ptyPid: number | null = null

  constructor(shell: string, args: string[], options: Parameters<PtyFactory>[2]) {
    const workerPath = join(import.meta.dir, 'node-pty-worker.cjs')
    this.child = spawnChildProcess(process.env.CRAFT_TERMINAL_NODE_BIN || 'node', [workerPath], {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: options.env,
    })

    this.child.stdout.setEncoding('utf8')
    this.child.stdout.on('data', (chunk: string) => this.consumeStdout(chunk))
    this.child.stderr.setEncoding('utf8')
    this.child.stderr.on('data', (chunk: string) => {
      this.stderrTail = `${this.stderrTail}${chunk}`.slice(-8_000)
    })
    this.child.on('error', (error) => {
      this.emitData(`\r\nUnable to start terminal process: ${error.message}\r\n`)
      this.emitExit({ exitCode: 1 })
    })
    this.child.on('exit', (code, signal) => {
      if (this.didExit) return
      if (this.stderrTail) {
        this.emitData(`\r\nTerminal process stopped: ${this.stderrTail.trim()}\r\n`)
      }
      this.emitExit({ exitCode: code ?? 1, signal: typeof signal === 'number' ? signal : undefined })
    })

    this.send({ type: 'init', shell, args, options })
  }

  get pid(): number {
    return this.ptyPid ?? this.child.pid ?? 0
  }

  write(data: string): void {
    this.send({ type: 'write', data })
  }

  resize(cols: number, rows: number): void {
    this.send({ type: 'resize', cols, rows })
  }

  kill(signal?: string): void {
    this.send({ type: 'kill', signal })
    const timer = setTimeout(() => {
      if (!this.didExit) this.child.kill('SIGKILL')
    }, 1_000)
    timer.unref?.()
  }

  onData(listener: DataListener): { dispose(): void } {
    this.dataListeners.add(listener)
    for (const data of this.pendingData.splice(0)) listener(data)
    return { dispose: () => this.dataListeners.delete(listener) }
  }

  onExit(listener: ExitListener): { dispose(): void } {
    this.exitListeners.add(listener)
    if (this.pendingExit) listener(this.pendingExit)
    return { dispose: () => this.exitListeners.delete(listener) }
  }

  private consumeStdout(chunk: string): void {
    this.stdoutBuffer += chunk
    let newline = this.stdoutBuffer.indexOf('\n')
    while (newline !== -1) {
      const line = this.stdoutBuffer.slice(0, newline)
      this.stdoutBuffer = this.stdoutBuffer.slice(newline + 1)
      if (line) this.consumeMessage(line)
      newline = this.stdoutBuffer.indexOf('\n')
    }
  }

  private consumeMessage(line: string): void {
    let message: WorkerMessage
    try {
      message = JSON.parse(line) as WorkerMessage
    } catch {
      return
    }
    if (message.type === 'ready') {
      this.ptyPid = message.pid
    } else if (message.type === 'data') {
      this.emitData(message.data)
    } else if (message.type === 'error') {
      this.emitData(`\r\nUnable to start terminal process: ${message.message}\r\n`)
    } else if (message.type === 'exit') {
      this.emitExit({ exitCode: message.exitCode, signal: message.signal })
    }
  }

  private emitData(data: string): void {
    if (this.dataListeners.size === 0) {
      this.pendingData.push(data)
      return
    }
    for (const listener of this.dataListeners) listener(data)
  }

  private emitExit(event: { exitCode: number; signal?: number }): void {
    if (this.didExit) return
    this.didExit = true
    this.pendingExit = event
    for (const listener of this.exitListeners) listener(event)
  }

  private send(message: unknown): void {
    if (!this.child.stdin.destroyed) this.child.stdin.write(`${JSON.stringify(message)}\n`)
  }
}

export const spawnNodePtyBridge: PtyFactory = (shell, args, options) => {
  return new NodePtyBridgeProcess(shell, args, options)
}
