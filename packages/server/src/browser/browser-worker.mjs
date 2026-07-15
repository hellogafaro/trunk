#!/usr/bin/env node

import { createInterface } from 'node:readline'
import { randomUUID } from 'node:crypto'
import { mkdir } from 'node:fs/promises'
import { chromium } from 'playwright'

const profileDir = process.env.CRAFT_BROWSER_PROFILE_DIR
if (!profileDir) throw new Error('CRAFT_BROWSER_PROFILE_DIR is required')

await mkdir(profileDir, { recursive: true })

let context
let activeInstanceId = null
let clipboardText = ''
const instances = new Map()

function send(payload) {
  process.stdout.write(`${JSON.stringify(payload)}\n`)
}

function sendEvent(event, payload) {
  send({ event, ...payload })
}

function serializeError(error) {
  return {
    message: error instanceof Error ? error.message : String(error),
    stack: error instanceof Error ? error.stack : undefined,
  }
}

function normalizeUrl(input) {
  const value = String(input ?? '').trim()
  if (!value) return 'about:blank'
  if (/^[a-z][a-z\d+.-]*:/i.test(value)) return value
  if (/^(localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\])(?::\d+)?(?:\/|$)/i.test(value)) {
    return `http://${value}`
  }
  if (!value.includes(' ') && (value.includes('.') || value.includes(':'))) {
    return `https://${value}`
  }
  return `https://www.google.com/search?q=${encodeURIComponent(value)}`
}

async function launch() {
  if (context) return
  context = await chromium.launchPersistentContext(profileDir, {
    headless: true,
    viewport: { width: 1440, height: 900 },
    acceptDownloads: true,
    args: ['--disable-dev-shm-usage'],
  })
}

function requireInstance(id) {
  const instance = instances.get(id)
  if (!instance) throw new Error(`Browser instance not found: ${id}`)
  return instance
}

async function historyState(page) {
  try {
    const session = await page.context().newCDPSession(page)
    const history = await session.send('Page.getNavigationHistory')
    await session.detach()
    return {
      canGoBack: history.currentIndex > 0,
      canGoForward: history.currentIndex < history.entries.length - 1,
    }
  } catch {
    return { canGoBack: false, canGoForward: false }
  }
}

async function pagePresentation(page) {
  try {
    return await page.evaluate(() => {
      const favicon = document.querySelector('link[rel~="icon"]')?.href ?? null
      const themeColor = document.querySelector('meta[name="theme-color"]')?.content ?? null
      return { favicon, themeColor }
    })
  } catch {
    return { favicon: null, themeColor: null }
  }
}

async function publicInfo(instance) {
  const history = await historyState(instance.page)
  const presentation = await pagePresentation(instance.page)
  return {
    id: instance.id,
    url: instance.page.url(),
    title: await instance.page.title().catch(() => ''),
    favicon: presentation.favicon,
    isLoading: instance.isLoading,
    canGoBack: history.canGoBack,
    canGoForward: history.canGoForward,
    boundSessionId: instance.boundSessionId,
    ownerType: instance.ownerType,
    ownerSessionId: instance.ownerSessionId,
    isVisible: instance.isVisible,
    agentControlActive: Boolean(instance.agentControl?.active),
    themeColor: presentation.themeColor,
    workspaceId: instance.workspaceId,
  }
}

async function emitState(instance) {
  if (!instances.has(instance.id)) return
  sendEvent('state', { info: await publicInfo(instance) })
}

async function stopScreencast(instance) {
  if (!instance.cdp || !instance.screencasting) return
  instance.screencasting = false
  try { await instance.cdp.send('Page.stopScreencast') } catch {}
}

