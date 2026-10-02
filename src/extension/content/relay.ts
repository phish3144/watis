import { TO_HOST, TO_PAGE, type BridgeCommand, type BridgeMessage } from '../../bridge/protocol'
import { Importer, type ImporterStats } from '../../main/archive/importer'
import { buildCss } from '../../main/ui-layer/css'
import {
  activeChatTitle,
  readUnreadFromIndexedDb,
  readUnreadFromTitle,
} from '../../preload/page-reading'
import { parseSettings, type Settings } from '@shared/settings'
import { ext, send } from '../ext'
import { SETTINGS_KEY, isMessage, type Reply } from '../protocol'
import { CONNECT, frameTokenKey, randomId, type FromFrame, type ToFrame } from '../host/frame-link'

/**
 * The extension's half of the desktop preload, running as an isolated-world content script in the
 * WhatsApp tab (ADR 0010).
 *
 * It owns the importer's ring buffer, because this is the one context that lives exactly as long
 * as the bridge that fills it. The archive itself lives in a hidden extension frame; when that
 * frame is not up yet — at page load the bridge is faster than the database — the buffer simply
 * holds the events until it is, which is the job it already had on the desktop.
 *
 * It never writes to WhatsApp. It relays the bridge's read-only commands, reads the unread count
 * from WhatsApp's IndexedDB like the desktop preload does, and hangs the host frame into the page.
 */

const COMMAND_TIMEOUT_MS = 30_000
/** The snapshot walks every collection in chunks and can take a while on a large account. */
const SNAPSHOT_TIMEOUT_MS = 180_000
const POLL_MS = 2_000

// --- the archive host frame -------------------------------------------------------------------

/**
 * The database runs in an extension page framed into this tab, invisibly. It lives as long as the
 * tab — exactly as long as there is anything to archive — and it is the one place that works the
 * same in Chrome, Edge and Firefox (docs/extension-spike.md, third experiment).
 */
let frame: HTMLIFrameElement | undefined
let port: MessagePort | undefined
let hostOnline = false
let mounting = false
let nextFrameCall = 1
const frameCalls = new Map<number, (reply: Reply) => void>()

/**
 * Hangs the archive frame into the page and hands it a private port (`frame-link.ts`). The token
 * goes through `storage.local`, which WhatsApp's page cannot read, so only this content script can
 * be the one that connects.
 */
async function mountHostFrame(): Promise<void> {
  if (frame?.isConnected || mounting) return
  mounting = true
  try {
    port?.close()
    port = undefined
    hostOnline = false
    const frameId = randomId()
    const token = randomId()
    await ext.storage.local.set({ [frameTokenKey(frameId)]: { token, at: Date.now() } })

    const element = document.createElement('iframe')
    const src = `${ext.runtime.getURL('host.html')}#${frameId}`
    element.src = src
    element.setAttribute('aria-hidden', 'true')
    element.tabIndex = -1
    element.style.cssText = 'display:none !important'
    element.addEventListener('load', () => {
      const channel = new MessageChannel()
      port = channel.port1
      port.onmessage = (event: MessageEvent<FromFrame>) => {
        void fromFrame(event.data)
      }
      element.contentWindow?.postMessage({ type: CONNECT, token }, new URL(src).origin, [
        channel.port2,
      ])
      toFrame({ kind: 'bridge-state', ok: bridgeOk })
    })
    ;(document.body ?? document.documentElement).appendChild(element)
    frame = element
  } finally {
    mounting = false
  }
}

function toFrame(message: ToFrame): void {
  port?.postMessage(message)
}

/** One request to the archive frame. No port yet is an answer, not an exception. */
function askFrame(build: (id: number) => ToFrame, timeoutMs = 60_000): Promise<Reply> {
  if (!port) return Promise.resolve({ ok: false, error: 'the archive is not connected' })
  const id = nextFrameCall++
  return new Promise((resolve) => {
    const timer = window.setTimeout(() => {
      frameCalls.delete(id)
      resolve({ ok: false, error: 'the archive did not answer' })
    }, timeoutMs)
    frameCalls.set(id, (reply) => {
      window.clearTimeout(timer)
      resolve(reply)
    })
    toFrame(build(id))
  })
}

