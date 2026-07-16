import { RPC_CHANNELS } from '@craft-agent/shared/protocol'
import type {
  BrowserKeyboardInput,
  BrowserPointerInput,
  BrowserScreenshotRequest,
} from '@craft-agent/shared/protocol'
import { pushTyped, type RpcServer } from '@craft-agent/server-core/transport'
import { browserElementsAtPointExpression } from '@craft-agent/server-core/handlers'
import type { ServerBrowserPaneManager } from './server-browser-pane-manager'

interface BrowserCreateOptions {
  id?: string
  show?: boolean
  bindToSessionId?: string
}

export function registerServerBrowserHandlers(
  server: RpcServer,
  browserPaneManager: ServerBrowserPaneManager,
): void {
  server.handle(RPC_CHANNELS.browserPane.CREATE, async (ctx, input?: string | BrowserCreateOptions) => {
    const workspaceId = ctx.workspaceId ?? null
    if (typeof input === 'string') {
      return await browserPaneManager.createInstanceAsync(input, { workspaceId })
    }
    if (input?.bindToSessionId) {
      return await browserPaneManager.createForSessionAsync(input.bindToSessionId, {
        show: input.show ?? false,
        workspaceId,
      })
    }
    return await browserPaneManager.createInstanceAsync(input?.id, {
      show: input?.show,
      workspaceId,
    })
  })

  server.handle(RPC_CHANNELS.browserPane.DESTROY, async (_ctx, id: string) => {
    browserPaneManager.destroyInstance(id)
  })
  server.handle(RPC_CHANNELS.browserPane.LIST, async () => await browserPaneManager.listInstancesAsync())
  server.handle(RPC_CHANNELS.browserPane.NAVIGATE, async (_ctx, id: string, url: string) => await browserPaneManager.navigate(id, url))
  server.handle(RPC_CHANNELS.browserPane.GO_BACK, async (_ctx, id: string) => await browserPaneManager.goBack(id))
  server.handle(RPC_CHANNELS.browserPane.GO_FORWARD, async (_ctx, id: string) => await browserPaneManager.goForward(id))
  server.handle(RPC_CHANNELS.browserPane.RELOAD, async (_ctx, id: string) => await browserPaneManager.reload(id))
  server.handle(RPC_CHANNELS.browserPane.STOP, async (_ctx, id: string) => await browserPaneManager.stop(id))
  server.handle(RPC_CHANNELS.browserPane.FOCUS, async (_ctx, id: string) => browserPaneManager.focus(id))
  server.handle(RPC_CHANNELS.browserPane.SNAPSHOT, async (_ctx, id: string) => await browserPaneManager.getAccessibilitySnapshot(id))
  server.handle(RPC_CHANNELS.browserPane.CLICK, async (_ctx, id: string, ref: string) => await browserPaneManager.clickElement(id, ref))
  server.handle(RPC_CHANNELS.browserPane.FILL, async (_ctx, id: string, ref: string, value: string) => await browserPaneManager.fillElement(id, ref, value))
  server.handle(RPC_CHANNELS.browserPane.SELECT, async (_ctx, id: string, ref: string, value: string) => await browserPaneManager.selectOption(id, ref, value))
  server.handle(RPC_CHANNELS.browserPane.SCREENSHOT, async (_ctx, id: string, options?: BrowserScreenshotRequest) => {
    const result = await browserPaneManager.screenshot(id, options)
    return {
      base64: result.imageBuffer.toString('base64'),
      imageFormat: result.imageFormat,
      metadata: result.metadata,
    }
  })
  server.handle(RPC_CHANNELS.browserPane.POINTER, async (_ctx, id: string, input: BrowserPointerInput) => await browserPaneManager.pointer(id, input))
  server.handle(RPC_CHANNELS.browserPane.KEYBOARD, async (_ctx, id: string, input: BrowserKeyboardInput) => await browserPaneManager.keyboard(id, input))
  server.handle(RPC_CHANNELS.browserPane.RESIZE, async (_ctx, id: string, width: number, height: number) => await browserPaneManager.resizeAsync(id, width, height))
  server.handle(RPC_CHANNELS.browserPane.EVALUATE, async (_ctx, id: string, expression: string) => await browserPaneManager.evaluate(id, expression))
  server.handle(RPC_CHANNELS.browserPane.ELEMENTS_AT, async (_ctx, id: string, x: number, y: number) => (
    await browserPaneManager.evaluate(id, browserElementsAtPointExpression(x, y))
  ))
  server.handle(RPC_CHANNELS.browserPane.SCROLL, async (_ctx, id: string, direction: 'up' | 'down' | 'left' | 'right', amount?: number) => await browserPaneManager.scroll(id, direction, amount))
  server.handle(RPC_CHANNELS.browserPane.LAUNCH, async () => ({ ok: true, handled: false }))

  browserPaneManager.onStateChange((info) => {
    pushTyped(server, RPC_CHANNELS.browserPane.STATE_CHANGED, { to: 'all' }, info)
  })
  browserPaneManager.onRemoved((id) => {
    pushTyped(server, RPC_CHANNELS.browserPane.REMOVED, { to: 'all' }, id)
  })
  browserPaneManager.onInteracted((id) => {
    pushTyped(server, RPC_CHANNELS.browserPane.INTERACTED, { to: 'all' }, id)
  })
  browserPaneManager.onFrame((frame) => {
    pushTyped(server, RPC_CHANNELS.browserPane.FRAME, { to: 'all' }, frame)
  })
}