async function startScreencast(instance) {
  if (instance.screencasting) return
  if (!instance.cdp) {
    instance.cdp = await context.newCDPSession(instance.page)
    instance.cdp.on('Page.screencastFrame', async ({ data, metadata, sessionId }) => {
      try { await instance.cdp?.send('Page.screencastFrameAck', { sessionId }) } catch {}
      if (!instance.screencasting || activeInstanceId !== instance.id) return
      const now = Date.now()
      if (now - instance.lastFrameAt < 70) return
      instance.lastFrameAt = now
      sendEvent('frame', {
        frame: {
          instanceId: instance.id,
          data,
          format: 'jpeg',
          width: instance.viewport.width,
          height: instance.viewport.height,
          pageScaleFactor: metadata.pageScaleFactor ?? 1,
          timestamp: now,
        },
      })
    })
  }
  await instance.cdp.send('Page.enable')
  await instance.cdp.send('Page.startScreencast', {
    format: 'jpeg',
    quality: 72,
    maxWidth: instance.viewport.width,
    maxHeight: instance.viewport.height,
    everyNthFrame: 1,
  })
  instance.screencasting = true
}

async function focusInstance(instance) {
  if (activeInstanceId && activeInstanceId !== instance.id) {
    const previous = instances.get(activeInstanceId)
    if (previous) {
      previous.isVisible = false
      await stopScreencast(previous)
      await emitState(previous)
    }
  }
  activeInstanceId = instance.id
  instance.isVisible = true
  await startScreencast(instance)
  await emitState(instance)
  sendEvent('interacted', { id: instance.id })
}

async function wirePage(instance) {
  const { page } = instance
  page.on('load', async () => {
    instance.isLoading = false
    await emitState(instance)
  })
  page.on('domcontentloaded', () => { void emitState(instance) })
  page.on('request', (request) => {
    instance.networkLogs.push({
      timestamp: Date.now(),
      method: request.method(),
      url: request.url(),
      status: 0,
      resourceType: request.resourceType(),
      ok: true,
    })
    if (instance.networkLogs.length > 500) instance.networkLogs.shift()
  })
  page.on('response', (response) => {
    const entry = [...instance.networkLogs].reverse().find((item) => item.url === response.url() && item.status === 0)
    if (entry) {
      entry.status = response.status()
      entry.ok = response.ok()
    }
  })
  page.on('requestfailed', (request) => {
    const entry = [...instance.networkLogs].reverse().find((item) => item.url === request.url() && item.status === 0)
    if (entry) entry.ok = false
  })
  page.on('console', (message) => {
    const type = message.type()
    instance.consoleLogs.push({
      timestamp: Date.now(),
      level: ['warning', 'warn'].includes(type) ? 'warn' : ['error', 'info', 'log'].includes(type) ? type : 'log',
      message: message.text(),
    })
    if (instance.consoleLogs.length > 500) instance.consoleLogs.shift()
  })
  page.on('download', (download) => {
    const entry = {
      id: randomUUID(),
      timestamp: Date.now(),
      url: download.url(),
      filename: download.suggestedFilename(),
      state: 'in-progress',
      bytesReceived: 0,
      totalBytes: 0,
      mimeType: '',
    }
    instance.downloads.push(entry)
    void download.path().then((savePath) => {
      entry.state = 'completed'
      entry.savePath = savePath ?? undefined
    }).catch(() => { entry.state = 'failed' })
  })
  page.on('close', () => {
    if (!instances.has(instance.id)) return
    instances.delete(instance.id)
    if (activeInstanceId === instance.id) activeInstanceId = null
    sendEvent('removed', { id: instance.id })
  })
}

async function createInstance(requestedId, options = {}) {
  await launch()
  const id = requestedId || `browser-${randomUUID()}`
  if (instances.has(id)) return id

  const reusable = instances.size === 0
    ? context.pages().find((page) => page.url() === 'about:blank')
    : undefined
  const page = reusable ?? await context.newPage()
  const instance = {
    id,
    page,
    cdp: null,
    screencasting: false,
    lastFrameAt: 0,
    viewport: { width: 1440, height: 900 },
    isLoading: false,
    isVisible: false,
    ownerType: options.ownerType ?? 'manual',
    ownerSessionId: options.ownerSessionId ?? null,
    boundSessionId: options.ownerSessionId ?? null,
    workspaceId: options.workspaceId ?? null,
    agentControl: null,
    lastAction: null,
    consoleLogs: [],
    networkLogs: [],
    downloads: [],
  }
  instances.set(id, instance)
  await wirePage(instance)
  await emitState(instance)
  if (options.show ?? true) await focusInstance(instance)
  return id
}

