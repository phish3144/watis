import { beforeEach, describe, expect, it, vi } from 'vitest'

let idleSeconds = 600
vi.mock('electron', () => ({
  powerMonitor: { getSystemIdleTime: () => idleSeconds },
}))
vi.mock('../../src/main/logging', () => ({
  log: { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

const { BackfillController } = await import('../../src/main/backfill/controller')

interface Request {
  op: string
  rows?: { chatId: string; oldestTs: number | null; backfillDone: boolean }[]
}

describe('BackfillController', () => {
  let sent: { op: string; args?: Record<string, unknown> }[]
  let written: Request[]
  let stored: { chatId: string; backfillDone?: boolean }[]
  let bridgeReady: boolean
  let pages: Map<string, number>

  const bridge = {
    get ready(): boolean {
      return bridgeReady
    },
    send: (op: string, args?: Record<string, unknown>): Promise<unknown> => {
      sent.push(args ? { op, args } : { op })
      if (op === 'earliestReachableTs') return Promise.resolve(1_690_000_000)
      if (op === 'loadOlder') {
        const chatId = String(args?.chatId)
        const left = pages.get(chatId) ?? 0
        pages.set(chatId, Math.max(0, left - 1))
        return left > 0
          ? Promise.resolve({ loaded: 50, oldestTs: 1_695_000_000 - left, atFloor: false })
          : Promise.resolve({ loaded: 0, atFloor: true })
      }
      return Promise.resolve(undefined)
    },
  }

  const archive = (request: unknown): Promise<unknown> => {
    const r = request as Request
    written.push(r)
    if (r.op === 'syncState') return Promise.resolve({ rows: stored })
    return Promise.resolve({ written: r.rows?.length ?? 0 })
  }

  const build = (): InstanceType<typeof BackfillController> =>
    new BackfillController({ bridge: bridge as never, archive, batchDelayMs: 0 })

  beforeEach(() => {
    sent = []
    written = []
    stored = []
    bridgeReady = true
    idleSeconds = 600
    pages = new Map()
  })

  it('refuses to start without a bridge', async () => {
    bridgeReady = false
    await expect(build().start()).rejects.toThrow('bridge is not available')
  })

  it('walks a chat to its floor and records the depth limit WhatsApp reported', async () => {
    pages.set('c1', 2)
    const controller = build()
    controller.enqueue(['c1'])
    const result = await controller.start()

    expect(result.chats[0]?.state).toBe('done')
    expect(result.reachableTs).toBe(1_690_000_000)

    const saves = written.filter((w) => w.op === 'saveSyncState')
    expect(saves.length).toBeGreaterThan(0)
    expect(saves.at(-1)?.rows?.[0]).toMatchObject({ chatId: 'c1', backfillDone: true })
  })

  it('skips the chats a previous run already finished', async () => {
    // The point of the bookkeeping: a restart continues, it does not walk the same chats again.
    stored = [{ chatId: 'c1', backfillDone: true }]
    const controller = build()
    await controller.restore(['c1', 'c2'])
    expect(controller.snapshot().chats.map((c) => c.chatId)).toEqual(['c2'])
  })

  it('queues everything when the recorded progress cannot be read', async () => {
    const controller = new BackfillController({
      bridge: bridge as never,
      archive: () => Promise.reject(new Error('archive down')),
      batchDelayMs: 0,
    })
    await controller.restore(['c1', 'c2'])
    expect(controller.snapshot().chats).toHaveLength(2)
  })

  it('keeps running when the progress write fails', async () => {
    // Losing the bookkeeping costs a resume point, not the messages — those went in through the
    // importer — so a failed write must not stop the run.
    pages.set('c1', 1)
    const controller = new BackfillController({
      bridge: bridge as never,
      archive: (request) =>
        (request as Request).op === 'saveSyncState'
          ? Promise.reject(new Error('disk full'))
          : Promise.resolve({ rows: [] }),
      batchDelayMs: 0,
    })
    controller.enqueue(['c1'])
    const result = await controller.start()
    expect(result.chats[0]?.state).toBe('done')
  })

  it('names why it is standing still', () => {
    const controller = build()
    expect(controller.pauseReason()).toBeUndefined()

    idleSeconds = 5
    expect(controller.pauseReason()).toBe('in-use')

    bridgeReady = false
    expect(controller.pauseReason()).toBe('bridge')
  })

  it('reports progress as it goes rather than only at the end', async () => {
    pages.set('c1', 3)
    const seen: number[] = []
    const controller = new BackfillController({
      bridge: bridge as never,
      archive,
      onChange: (snapshot) => seen.push(snapshot.chats[0]?.messages ?? 0),
      batchDelayMs: 0,
    })
    controller.enqueue(['c1'])
    await controller.start()
    expect(seen.length).toBeGreaterThan(2)
    expect(seen.at(-1)).toBe(150)
  })
})