async function fromFrame(message: FromFrame): Promise<void> {
  switch (message.kind) {
    case 'reply':
      frameCalls.get(message.id)?.(message.reply)
      frameCalls.delete(message.id)
      return
    case 'bridge': {
      let reply: Reply
      try {
        reply = { ok: true, value: await runBridge(message.op, message.args) }
      } catch (error) {
        reply = { ok: false, error: String(error) }
      }
      toFrame({ id: message.id, kind: 'reply', reply })
      return
    }
    case 'status':
      void send({ kind: 'host-status', status: message.status })
      return
    case 'media':
      void send({ kind: 'media-stats', stats: message.stats })
      return
  }
}

// --- the bridge -------------------------------------------------------------------------------

const pending = new Map<
  number,
  { resolve: (value: unknown) => void; reject: (error: Error) => void; timer: number }
>()
let nextCommand = 1
let bridgeOk = false

function runBridge(op: BridgeCommand['op'], args?: Record<string, unknown>): Promise<unknown> {
  const id = nextCommand++
  const command: BridgeCommand = args ? { id, op, args } : { id, op }
  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(
      () => {
        pending.delete(id)
        reject(new Error(`bridge did not answer ${op}`))
      },
      op === 'snapshot' ? SNAPSHOT_TIMEOUT_MS : COMMAND_TIMEOUT_MS,
    )
    pending.set(id, { resolve, reject, timer })
    document.dispatchEvent(new CustomEvent(TO_PAGE, { detail: JSON.stringify(command) }))
  })
}

document.addEventListener(TO_HOST, (event) => {
  const detail = (event as CustomEvent<unknown>).detail
  if (typeof detail !== 'string') return
  let message: BridgeMessage
  try {
    message = JSON.parse(detail) as BridgeMessage
  } catch {
    return
  }

  switch (message.type) {
    case 'ready':
      bridgeOk = message.ok
      toFrame({ kind: 'bridge-state', ok: message.ok })
      void send({ kind: 'bridge-ready', report: message })
      if (message.ok) scheduleSnapshot()
      return
    case 'batch':
      for (const row of message.events) importer.push(row)
      return
    case 'result': {
      const entry = pending.get(message.id)
      if (!entry) return
      pending.delete(message.id)
      window.clearTimeout(entry.timer)
      if (message.ok) entry.resolve(message.value)
      else entry.reject(new Error(message.error ?? 'bridge command failed'))
      return
    }
  }
})

// --- the importer -----------------------------------------------------------------------------

/**
 * One batch to the archive frame. "Not connected" or "not the archive" is not an error to count —
 * the frame is still loading, or another context holds the database for a moment — so it marks the
 * host offline and stops the drain, and the events wait in the ring buffer instead of being thrown
 * away batch by batch.
 */
async function deliver(request: unknown): Promise<unknown> {
  const reply = await askFrame((id) => ({ id, kind: 'archive', request }))
  if (!reply.ok) {
    if (/not connected|not the archive|moved/.test(reply.error)) hostOnline = false
    throw new Error(reply.error)
  }
  return reply.value
}

const importer = new Importer(deliver)

async function probeHost(): Promise<void> {
  if (hostOnline) return
  try {
    await deliver({ op: 'stats' })
    hostOnline = true
    scheduleSnapshot()
  } catch {
    // Still offline; the next tick asks again.
  }
}

window.setInterval(() => {
  if (hostOnline && importer.stats().queued > 0) void importer.drain()
}, 250)

/**
 * Once per page, when both ends are up: hand over everything WhatsApp already holds in memory.
 * A snapshot only reads collections that are loaded anyway — no network, no read receipts — and
 * every row is an upsert, so running it again on the next visit costs time, not correctness.
 */
let snapshotDone = false
function scheduleSnapshot(): void {
  if (snapshotDone || !bridgeOk || !hostOnline) return
  snapshotDone = true
  // A moment's grace: WhatsApp is still painting its chat list right after the bridge comes up.
  window.setTimeout(() => {
    runBridge('snapshot').catch(() => {
      snapshotDone = false
    })
  }, 3_000)
}

// --- commands from the extension --------------------------------------------------------------