async function snapshotPage(page) {
  const nodes = await page.evaluate(() => {
    const selector = [
      'a[href]', 'button', 'input', 'textarea', 'select', 'summary',
      '[contenteditable="true"]', '[role="button"]', '[role="link"]',
      '[role="checkbox"]', '[role="radio"]', '[role="switch"]',
      '[role="tab"]', '[role="menuitem"]', '[tabindex]:not([tabindex="-1"])',
    ].join(',')
    const candidates = Array.from(document.querySelectorAll(selector))
    const visible = candidates.filter((element) => {
      const rect = element.getBoundingClientRect()
      const style = getComputedStyle(element)
      return rect.width > 1 && rect.height > 1
        && style.visibility !== 'hidden' && style.display !== 'none'
        && rect.bottom >= 0 && rect.right >= 0
        && rect.top <= innerHeight && rect.left <= innerWidth
    }).slice(0, 300)

    const roleFor = (element) => {
      const explicit = element.getAttribute('role')
      if (explicit) return explicit
      const tag = element.tagName.toLowerCase()
      if (tag === 'a') return 'link'
      if (tag === 'button') return 'button'
      if (tag === 'textarea') return 'textbox'
      if (tag === 'select') return 'combobox'
      if (tag === 'input') {
        const type = element.getAttribute('type') || 'text'
        if (type === 'checkbox') return 'checkbox'
        if (type === 'radio') return 'radio'
        if (['button', 'submit', 'reset'].includes(type)) return 'button'
        return 'textbox'
      }
      return tag
    }

    let nextRef = Array.from(document.querySelectorAll('[data-craft-agent-ref]'))
      .reduce((highest, element) => {
        const match = /^e(\d+)$/.exec(element.getAttribute('data-craft-agent-ref') || '')
        return Math.max(highest, match ? Number(match[1]) : 0)
      }, 0) + 1

    return visible.map((element) => {
      let ref = element.getAttribute('data-craft-agent-ref')
      if (!ref) {
        ref = `e${nextRef++}`
        element.setAttribute('data-craft-agent-ref', ref)
      }
      const input = element
      const name = element.getAttribute('aria-label')
        || element.getAttribute('alt')
        || element.getAttribute('title')
        || element.getAttribute('placeholder')
        || (typeof input.value === 'string' ? input.value : '')
        || element.textContent?.trim().replace(/\s+/g, ' ').slice(0, 180)
        || ''
      return {
        ref,
        role: roleFor(element),
        name,
        value: typeof input.value === 'string' ? input.value : undefined,
        focused: document.activeElement === element,
        checked: typeof input.checked === 'boolean' ? input.checked : undefined,
        disabled: typeof input.disabled === 'boolean' ? input.disabled : undefined,
      }
    })
  })
  return { url: page.url(), title: await page.title(), nodes }
}

async function elementGeometry(page, ref) {
  return await page.evaluate((targetRef) => {
    const element = document.querySelector(`[data-craft-agent-ref="${CSS.escape(targetRef)}"]`)
    if (!element) throw new Error(`Element ref not found: ${targetRef}`)
    const rect = element.getBoundingClientRect()
    return {
      ref: targetRef,
      role: element.getAttribute('role') || element.tagName.toLowerCase(),
      name: element.getAttribute('aria-label') || element.textContent?.trim().slice(0, 120) || '',
      box: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
      clickPoint: { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 },
    }
  }, ref)
}

