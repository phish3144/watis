import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { BridgeMessage } from '../../src/bridge/protocol'

/**
 * Exercises the bundle that gets injected into WhatsApp's page, against a fake page.
 *
 * The point is the contract at the world boundary: what it posts, when it batches, and that it
 * never throws into the page. The collections are fakes shaped like WhatsApp's — the real shapes
 * are pinned separately in bridge.test.ts and verified by hand against a live session.
 */

type Listener = (event: { detail: string }) => void

class FakeDocument {
  listeners = new Map<string, Listener[]>()
  posted: BridgeMessage[] = []

  addEventListener(type: string, listener: Listener): void {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener])
  }
  removeEventListener(type: string, listener: Listener): void {
    this.listeners.set(
      type,
      (this.listeners.get(type) ?? []).filter((l) => l !== listener),
    )
  }
  dispatchEvent(event: { type: string; detail: string }): void {
    if (event.type === 'watis:bridge-out') {
      this.posted.push(JSON.parse(event.detail) as BridgeMessage)
      return
    }
    for (const listener of this.listeners.get(event.type) ?? []) listener(event)
  }
}

class FakeCollection {
  handlers = new Map<string, ((model: unknown) => void)[]>()
  constructor(readonly models: unknown[] = []) {}
  on(event: string, handler: (model: unknown) => void): void {
    this.handlers.set(event, [...(this.handlers.get(event) ?? []), handler])
  }
  off(event: string, handler: (model: unknown) => void): void {
    this.handlers.set(
      event,
      (this.handlers.get(event) ?? []).filter((h) => h !== handler),
    )
  }
  get(): unknown {
    return undefined
  }
  getModelsArray(): unknown[] {
    return this.models
  }
  fire(event: string, model: unknown): void {
    for (const handler of this.handlers.get(event) ?? []) handler(model)
  }
}

const message = (id: string, ts: number): Record<string, unknown> => ({
  id: { _serialized: id, remote: '4915100@c.us' },
  t: ts,
  type: 'chat',
  body: 'text',
})

const chat = (id: string): Record<string, unknown> => ({ id: { _serialized: id }, name: 'Chat' })

let doc: FakeDocument
let msgs: FakeCollection
let chats: FakeCollection
let contacts: FakeCollection

function buildPage(options: { healthy?: boolean } = {}): void {
  doc = new FakeDocument()
  msgs = new FakeCollection([message('m1', 1000), message('m2', 2000)])
  chats = new FakeCollection([chat('4915100@c.us')])
  contacts = new FakeCollection([])

  const modules: Record<string, unknown> = {
    WAWebMsgCollection: { MsgCollection: msgs },
    WAWebChatCollection: { ChatCollection: chats },
    WAWebContactCollection: { ContactCollection: contacts },
  }

  const globals = {
    document: doc,
    // Looked up lazily rather than bound: a test that installs fake timers does so after the
    // page is built, and a bound reference would keep using the real ones.
    setTimeout: (fn: () => void, ms?: number) => globalThis.setTimeout(fn, ms),
    clearTimeout: (handle: ReturnType<typeof setTimeout>) => {
      globalThis.clearTimeout(handle)
    },
    require: (name: string): unknown => {
      if (options.healthy === false) throw new Error(`Module ${name} has not been registered`)
      const value = modules[name]
      if (!value) throw new Error(`Module ${name} has not been registered`)
      return value
    },
  }
  ;(globalThis as Record<string, unknown>).window = {
    ...globals,
    // The bridge takes CustomEvent off the window rather than off a global, because the page it
    // runs in is somebody else's and its globals are not ours to assume.
    CustomEvent: class {
      detail: string
      constructor(
        readonly type: string,
        init: { detail: string },
      ) {
        this.detail = init.detail
      }
    },
  }
}

const load = async (): Promise<void> => {
  vi.resetModules()
  await import('../../src/bridge/index')
}

const command = (op: string, args?: Record<string, unknown>): void => {
  doc.dispatchEvent({
    type: 'watis:bridge-in',
    detail: JSON.stringify({ id: 1, op, args }),
  })
}

describe('the injected bridge', () => {
  beforeEach(() => {
    buildPage()
  })

  afterEach(() => {
    const w = (globalThis as Record<string, unknown>).window as { __watisBridge?: { stop(): void } }
    w?.__watisBridge?.stop()
    delete (globalThis as Record<string, unknown>).window
  })

  it('announces itself as ready with what it resolved', async () => {
    await load()
    const ready = doc.posted[0]
    expect(ready).toMatchObject({ type: 'ready', ok: true })
    expect((ready as { resolved: string[] }).resolved).toContain('WAWebMsgCollection')
    expect((ready as { attached: number }).attached).toBeGreaterThan(0)
  })

  it('reports the failure instead of attaching when the bundle has moved', async () => {
    buildPage({ healthy: false })
    await load()
    const ready = doc.posted[0] as { ok: boolean; attached: number; failures: unknown[] }
    expect(ready.ok).toBe(false)
    expect(ready.attached).toBe(0)
    expect(ready.failures.length).toBeGreaterThan(0)
    // A dead bridge must still leave a working messenger behind: nothing was subscribed, and
    // nothing threw.
    expect(msgs.handlers.size).toBe(0)
  })

  it('batches live events rather than posting one per message', async () => {
    vi.useFakeTimers()
    try {
      await load()
      const before = doc.posted.length
      msgs.fire('add', message('m3', 3000))
      msgs.fire('add', message('m4', 4000))
      expect(doc.posted).toHaveLength(before)

      await vi.advanceTimersByTimeAsync(300)
      const batch = doc.posted.at(-1) as { type: string; events: unknown[] }
      expect(batch.type).toBe('batch')
      expect(batch.events).toHaveLength(2)
    } finally {
      vi.useRealTimers()
    }
  })

  it('walks the collections on snapshot and marks the end', async () => {
    await load()
    command('snapshot')
    await vi.waitFor(() => {
      expect(doc.posted.some((m) => m.type === 'batch' && m.snapshotDone === true)).toBe(true)
    })
    const rows = doc.posted
      .filter((m): m is Extract<BridgeMessage, { type: 'batch' }> => m.type === 'batch')
      .flatMap((m) => m.events)
    expect(rows.filter((e) => e.kind === 'message')).toHaveLength(2)
    expect(rows.filter((e) => e.kind === 'chat')).toHaveLength(1)
  })

  it('answers an unknown command with a failure, not a throw', async () => {
    await load()
    command('deleteEverything')
    await vi.waitFor(() => {
      const result = doc.posted.find((m) => m.type === 'result')
      expect(result).toMatchObject({ type: 'result', ok: false })
    })
  })

  it('replaces itself on re-injection instead of stacking listeners', async () => {
    await load()
    const attachedOnce = msgs.handlers.get('add')?.length ?? 0
    await load()
    // WhatsApp Web navigates on its own; without teardown every message would be mirrored twice.
    expect(msgs.handlers.get('add')?.length ?? 0).toBe(attachedOnce)
  })

  it('stops mirroring once stopped', async () => {
    vi.useFakeTimers()
    try {
      await load()
      const w = (globalThis as Record<string, unknown>).window as {
        __watisBridge: { stop(): void }
      }
      w.__watisBridge.stop()
      const before = doc.posted.length
      msgs.fire('add', message('m9', 9000))
      await vi.advanceTimersByTimeAsync(300)
      expect(doc.posted).toHaveLength(before)
    } finally {
      vi.useRealTimers()
    }
  })
})
