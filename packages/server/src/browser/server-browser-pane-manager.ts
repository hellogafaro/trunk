import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { createInterface } from 'node:readline'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { homedir } from 'node:os'
import type {
  IBrowserPaneManager,
  AccessibilitySnapshot,
  BrowserConsoleEntry,
  BrowserConsoleOptions,
  BrowserDownloadEntry,
  BrowserDownloadOptions,
  BrowserInstanceSnapshot,
  BrowserKeyArgs,
  BrowserNetworkEntry,
  BrowserNetworkOptions,
  BrowserScreenshotOptions,
  BrowserScreenshotRegionTarget,
  BrowserScreenshotResult,
  BrowserWaitArgs,
  BrowserWaitResult,
} from '@craft-agent/server-core/handlers'
import type {
  BrowserFrame,
  BrowserInstanceInfo,
  BrowserKeyboardInput,
  BrowserPointerInput,
} from '@craft-agent/shared/protocol'

interface WorkerResponse {
  id?: number
  result?: unknown
  error?: { message: string; stack?: string }
  event?: 'state' | 'frame' | 'removed' | 'interacted'
  info?: BrowserInstanceInfo
  frame?: BrowserFrame
}

interface PendingRequest {
  resolve: (value: unknown) => void
  reject: (error: Error) => void
  timer: ReturnType<typeof setTimeout>
}

interface ServerBrowserPaneManagerOptions {
  nodeBinary?: string
  profileDir?: string
  logger?: Pick<Console, 'info' | 'warn' | 'error'>
}

export class ServerBrowserPaneManager implements IBrowserPaneManager {
  private worker: ChildProcessWithoutNullStreams | null = null
  private nextRequestId = 1
  private readonly pending = new Map<number, PendingRequest>()
  private readonly instances = new Map<string, BrowserInstanceInfo>()
  private readonly viewportByInstance = new Map<string, { width: number; height: number }>()
  private readonly stateListeners = new Set<(info: BrowserInstanceInfo) => void>()
  private readonly removedListeners = new Set<(id: string) => void>()
  private readonly interactedListeners = new Set<(id: string) => void>()
  private readonly frameListeners = new Set<(frame: BrowserFrame) => void>()
  private readonly nodeBinary: string
  private readonly profileDir: string
  private readonly logger: Pick<Console, 'info' | 'warn' | 'error'>
  private sessionPathResolver: ((sessionId: string) => string | null) | null = null

  constructor(options: ServerBrowserPaneManagerOptions = {}) {
    this.nodeBinary = options.nodeBinary ?? process.env.CRAFT_BROWSER_NODE_BIN ?? 'node'
    this.profileDir = options.profileDir
      ?? process.env.CRAFT_BROWSER_PROFILE_DIR
      ?? join(homedir(), '.craft-agent', 'browser-profile')
    this.logger = options.logger ?? console
  }

  private ensureWorker(): ChildProcessWithoutNullStreams {
    if (this.worker) return this.worker

    const moduleDir = dirname(fileURLToPath(import.meta.url))
    const workerPath = join(moduleDir, 'browser-worker.mjs')
    const worker = spawn(this.nodeBinary, [workerPath], {
      env: {
        ...process.env,
        CRAFT_BROWSER_PROFILE_DIR: this.profileDir,
      },
      stdio: ['pipe', 'pipe', 'pipe'],
    })
    this.worker = worker

    const lines = createInterface({ input: worker.stdout, crlfDelay: Infinity })
    lines.on('line', (line) => {
      let message: WorkerResponse
      try {
        message = JSON.parse(line) as WorkerResponse
      } catch {
        this.logger.warn(`[browser-worker] Ignoring malformed output: ${line.slice(0, 200)}`)
        return
      }
      this.handleWorkerMessage(message)
    })
    worker.stderr.on('data', (chunk) => {
      const text = String(chunk).trim()
      if (text) this.logger.warn(`[browser-worker] ${text}`)
    })
    worker.on('exit', (code, signal) => {
      this.worker = null
      const error = new Error(`Browser worker exited (${signal ?? code ?? 'unknown'})`)
      for (const request of this.pending.values()) {
        clearTimeout(request.timer)
        request.reject(error)
      }
      this.pending.clear()
      this.logger.warn(error.message)
    })
    worker.on('error', (error) => {
      this.logger.error(`[browser-worker] Failed to start: ${error.message}`)
    })

    return worker
  }

  private handleWorkerMessage(message: WorkerResponse): void {
    if (message.event === 'state' && message.info) {
      this.instances.set(message.info.id, message.info)
      for (const listener of this.stateListeners) listener(message.info)
      return
    }
    if (message.event === 'removed' && typeof message.id === 'string') {
      this.instances.delete(message.id)
      this.viewportByInstance.delete(message.id)
      for (const listener of this.removedListeners) listener(message.id)
      return
    }
    if (message.event === 'interacted' && typeof message.id === 'string') {
      for (const listener of this.interactedListeners) listener(message.id)
      return
    }
    if (message.event === 'frame' && message.frame) {
      for (const listener of this.frameListeners) listener(message.frame)
      return
    }
    if (typeof message.id !== 'number') return

    const request = this.pending.get(message.id)
    if (!request) return
    this.pending.delete(message.id)
    clearTimeout(request.timer)
    if (message.error) {
      const error = new Error(message.error.message)
      if (message.error.stack) error.stack = message.error.stack
      request.reject(error)
    } else {
      request.resolve(message.result)
    }
  }