async function renderAnnotationOverlay(page, geometries, metadataText) {
  await page.evaluate(({ targets, metadata }) => {
    document.getElementById('__craft_agent_annotation_overlay__')?.remove()
    const root = document.createElement('div')
    root.id = '__craft_agent_annotation_overlay__'
    Object.assign(root.style, {
      position: 'fixed', inset: '0', zIndex: '2147483647', pointerEvents: 'none',
      fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
    })
    for (const target of targets) {
      const box = document.createElement('div')
      Object.assign(box.style, {
        position: 'absolute', left: `${target.box.x}px`, top: `${target.box.y}px`,
        width: `${target.box.width}px`, height: `${target.box.height}px`,
        border: '2px solid #7c3aed', borderRadius: '4px', boxSizing: 'border-box',
        background: 'rgba(124, 58, 237, 0.06)',
      })
      const label = document.createElement('span')
      label.textContent = `@${target.ref}`
      Object.assign(label.style, {
        position: 'absolute', left: '-2px', top: target.box.y < 22 ? '0' : '-20px', height: '18px',
        padding: '1px 4px', borderRadius: '4px 4px 4px 0',
        background: '#7c3aed', color: 'white', fontSize: '11px', lineHeight: '16px',
        fontWeight: '600', whiteSpace: 'nowrap',
      })
      box.appendChild(label)
      root.appendChild(box)
    }
    if (metadata) {
      const badge = document.createElement('div')
      badge.textContent = metadata
      Object.assign(badge.style, {
        position: 'absolute', right: '12px', bottom: '12px', padding: '5px 8px',
        borderRadius: '6px', background: 'rgba(17, 24, 39, 0.9)', color: 'white',
        fontSize: '11px', boxShadow: '0 2px 8px rgba(0,0,0,.25)',
      })
      root.appendChild(badge)
    }
    document.documentElement.appendChild(root)
  }, { targets: geometries, metadata: metadataText })
}

async function clearAnnotationOverlay(page) {
  await page.evaluate(() => document.getElementById('__craft_agent_annotation_overlay__')?.remove()).catch(() => {})
}

async function screenshot(instance, options = {}) {
  if (!options.annotate && options.mode !== 'agent') {
    const data = await instance.page.screenshot({
      type: options.format === 'jpeg' ? 'jpeg' : 'png',
      quality: options.format === 'jpeg' ? options.jpegQuality ?? 80 : undefined,
    })
    return { base64: data.toString('base64'), imageFormat: options.format === 'jpeg' ? 'jpeg' : 'png' }
  }

  const snapshot = await snapshotPage(instance.page)
  const refs = options.refs?.length ? options.refs : snapshot.nodes.map((node) => node.ref).slice(0, 100)
  const geometries = []
  for (const ref of refs) {
    try { geometries.push(await elementGeometry(instance.page, ref)) } catch {}
  }
  if (options.includeLastAction && instance.lastAction?.geometry
    && !geometries.some((geometry) => geometry.ref === instance.lastAction.geometry.ref)) {
    geometries.push(instance.lastAction.geometry)
  }
  const metadataText = instance.lastAction
    ? `${instance.lastAction.tool} • ${instance.lastAction.status}`
    : `browser_screenshot • ${new Date().toISOString()}`
  await renderAnnotationOverlay(instance.page, geometries, options.includeMetadata ? metadataText : '')
  try {
    const format = options.format === 'jpeg' ? 'jpeg' : 'png'
    const data = await instance.page.screenshot({
      type: format,
      quality: format === 'jpeg' ? options.jpegQuality ?? 80 : undefined,
    })
    return {
      base64: data.toString('base64'),
      imageFormat: format,
      metadata: {
        mode: 'agent',
        viewport: instance.viewport,
        targets: geometries,
        action: instance.lastAction ?? undefined,
      },
    }
  } finally {
    await clearAnnotationOverlay(instance.page)
  }
}

