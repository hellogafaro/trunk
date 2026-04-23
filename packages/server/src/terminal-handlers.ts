import { existsSync } from 'node:fs'
import { pushTyped, type RpcServer } from '@craft-agent/server-core/transport'
import type { HandlerDeps } from '@craft-agent/server-core/handlers'
import { RPC_CHANNELS } from '@craft-agent/shared/protocol'
import { TerminalManager } from './terminal-manager'

function resolveTerminalCwd(session: { workingDirectory?: string; sessionFolderPath?: string }): string {
  const candidates = [session.workingDirectory, session.sessionFolderPath, process.cwd()]
  for (const candidate of candidates) {
    if (typeof candidate === 'string' && candidate.length > 0 && existsSync(candidate)) {
      return candidate
    }
  }
  return process.cwd()
}

export function registerTerminalHandlers(
  server: RpcServer,
  deps: HandlerDeps,
  terminalManager: TerminalManager,
): void {
  server.handle(RPC_CHANNELS.terminal.CREATE_TAB, async (ctx, sessionId: string) => {
    if (!ctx.clientId) throw new Error('Terminal createTab requires a connected client.')

    const session = await deps.sessionManager.getSession(sessionId)
    if (!session) throw new Error(`Session not found: ${sessionId}`)

    return terminalManager.createTab({
      clientId: ctx.clientId,
      sessionId,
      cwd: resolveTerminalCwd(session),
    })
  })

  server.handle(RPC_CHANNELS.terminal.WRITE, (ctx, tabId: string, data: string) => {
    if (!ctx.clientId) throw new Error('Terminal write requires a connected client.')
    return terminalManager.write(ctx.clientId, tabId, data)
  })

  server.handle(RPC_CHANNELS.terminal.RESIZE, (ctx, tabId: string, cols: number, rows: number) => {
    if (!ctx.clientId) throw new Error('Terminal resize requires a connected client.')
    return terminalManager.resize(ctx.clientId, tabId, cols, rows)
  })

  server.handle(RPC_CHANNELS.terminal.CLOSE_TAB, (ctx, tabId: string) => {
    if (!ctx.clientId) throw new Error('Terminal closeTab requires a connected client.')
    return terminalManager.closeTab(ctx.clientId, tabId)
  })

  server.handle(RPC_CHANNELS.terminal.CLOSE_SESSION, (ctx, sessionId: string) => {
    if (!ctx.clientId) throw new Error('Terminal closeSession requires a connected client.')
    return terminalManager.closeSession(ctx.clientId, sessionId)
  })
}

export function createTerminalManager(server: RpcServer): TerminalManager {
  return new TerminalManager({
    onData: (clientId, event) => {
      pushTyped(server, RPC_CHANNELS.terminal.DATA, { to: 'client', clientId }, event)
    },
    onTabsChanged: (clientId, event) => {
      pushTyped(server, RPC_CHANNELS.terminal.TABS_CHANGED, { to: 'client', clientId }, event)
    },
  })
}
