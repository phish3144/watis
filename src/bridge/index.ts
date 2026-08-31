import { healthcheck, type PageGlobals } from './modules'
import { CHAT_COLLECTION, CONTACT_COLLECTION, MSG_COLLECTION } from './signatures'
import { observe, snapshot, type MirrorEvent, type ObserverHandle } from './observer'
import { downloadMedia, earliestReachableTs, loadOlder, openChat } from './operations'
import { summarise, TO_HOST, TO_PAGE, type BridgeCommand, type BridgeMessage } from './protocol'

/**
 * The bridge's entry point, evaluated inside WhatsApp Web's own JavaScript context.
 *
 * It is injected as a string by the main process after the document loads, because `window.require`
 * only exists in the page world and the preload cannot reach it. That also means every error here
 * lands in a WhatsApp stack frame — so nothing throws out of this file. A bridge that fails must
 * leave a working messenger behind (PLAN.md Phase 3, DoD).
 */

/**
 * Only what the bridge actually touches, declared here rather than pulled from the DOM library.
 *
 * The page is somebody else's and its globals are not ours to assume: naming the four members we
 * use is both a smaller promise and the reason this file compiles in the same project as the
 * Node-side tests that drive it against a fake page.
 */
interface PageDocument {
  addEventListener(type: string, listener: (event: unknown) => void): void
  removeEventListener(type: string, listener: (event: unknown) => void): void
  dispatchEvent(event: unknown): unknown
}

declare const window: PageGlobals & {
  __watisBridge?: { stop: () => void }
  document: PageDocument
  CustomEvent: new (type: string, init: { detail: string }) => unknown
  setTimeout: (handler: () => void, ms?: number) => ReturnType<typeof setTimeout>
  clearTimeout: (handle: ReturnType<typeof setTimeout>) => void
}

/**
 * Events are batched before they cross into the isolated world. A busy group emits hundreds a
 * second and one CustomEvent each would cost more than the mirroring itself; 250 ms matches the
 * importer's own flush interval, so a batch arrives roughly once per drain (§3.1).
 */
const FLUSH_MS = 250
const MAX_PENDING = 2000

export function install(): { stop: () => void } {
  const globals = window as PageGlobals
  let pending: MirrorEvent[] = []
  let dropped = 0
  let timer: ReturnType<typeof setTimeout> | undefined
  let observer: ObserverHandle | undefined

  const post = (message: BridgeMessage): void => {
    try {
      window.document.dispatchEvent(new CustomEvent(TO_HOST, { detail: JSON.stringify(message) }))
    } catch {
      // The host is gone or the payload is not serialisable. Dropping is correct: the page must
      // not carry our failure.
    }
  }

  const flush = (snapshotDone = false): void => {
    timer = undefined
    if (pending.length === 0 && !snapshotDone) return
    const events = pending
    pending = []
    post(snapshotDone ? { type: 'batch', events, snapshotDone: true } : { type: 'batch', events })
  }

  const schedule = (): void => {
    if (timer !== undefined) return
    timer = window.setTimeout(() => {
      flush()
    }, FLUSH_MS)
  }

  const emit = (event: MirrorEvent): void => {
    // Bounded on this side too. The importer's ring buffer protects the main process; this one
    // protects the page, which is the thing the user is actually looking at.
    if (pending.length >= MAX_PENDING) {
      dropped += 1
      return
    }
    pending.push(event)
    schedule()
  }

  const report = healthcheck(globals, [CHAT_COLLECTION, MSG_COLLECTION, CONTACT_COLLECTION])
  if (report.ok) observer = observe(globals, emit)

  post({ type: 'ready', ...summarise(report), attached: observer?.attached ?? 0 })

  const run = async (command: BridgeCommand): Promise<unknown> => {
    const args = command.args ?? {}
    switch (command.op) {
      case 'healthcheck':
        return summarise(
          healthcheck(globals, [CHAT_COLLECTION, MSG_COLLECTION, CONTACT_COLLECTION]),
        )
      case 'snapshot': {
        let count = 0
        for (const batch of snapshot(globals)) {
          for (const event of batch) emit(event)
          count += batch.length
          // Yield to the page between chunks. WhatsApp Web has to stay usable while the initial
          // import runs, and a synchronous walk of every collection would freeze it (§3.1).
          await new Promise<void>((resolve) =>
            window.setTimeout(() => {
              resolve()
            }, 0),
          )
        }
        flush(true)
        return { count, dropped }
      }
      case 'openChat': {
        if (typeof args.chatId !== 'string') throw new Error('chatId is required')
        return openChat(globals, {
          chatId: args.chatId,
          msgId: typeof args.msgId === 'string' ? args.msgId : undefined,
        })
      }
      case 'loadOlder': {
        if (typeof args.chatId !== 'string') throw new Error('chatId is required')
        return loadOlder(globals, args.chatId)
      }
      case 'earliestReachableTs':
        return earliestReachableTs(globals)
      case 'downloadMedia': {
        if (typeof args.msgId !== 'string') throw new Error('msgId is required')
        return downloadMedia(globals, args.msgId)
      }
      default:
        throw new Error(`unknown bridge op`)
    }
  }

  const onCommand = (event: unknown): void => {
    let command: BridgeCommand
    try {
      command = JSON.parse((event as { detail: string }).detail) as BridgeCommand
    } catch {
      return
    }
    void run(command).then(
      (value) => {
        post({ type: 'result', id: command.id, ok: true, value })
      },
      (error: unknown) => {
        post({ type: 'result', id: command.id, ok: false, error: String(error) })
      },
    )
  }

  window.document.addEventListener(TO_PAGE, onCommand)

  return {
    stop: () => {
      window.document.removeEventListener(TO_PAGE, onCommand)
      if (timer !== undefined) window.clearTimeout(timer)
      observer?.stop()
      pending = []
    },
  }
}

// Re-injection happens on every navigation, and WhatsApp Web navigates on its own. Without this
// the listeners would stack and every message would be mirrored several times over.
window.__watisBridge?.stop()
window.__watisBridge = install()