async function recordAction(instance, tool, ref, action) {
  try {
    const geometry = ref ? await elementGeometry(instance.page, ref) : undefined
    await action()
    instance.lastAction = { tool, ref, status: 'success', timestamp: Date.now(), geometry }
  } catch (error) {
    instance.lastAction = { tool, ref, status: 'error', timestamp: Date.now() }
    throw error
  }
}

async function handle(method, args) {
  switch (method) {
    case 'createInstance': return await createInstance(args[0], args[1])
    case 'createForSession': return await createInstance(undefined, {
      show: args[1]?.show ?? false,
      ownerType: 'session',
      ownerSessionId: args[0],
      workspaceId: args[1]?.workspaceId ?? null,
    })
    case 'getOrCreateForSession': {
      const found = [...instances.values()].find((item) => item.boundSessionId === args[0])
      return found?.id ?? await handle('createForSession', args)
    }
    case 'listInstances': return await Promise.all([...instances.values()].map(publicInfo))
    case 'getInstance': {
      const instance = instances.get(args[0])
      if (!instance) return undefined
      const info = await publicInfo(instance)
      return {
        ownerType: info.ownerType, ownerSessionId: info.ownerSessionId,
        isVisible: info.isVisible, title: info.title, currentUrl: info.url,
      }
    }
    case 'focus': return await focusInstance(requireInstance(args[0]))
    case 'hide': {
      const instance = requireInstance(args[0])
      instance.isVisible = false
      if (activeInstanceId === instance.id) activeInstanceId = null
      await stopScreencast(instance)
      return await emitState(instance)
    }
    case 'destroyInstance': {
      const instance = instances.get(args[0])
      if (!instance) return
      instances.delete(instance.id)
      if (activeInstanceId === instance.id) activeInstanceId = null
      await stopScreencast(instance)
      await instance.cdp?.detach().catch(() => {})
      await instance.page.close().catch(() => {})
      return sendEvent('removed', { id: instance.id })
    }
    case 'destroyForSession': {
      const ids = [...instances.values()].filter((item) => item.boundSessionId === args[0]).map((item) => item.id)
      for (const id of ids) await handle('destroyInstance', [id])
      return
    }
    case 'unbindAllForSession': {
      for (const instance of instances.values()) {
        if (instance.boundSessionId === args[0]) instance.boundSessionId = null
      }
      return
    }
    case 'bindSession': {
      const instance = requireInstance(args[0])
      instance.boundSessionId = args[1]
      instance.ownerSessionId ??= args[1]
      instance.workspaceId = args[2]?.workspaceId ?? instance.workspaceId
      return await emitState(instance)
    }
    case 'setAgentControl': {
      for (const instance of instances.values()) {
        if (instance.boundSessionId === args[0]) {
          instance.agentControl = { active: true, ...args[1] }
          await emitState(instance)
        }
      }
      return
    }
    case 'clearAgentControl': {
      for (const instance of instances.values()) {
        if (instance.boundSessionId === args[0]) {
          instance.agentControl = null
          await emitState(instance)
        }
      }
      return
    }
    case 'clearAgentControlForInstance': {
      const instance = instances.get(args[0])
      if (!instance || (args[1] && instance.boundSessionId !== args[1])) return { released: false, reason: 'not-owned' }
      instance.agentControl = null
      await emitState(instance)
      return { released: true }
    }
    case 'navigate': {
      const instance = requireInstance(args[0])
      instance.isLoading = true
      await emitState(instance)
      await instance.page.goto(normalizeUrl(args[1]), { waitUntil: 'domcontentloaded', timeout: 30_000 })
      instance.isLoading = false
      await emitState(instance)
      return { url: instance.page.url(), title: await instance.page.title() }
    }
    case 'goBack': await requireInstance(args[0]).page.goBack({ waitUntil: 'domcontentloaded' }); return
    case 'goForward': await requireInstance(args[0]).page.goForward({ waitUntil: 'domcontentloaded' }); return
    case 'reload': await requireInstance(args[0]).page.reload({ waitUntil: 'domcontentloaded' }); return
    case 'stop': await requireInstance(args[0]).page.evaluate(() => window.stop()); return
    case 'getAccessibilitySnapshot': return await snapshotPage(requireInstance(args[0]).page)
    case 'clickElement': {
      const instance = requireInstance(args[0]); const ref = args[1]
      return await recordAction(instance, 'browser_click', ref, async () => {
        await instance.page.locator(`[data-craft-agent-ref="${ref}"]`).click()
      })
    }
    case 'clickAtCoordinates': {
      const instance = requireInstance(args[0])
      return await recordAction(instance, 'browser_click_at', undefined, () => instance.page.mouse.click(args[1], args[2]))
    }
    case 'drag': {
      const instance = requireInstance(args[0])
      await instance.page.mouse.move(args[1], args[2]); await instance.page.mouse.down()
      await instance.page.mouse.move(args[3], args[4], { steps: 12 }); await instance.page.mouse.up(); return
    }
    case 'fillElement': {
      const instance = requireInstance(args[0]); const ref = args[1]
      return await recordAction(instance, 'browser_fill', ref, () => instance.page.locator(`[data-craft-agent-ref="${ref}"]`).fill(args[2]))
    }
    case 'typeText': return await requireInstance(args[0]).page.keyboard.type(args[1])
    case 'selectOption': return await requireInstance(args[0]).page.locator(`[data-craft-agent-ref="${args[1]}"]`).selectOption(args[2])
    case 'sendKey': {
      const instance = requireInstance(args[0]); const keyArgs = args[1]
      const combo = [...(keyArgs.modifiers ?? []).map((item) => item[0].toUpperCase() + item.slice(1)), keyArgs.key].join('+')
      return await instance.page.keyboard.press(combo)
    }
    case 'pointer': {
      const instance = requireInstance(args[0]); const input = args[1]
      if (input.kind === 'move') return await instance.page.mouse.move(input.x, input.y)
      if (input.kind === 'down') {
        await instance.page.mouse.move(input.x, input.y)
        return await instance.page.mouse.down({ button: input.button ?? 'left' })
      }
      if (input.kind === 'up') {
        await instance.page.mouse.move(input.x, input.y)
        return await instance.page.mouse.up({ button: input.button ?? 'left' })
      }
      if (input.kind === 'click') return await instance.page.mouse.click(input.x, input.y, { button: input.button ?? 'left', clickCount: input.clickCount ?? 1 })
      if (input.kind === 'wheel') {
        await instance.page.mouse.move(input.x, input.y)
        return await instance.page.mouse.wheel(input.deltaX ?? 0, input.deltaY ?? 0)
      }
      return
    }
    case 'keyboard': {
      const instance = requireInstance(args[0]); const input = args[1]
      if (input.kind === 'type') return await instance.page.keyboard.type(input.text)
      if (input.kind === 'press') return await instance.page.keyboard.press(input.key)
      if (input.kind === 'down') return await instance.page.keyboard.down(input.key)
      if (input.kind === 'up') return await instance.page.keyboard.up(input.key)
      return
    }
    case 'setClipboard': clipboardText = args[1]; return
    case 'getClipboard': return clipboardText
    case 'scroll': {
      const amount = args[2] ?? 600
      const delta = { up: [0, -amount], down: [0, amount], left: [-amount, 0], right: [amount, 0] }[args[1]]
      return await requireInstance(args[0]).page.mouse.wheel(delta[0], delta[1])
    }
    case 'uploadFile': return await requireInstance(args[0]).page.locator(`[data-craft-agent-ref="${args[1]}"]`).setInputFiles(args[2])
    case 'evaluate': return await requireInstance(args[0]).page.evaluate(args[1])
    case 'screenshot': return await screenshot(requireInstance(args[0]), args[1])
    case 'screenshotRegion': {
      const instance = requireInstance(args[0]); const target = args[1]
      let clip
      if (target.ref) clip = (await elementGeometry(instance.page, target.ref)).box
      else if (target.selector) clip = await instance.page.locator(target.selector).boundingBox()
      else clip = { x: target.x, y: target.y, width: target.width, height: target.height }
      const padding = target.padding ?? 0
      const data = await instance.page.screenshot({
        type: target.format === 'jpeg' ? 'jpeg' : 'png',
        quality: target.format === 'jpeg' ? target.jpegQuality ?? 80 : undefined,
        clip: { x: Math.max(0, clip.x - padding), y: Math.max(0, clip.y - padding), width: clip.width + padding * 2, height: clip.height + padding * 2 },
      })
      return { base64: data.toString('base64'), imageFormat: target.format === 'jpeg' ? 'jpeg' : 'png' }
    }
    case 'windowResize': {
      const instance = requireInstance(args[0])
      instance.viewport = { width: Math.max(320, Math.round(args[1])), height: Math.max(240, Math.round(args[2])) }
      await stopScreencast(instance)
      await instance.page.setViewportSize(instance.viewport)
      if (instance.isVisible) await startScreencast(instance)
      return instance.viewport
    }
    case 'getConsoleLogs': {
      const instance = requireInstance(args[0]); const options = args[1] ?? {}
      const filtered = options.level && options.level !== 'all' ? instance.consoleLogs.filter((item) => item.level === options.level) : instance.consoleLogs
      return filtered.slice(-(options.limit ?? 100))
    }
    case 'getNetworkLogs': {
      const instance = requireInstance(args[0]); const options = args[1] ?? {}
      let filtered = instance.networkLogs
      if (options.method) filtered = filtered.filter((item) => item.method === options.method)
      if (options.resourceType) filtered = filtered.filter((item) => item.resourceType === options.resourceType)
      return filtered.slice(-(options.limit ?? 100))
    }
    case 'waitFor': {
      const page = requireInstance(args[0]).page; const options = args[1]; const started = Date.now()
      if (options.kind === 'selector') await page.locator(options.value).waitFor({ timeout: options.timeoutMs })
      else if (options.kind === 'text') await page.getByText(options.value).waitFor({ timeout: options.timeoutMs })
      else if (options.kind === 'url') await page.waitForURL(options.value, { timeout: options.timeoutMs })
      else await page.waitForLoadState('networkidle', { timeout: options.timeoutMs })
      return { ok: true, kind: options.kind, elapsedMs: Date.now() - started, detail: options.value ?? '' }
    }
    case 'getDownloads': return requireInstance(args[0]).downloads.slice(-(args[1]?.limit ?? 20))
    case 'detectSecurityChallenge': {
      const page = requireInstance(args[0]).page
      const signals = await page.evaluate(() => {
        const text = document.body?.innerText?.toLowerCase() ?? ''
        return ['captcha', 'verify you are human', 'cloudflare', 'security check'].filter((item) => text.includes(item))
      })
      return { detected: signals.length > 0, provider: signals.includes('cloudflare') ? 'cloudflare' : signals.length ? 'unknown' : 'none', signals }
    }
    case 'shutdown': {
      for (const instance of instances.values()) await stopScreencast(instance)
      await context?.close()
      return
    }
    default: throw new Error(`Unknown browser worker method: ${method}`)
  }
}

const input = createInterface({ input: process.stdin, crlfDelay: Infinity })
input.on('line', async (line) => {
  let request
  try { request = JSON.parse(line) } catch { return }
  try {
    const result = await handle(request.method, request.args ?? [])
    send({ id: request.id, result })
  } catch (error) {
    send({ id: request.id, error: serializeError(error) })
  }
})

process.on('SIGTERM', () => { void handle('shutdown', []) })
process.on('SIGINT', () => { void handle('shutdown', []) })
