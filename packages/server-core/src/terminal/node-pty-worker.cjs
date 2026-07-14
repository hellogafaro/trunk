'use strict'

const readline = require('node:readline')
const nodePty = require('node-pty')

let terminal = null

function send(message) {
  process.stdout.write(`${JSON.stringify(message)}\n`)
}

function exitWithError(error) {
  send({ type: 'error', message: error instanceof Error ? error.message : String(error) })
  process.exitCode = 1
}

const input = readline.createInterface({ input: process.stdin, crlfDelay: Infinity })
input.on('line', (line) => {
  let message
  try {
    message = JSON.parse(line)
  } catch {
    return
  }

  if (message.type === 'init') {
    if (terminal) return
    try {
      terminal = nodePty.spawn(message.shell, message.args || [], message.options || {})
      send({ type: 'ready', pid: terminal.pid })
      terminal.onData((data) => send({ type: 'data', data }))
      terminal.onExit(({ exitCode, signal }) => {
        send({ type: 'exit', exitCode, signal })
        process.exit(0)
      })
    } catch (error) {
      exitWithError(error)
    }
    return
  }

  if (!terminal) return
  try {
    if (message.type === 'write') terminal.write(message.data)
    else if (message.type === 'resize') terminal.resize(message.cols, message.rows)
    else if (message.type === 'kill') terminal.kill(message.signal)
  } catch (error) {
    exitWithError(error)
  }
})

input.on('close', () => {
  try { terminal?.kill() } catch { /* already exited */ }
})
