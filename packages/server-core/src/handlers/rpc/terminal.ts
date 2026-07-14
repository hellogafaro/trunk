import { getWorkspaceByNameOrId } from '@craft-agent/shared/config'
import { RPC_CHANNELS, type TerminalSessionDto } from '@craft-agent/shared/protocol'
import { pushTyped, type RpcServer } from '../../transport'
import { TerminalManager } from '../../terminal'

function workspaceOrThrow(workspaceId: string) {
  const workspace = getWorkspaceByNameOrId(workspaceId)
  if (!workspace) throw new Error(`Workspace ${workspaceId} not found`)
  return workspace
}

export function registerTerminalHandlers(server: RpcServer): TerminalManager {
  const manager = new TerminalManager()
  manager.onEvent((event) => {
    pushTyped(server, RPC_CHANNELS.terminal.EVENT, {
      to: 'workspace',
      workspaceId: event.workspaceId,
    }, event)
  })

  server.handle(RPC_CHANNELS.terminal.LIST, (_ctx, workspaceId: string): TerminalSessionDto[] => {
    workspaceOrThrow(workspaceId)
    return manager.list(workspaceId)
  })
  server.handle(RPC_CHANNELS.terminal.OPEN, (_ctx, workspaceId: string, options?: { cwd?: string; cols?: number; rows?: number }) => {
    const workspace = workspaceOrThrow(workspaceId)
    return manager.open(workspace.id, workspace.rootPath, options)
  })
  server.handle(RPC_CHANNELS.terminal.ATTACH, (_ctx, workspaceId: string, terminalId: string) => {
    workspaceOrThrow(workspaceId)
    return manager.get(workspaceId, terminalId)
  })
  server.handle(RPC_CHANNELS.terminal.WRITE, (_ctx, workspaceId: string, terminalId: string, data: string) => {
    if (typeof data !== 'string' || data.length > 64_000) throw new Error('Invalid terminal input')
    manager.write(workspaceId, terminalId, data)
  })
  server.handle(RPC_CHANNELS.terminal.RESIZE, (_ctx, workspaceId: string, terminalId: string, cols: number, rows: number) => {
    manager.resize(workspaceId, terminalId, cols, rows)
  })
  server.handle(RPC_CHANNELS.terminal.CLEAR, (_ctx, workspaceId: string, terminalId: string) => {
    return manager.clear(workspaceId, terminalId)
  })
  server.handle(RPC_CHANNELS.terminal.RESTART, (_ctx, workspaceId: string, terminalId: string, cols?: number, rows?: number) => {
    return manager.restart(workspaceId, terminalId, cols, rows)
  })
  server.handle(RPC_CHANNELS.terminal.CLOSE, (_ctx, workspaceId: string, terminalId: string) => {
    manager.close(workspaceId, terminalId)
  })
  return manager
}
