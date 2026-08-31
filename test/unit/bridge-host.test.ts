import { beforeEach, describe, expect, it, vi } from 'vitest'
import { EventEmitter } from 'node:events'

const ipcHandlers = new Map<string, (event: unknown, ...args: unknown[]) => void>()

vi.mock('electron', () => ({
  app: { isPackaged: false, getAppPath: () => '/app' },
  ipcMain: {
    on: (channel: string, handler: (event: unknown, ...args: unknown[]) => void) => {
      ipcHandlers.set(channel, handler)
    },
  },
}))
vi.mock('../../src/main/logging', () => ({
  log: { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))
vi.mock('node:fs/promises', () => ({ readFile: vi.fn(() => Promise.resolve('BRIDGE_SOURCE')) }))

const { BridgeHost } = await import('../../src/main/bridge/host')
import type { ImportEvent } from '../../src/main/archive/importer'

/** Stands in for the WhatsApp view: records what was injected and what was sent to the page. */
class FakeContents extends EventEmitter {
  injected: string[] = []
  sent: { channel: string; payload: string }[] = []
  destroyed = false

  isDestroyed(): boolean {
    return this.destroyed
  }
  executeJavaScript(code: string): Promise<void> {
    this.injected.push(code)
    return Promise.resolve()
  }
  send(channel: string, payload: string): void {
    this.sent.push({ channel, payload })
  }
}

const firstSent = (contents: FakeContents): string => {
  const first = contents.sent[0]
  if (!first) throw new Error('nothing was sent to the page')
  return first.payload
}

const deliver = (contents: FakeContents, message: unknown): void => {
  ipcHandlers.get('wa:bridge-message')?.({ sender: contents }, JSON.stringify(message))
}

describe('BridgeHost', () => {
  let contents: FakeContents
  let events: ImportEvent[]
  let health: { ok: boolean }[]
  let snapshots: number

  const build = (): InstanceType<typeof BridgeHost> => {
    const host = new BridgeHost({
      onEvents: (batch) => events.push(...batch),
      onHealth: (report) => health.push(report),
      onSnapshotDone: () => {
        snapshots += 1
      },
    })
    host.attach(contents as never)
    return host
  }

  beforeEach(() => {
    ipcHandlers.clear()
    contents = new FakeContents()
    events = []
    health = []
    snapshots = 0
  })

  it('injects the bundle on every load, not once', async () => {
    const host = build()
    contents.emit('did-finish-load')
    await vi.waitFor(() => {
      expect(contents.injected).toHaveLength(1)
    })

    // WhatsApp Web reloads itself after a logout or a socket loss; a bridge injected only once
    // would be gone from that point on.
    contents.emit('did-finish-load')
    await vi.waitFor(() => {
      expect(contents.injected).toHaveLength(2)
    })
    expect(contents.injected[0]).toBe('BRIDGE_SOURCE')
    host.dispose()
  })

  it('refuses commands until the page reports a healthy bridge', () => {
    const host = build()
    expect(host.ready).toBe(false)
    deliver(contents, {
      type: 'ready',
      ok: true,
      resolved: ['WAWebMsgCollection'],
      failures: [],
      attached: 3,
    })
    expect(host.ready).toBe(true)
    host.dispose()
  })

  it('goes not-ready when the modules stop resolving', () => {
    const host = build()
    deliver(contents, { type: 'ready', ok: true, resolved: [], failures: [], attached: 1 })
    deliver(contents, {
      type: 'ready',
      ok: false,
      resolved: [],
      failures: [{ module: 'WAWebMsgCollection', reason: 'not-registered' }],
      attached: 0,
    })
    expect(host.ready).toBe(false)
    expect(health.at(-1)?.ok).toBe(false)
    host.dispose()
  })

  it('hands mirrored batches on and flags the end of the snapshot', () => {
    const host = build()
    deliver(contents, {
      type: 'batch',
      events: [{ kind: 'message', row: { id: 'a' } }],
    })
    deliver(contents, { type: 'batch', events: [], snapshotDone: true })
    expect(events).toHaveLength(1)
    expect(snapshots).toBe(1)
    host.dispose()
  })

  it('ignores a message from a view it is not attached to', () => {
    const host = build()
    const other = new FakeContents()
    ipcHandlers.get('wa:bridge-message')?.(
      { sender: other },
      JSON.stringify({ type: 'batch', events: [{ kind: 'message', row: { id: 'x' } }] }),
    )
    expect(events).toHaveLength(0)
    host.dispose()
  })

  it('survives a malformed message instead of throwing into the app', () => {
    const host = build()
    expect(() =>
      ipcHandlers.get('wa:bridge-message')?.({ sender: contents }, '{ not json'),
    ).not.toThrow()
    host.dispose()
  })

  it("resolves a command with the page's answer", async () => {
    const host = build()
    const pending = host.send('loadOlder', { chatId: '4915100@c.us' })

    const sent = JSON.parse(firstSent(contents)) as { id: number; op: string; args: unknown }
    expect(sent.op).toBe('loadOlder')
    expect(sent.args).toEqual({ chatId: '4915100@c.us' })

    deliver(contents, { type: 'result', id: sent.id, ok: true, value: { loaded: 50 } })
    await expect(pending).resolves.toEqual({ loaded: 50 })
    host.dispose()
  })

  it('rejects a command the page fails', async () => {
    const host = build()
    const pending = host.send('openChat', { chatId: 'x' })
    const sent = JSON.parse(firstSent(contents)) as { id: number }
    deliver(contents, { type: 'result', id: sent.id, ok: false, error: 'no such chat' })
    await expect(pending).rejects.toThrow('no such chat')
    host.dispose()
  })

  it('rejects rather than hanging when the page never answers', async () => {
    vi.useFakeTimers()
    try {
      const host = build()
      const pending = host.send('snapshot')
      const assertion = expect(pending).rejects.toThrow('did not answer')
      await vi.advanceTimersByTimeAsync(31_000)
      await assertion
      host.dispose()
    } finally {
      vi.useRealTimers()
    }
  })

  it('settles everything outstanding when it shuts down', async () => {
    const host = build()
    const pending = host.send('snapshot')
    host.dispose()
    await expect(pending).rejects.toThrow('shutting down')
  })
})