/** Requests from the panel and the background, sent to this tab with `tabs.sendMessage`. */
ext.runtime.onMessage.addListener((message: unknown, _sender, sendResponse) => {
  if (!isMessage(message)) return undefined
  const respond = (reply: Promise<Reply>): true => {
    void reply.then(sendResponse)
    return true
  }
  switch (message.kind) {
    case 'bridge':
      return respond(
        runBridge(message.op, message.args).then(
          (value): Reply => ({ ok: true, value }),
          (error: unknown): Reply => ({ ok: false, error: String(error) }),
        ),
      )
    case 'archive':
      return respond(askFrame((id) => ({ id, kind: 'archive', request: message.request })))
    case 'fetch-media':
      return respond(askFrame((id) => ({ id, kind: 'fetch-media', mediaId: message.mediaId })))
    case 'export-database':
      return respond(askFrame((id) => ({ id, kind: 'export-database' }), 300_000))
    case 'transcribe':
      // A long voice message on a slow machine takes minutes; the frame answers when it is done.
      return respond(
        askFrame(
          (id) => ({ id, kind: 'transcribe', mediaId: message.mediaId, path: message.path }),
          30 * 60_000,
        ),
      )
    case 'notify-event':
      document.dispatchEvent(
        new CustomEvent('watis:notify-event', {
          detail: JSON.stringify({ id: message.id, type: message.type }),
        }),
      )
      return undefined
    default:
      return undefined
  }
})

// --- notifications, from the page shim to the background --------------------------------------

document.addEventListener('watis:notify', (event) => {
  try {
    const notification = JSON.parse((event as CustomEvent<string>).detail) as unknown
    void send({ kind: 'notify', notification })
  } catch {
    /* malformed payload from the page: drop it */
  }
})

document.addEventListener('watis:notify-close', (event) => {
  try {
    const { id } = JSON.parse((event as CustomEvent<string>).detail) as { id?: unknown }
    if (typeof id === 'string') void send({ kind: 'notify-close', id })
  } catch {
    /* drop */
  }
})

// --- download names ---------------------------------------------------------------------------

/**
 * Read off the anchor in capture phase, as on the desktop: the browser's own suggested name for a
 * blob: download is not always the one WhatsApp shows, and the background names the file after it.
 */
document.addEventListener(
  'click',
  (event) => {
    const target = event.target
    if (!(target instanceof Element)) return
    const name = target.closest('a[download]')?.getAttribute('download')?.trim()
    if (name) void send({ kind: 'download-name', name })
  },
  true,
)

// --- settings: the CSS layer and the Enter key -------------------------------------------------

function applySettings(settings: Settings): void {
  const id = 'watis-ui-layer'
  let style = document.getElementById(id)
  if (!style) {
    style = document.createElement('style')
    style.id = id
    ;(document.head ?? document.documentElement).appendChild(style)
  }
  style.textContent = buildCss(settings)
  document.dispatchEvent(
    new CustomEvent('watis:page-config', {
      detail: JSON.stringify({ enterInsertsNewline: settings.enterInsertsNewline }),
    }),
  )
}

async function loadSettings(): Promise<void> {
  const stored = await ext.storage.local.get(SETTINGS_KEY)
  applySettings(parseSettings(stored[SETTINGS_KEY]))
}

ext.storage.onChanged.addListener((changes, area) => {
  const change = changes[SETTINGS_KEY]
  if (area === 'local' && change) applySettings(parseSettings(change.newValue))
})

// --- periodic reports -------------------------------------------------------------------------

let lastUnread = ''
let lastChat = ''
let lastStats = ''

async function report(): Promise<void> {
  const counts = (await readUnreadFromIndexedDb()) ?? readUnreadFromTitle()
  const unread = JSON.stringify(counts)
  if (unread !== lastUnread) {
    lastUnread = unread
    void send({ kind: 'unread', counts })
  }

  const chat = activeChatTitle()
  if (chat !== lastChat) {
    lastChat = chat
    void send({ kind: 'active-chat', title: chat })
  }

  const stats: ImporterStats = importer.stats()
  const serialised = JSON.stringify(stats)
  if (serialised !== lastStats) {
    lastStats = serialised
    void send({ kind: 'importer', stats })
  }

  await mountHostFrame()
  await probeHost()
}

// --- start ------------------------------------------------------------------------------------

void loadSettings()

function onReady(): void {
  void report()
  window.setInterval(() => void report(), POLL_MS)
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', onReady, { once: true })
} else {
  onReady()
}