  private request<T>(method: string, args: unknown[] = [], timeoutMs = 45_000): Promise<T> {
    const worker = this.ensureWorker()
    const id = this.nextRequestId++
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(new Error(`Browser worker request timed out: ${method}`))
      }, timeoutMs)
      this.pending.set(id, {
        resolve: resolve as (value: unknown) => void,
        reject,
        timer,
      })
      worker.stdin.write(`${JSON.stringify({ id, method, args })}\n`)
    })
  }

  private requestInBackground(method: string, args: unknown[] = []): void {
    void this.request(method, args).catch((error) => {
      this.logger.warn(`[browser-worker] ${method} failed: ${error instanceof Error ? error.message : String(error)}`)
    })
  }

  onStateChange(callback: (info: BrowserInstanceInfo) => void): () => void {
    this.stateListeners.add(callback)
    return () => this.stateListeners.delete(callback)
  }

  onRemoved(callback: (id: string) => void): () => void {
    this.removedListeners.add(callback)
    return () => this.removedListeners.delete(callback)
  }

  onInteracted(callback: (id: string) => void): () => void {
    this.interactedListeners.add(callback)
    return () => this.interactedListeners.delete(callback)
  }

  onFrame(callback: (frame: BrowserFrame) => void): () => void {
    this.frameListeners.add(callback)
    return () => this.frameListeners.delete(callback)
  }

  async createInstanceAsync(id?: string, options?: { show?: boolean; workspaceId?: string | null }): Promise<string> {
    return await this.request('createInstance', [id, options])
  }

  async reload(id: string): Promise<void> { await this.request('reload', [id]) }
  async stop(id: string): Promise<void> { await this.request('stop', [id]) }
  async pointer(id: string, input: BrowserPointerInput): Promise<void> { await this.request('pointer', [id, input]) }
  async keyboard(id: string, input: BrowserKeyboardInput): Promise<void> { await this.request('keyboard', [id, input]) }
  async resizeAsync(id: string, width: number, height: number): Promise<{ width: number; height: number }> {
    const viewport = await this.request<{ width: number; height: number }>('windowResize', [id, width, height])
    this.viewportByInstance.set(id, viewport)
    return viewport
  }

  setSessionPathResolver(fn: (sessionId: string) => string | null): void { this.sessionPathResolver = fn }
  destroyForSession(sessionId: string): void { this.requestInBackground('destroyForSession', [sessionId]) }
  async clearVisualsForSession(sessionId: string): Promise<void> { await this.request('clearAgentControl', [sessionId]) }
  unbindAllForSession(sessionId: string): void { this.requestInBackground('unbindAllForSession', [sessionId]) }
  getOrCreateForSession(sessionId: string, options?: { workspaceId?: string | null }): string {
    this.requestInBackground('getOrCreateForSession', [sessionId, options])
    return `browser-pending:${sessionId}`
  }
  async getOrCreateForSessionAsync(sessionId: string, options?: { workspaceId?: string | null }): Promise<string> {
    return await this.request('getOrCreateForSession', [sessionId, options])
  }
  setAgentControl(sessionId: string, meta: { displayName?: string; intent?: string }, options?: { workspaceId?: string | null }): void {
    this.requestInBackground('setAgentControl', [sessionId, meta, options])
  }
  createForSession(sessionId: string, options?: { show?: boolean; workspaceId?: string | null }): string {
    this.requestInBackground('createForSession', [sessionId, options])
    return `browser-pending:${sessionId}`
  }
  async createForSessionAsync(sessionId: string, options?: { show?: boolean; workspaceId?: string | null }): Promise<string> {
    return await this.request('createForSession', [sessionId, options])
  }
  getInstance(id: string): BrowserInstanceSnapshot | undefined {
    const info = this.instances.get(id)
    if (!info) return undefined
    return {
      ownerType: info.ownerType,
      ownerSessionId: info.ownerSessionId,
      isVisible: info.isVisible,
      title: info.title,
      currentUrl: info.url,
    }
  }
  async getInstanceAsync(id: string): Promise<BrowserInstanceSnapshot | undefined> {
    return await this.request('getInstance', [id])
  }
  listInstances(): BrowserInstanceInfo[] { return [...this.instances.values()] }
  async listInstancesAsync(): Promise<BrowserInstanceInfo[]> {
    const items = await this.request<BrowserInstanceInfo[]>('listInstances')
    for (const item of items) this.instances.set(item.id, item)
    return items
  }
  focusBoundForSession(sessionId: string, options?: { workspaceId?: string | null }): string {
    this.requestInBackground('getOrCreateForSession', [sessionId, options])
    return `browser-pending:${sessionId}`
  }
  async focusBoundForSessionAsync(sessionId: string, options?: { workspaceId?: string | null }): Promise<string> {
    const id = await this.getOrCreateForSessionAsync(sessionId, options)
    await this.request('focus', [id])
    return id
  }
  bindSession(id: string, sessionId: string, options?: { workspaceId?: string | null }): void {
    this.requestInBackground('bindSession', [id, sessionId, options])
  }
  focus(id: string): void { this.requestInBackground('focus', [id]) }
  destroyInstance(id: string): void { this.requestInBackground('destroyInstance', [id]) }
  hide(id: string): void { this.requestInBackground('hide', [id]) }
  clearAgentControl(sessionId: string): void { this.requestInBackground('clearAgentControl', [sessionId]) }
  clearAgentControlForInstance(instanceId: string, sessionId?: string): { released: boolean; reason?: string } {
    this.requestInBackground('clearAgentControlForInstance', [instanceId, sessionId])
    return { released: true }
  }
  async navigate(id: string, url: string): Promise<{ url: string; title: string }> { return await this.request('navigate', [id, url]) }
  async goBack(id: string): Promise<void> { await this.request('goBack', [id]) }
  async goForward(id: string): Promise<void> { await this.request('goForward', [id]) }
  async getAccessibilitySnapshot(id: string): Promise<AccessibilitySnapshot> { return await this.request('getAccessibilitySnapshot', [id]) }
  async clickElement(id: string, ref: string, options?: { waitFor?: 'none' | 'navigation' | 'network-idle'; timeoutMs?: number }): Promise<void> {
    await this.request('clickElement', [id, ref, options])
  }
  async clickAtCoordinates(id: string, x: number, y: number): Promise<void> { await this.request('clickAtCoordinates', [id, x, y]) }
  async drag(id: string, x1: number, y1: number, x2: number, y2: number): Promise<void> { await this.request('drag', [id, x1, y1, x2, y2]) }
  async fillElement(id: string, ref: string, value: string): Promise<void> { await this.request('fillElement', [id, ref, value]) }
  async typeText(id: string, text: string): Promise<void> { await this.request('typeText', [id, text]) }
  async selectOption(id: string, ref: string, value: string): Promise<void> { await this.request('selectOption', [id, ref, value]) }
  async setClipboard(id: string, text: string): Promise<void> { await this.request('setClipboard', [id, text]) }
  async getClipboard(id: string): Promise<string> { return await this.request('getClipboard', [id]) }
  async scroll(id: string, direction: 'up' | 'down' | 'left' | 'right', amount?: number): Promise<void> { await this.request('scroll', [id, direction, amount]) }
  async sendKey(id: string, args: BrowserKeyArgs): Promise<void> { await this.request('sendKey', [id, args]) }
  async uploadFile(id: string, ref: string, filePaths: string[]): Promise<unknown> { return await this.request('uploadFile', [id, ref, filePaths]) }
  async evaluate(id: string, expression: string): Promise<unknown> { return await this.request('evaluate', [id, expression]) }
  async screenshot(id: string, options?: BrowserScreenshotOptions): Promise<BrowserScreenshotResult> {
    const result = await this.request<{ base64: string; imageFormat: 'png' | 'jpeg'; metadata?: Record<string, unknown> }>('screenshot', [id, options])
    return { imageBuffer: Buffer.from(result.base64, 'base64'), imageFormat: result.imageFormat, metadata: result.metadata }
  }
  async screenshotRegion(id: string, target: BrowserScreenshotRegionTarget): Promise<BrowserScreenshotResult> {
    const result = await this.request<{ base64: string; imageFormat: 'png' | 'jpeg'; metadata?: Record<string, unknown> }>('screenshotRegion', [id, target])
    return { imageBuffer: Buffer.from(result.base64, 'base64'), imageFormat: result.imageFormat, metadata: result.metadata }
  }
  async getConsoleLogs(id: string, options?: BrowserConsoleOptions): Promise<BrowserConsoleEntry[]> {
    return await this.request('getConsoleLogs', [id, options])
  }
  async windowResize(id: string, width: number, height: number): Promise<{ width: number; height: number }> {
    return await this.resizeAsync(id, width, height)
  }
  async getNetworkLogs(id: string, options?: BrowserNetworkOptions): Promise<BrowserNetworkEntry[]> {
    return await this.request('getNetworkLogs', [id, options])
  }
  async waitFor(id: string, args: BrowserWaitArgs): Promise<BrowserWaitResult> { return await this.request('waitFor', [id, args]) }
  async getDownloads(id: string, options?: BrowserDownloadOptions): Promise<BrowserDownloadEntry[]> { return await this.request('getDownloads', [id, options]) }
  async detectSecurityChallenge(id: string): Promise<{ detected: boolean; provider: string; signals: string[] }> { return await this.request('detectSecurityChallenge', [id]) }

  async dispose(): Promise<void> {
    if (!this.worker) return
    try { await this.request('shutdown', [], 5_000) } catch {}
    this.worker?.kill('SIGTERM')
    this.worker = null
  }
}
