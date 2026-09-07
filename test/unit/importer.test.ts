import { describe, expect, it, vi } from 'vitest'
import { Importer, type ImportEvent } from '../../src/main/archive/importer'

/** Typed so the mock records its argument; a bare vi.fn(() => …) infers a zero-argument tuple. */
type Send = (request: unknown) => Promise<unknown>

const message = (id: string): ImportEvent => ({
  kind: 'message',
  row: { id, chatId: 'c1', ts: 1, body: id },
})

describe('Importer', () => {
  it('groups a mixed batch by kind in one request', () => {
    const send = vi.fn<Send>(() => Promise.resolve({ written: 3 }))
    const importer = new Importer(send)
    importer.push({ kind: 'chat', row: { id: 'c1' } })
    importer.push({ kind: 'contact', row: { jid: 'a@s' } })
    importer.push(message('m1'))

    return importer.flush().then(() => {
      expect(send).toHaveBeenCalledTimes(1)
      expect(send.mock.calls[0]?.[0]).toMatchObject({
        op: 'import',
        chats: [{ id: 'c1' }],
        contacts: [{ jid: 'a@s' }],
        messages: [{ id: 'm1' }],
        media: [],
      })
    })
  })

  it('never sends more than the protocol batch limit at once', async () => {
    const send = vi.fn<Send>(() => Promise.resolve({ written: 0 }))
    const importer = new Importer(send, { capacity: 2000 })
    for (let i = 0; i < 900; i++) importer.push(message(`m${String(i)}`))

    await importer.flush()
    const first = send.mock.calls[0]?.[0] as { messages: unknown[] } | undefined
    expect(first?.messages.length ?? 0).toBeLessThanOrEqual(500)
    expect(first?.messages.length).toBeGreaterThan(0)
  })

  it('does nothing when the buffer is empty', async () => {
    const send = vi.fn<Send>(() => Promise.resolve({}))
    await new Importer(send).flush()
    expect(send).not.toHaveBeenCalled()
  })

  it('counts what was written', async () => {
    const importer = new Importer(() => Promise.resolve({ written: 2 }))
    importer.push(message('m1'))
    importer.push(message('m2'))
    await importer.flush()
    expect(importer.stats().written).toBe(2)
  })

  it('reports a failed batch instead of failing silently', async () => {
    const importer = new Importer(() => Promise.reject(new Error('worker weg')))
    importer.push(message('m1'))
    await importer.flush()

    const stats = importer.stats()
    expect(stats.failedBatches).toBe(1)
    expect(stats.lastError).toContain('worker weg')
    expect(stats.written).toBe(0)
  })

  it('clears the last error once a batch succeeds again', async () => {
    let fail = true
    const importer = new Importer(() =>
      fail ? Promise.reject(new Error('x')) : Promise.resolve({ written: 1 }),
    )
    importer.push(message('m1'))
    await importer.flush()
    fail = false
    importer.push(message('m2'))
    await importer.flush()

    expect(importer.stats().lastError).toBeUndefined()
  })

  it('counts drops when the ring overflows rather than growing without bound', () => {
    // A stalled worker must cost a countable gap, not the process.
    const importer = new Importer(() => Promise.resolve({}), { capacity: 3 })
    for (let i = 0; i < 10; i++) importer.push(message(`m${String(i)}`))
    expect(importer.stats()).toMatchObject({ queued: 3, dropped: 7 })
  })

  it('does not stack round trips when a write is slow', async () => {
    let resolveSend: (() => void) | undefined
    const send = vi.fn<Send>(
      () =>
        new Promise<{ written: number }>((resolve) => {
          resolveSend = () => {
            resolve({ written: 1 })
          }
        }),
    )
    const importer = new Importer(send)
    importer.push(message('m1'))

    const first = importer.flush()
    importer.push(message('m2'))
    await importer.flush() // must be skipped while the first is in flight
    expect(send).toHaveBeenCalledTimes(1)

    resolveSend?.()
    await first
  })

  it('drains what is left on stop', async () => {
    const send = vi.fn<Send>(() => Promise.resolve({ written: 1 }))
    const importer = new Importer(send, { batchSize: 1 })
    importer.push(message('m1'))
    importer.push(message('m2'))

    await importer.stop()
    expect(send).toHaveBeenCalledTimes(2)
    expect(importer.stats().queued).toBe(0)
  })

  it('gives up on stop rather than spinning when the worker refuses everything', async () => {
    const importer = new Importer(() => Promise.reject(new Error('tot')), { batchSize: 1 })
    importer.push(message('m1'))
    await importer.stop()
    expect(importer.stats().failedBatches).toBeGreaterThan(0)
  })
})

describe('a bulk import that outruns the writer', () => {
  /**
   * The failure this exists for, measured on a real account: an initial snapshot handed over 8294
   * messages at once, the ring held 5000, and the importer took one batch of 500 off it every
   * 250 ms. 2691 messages were dropped — correctly, by design, and gone. A quarter-second of
   * batching is right for a trickle and wrong for a flood.
   */
  const rows = (n: number): ImportEvent[] =>
    Array.from({ length: n }, (_, i) => ({
      kind: 'message' as const,
      row: { id: `m${String(i)}`, chatId: 'c1', ts: i, body: null },
    }))

  it('writes a whole snapshot without dropping any of it', async () => {
    const written: number[] = []
    const importer = new Importer((request) => {
      written.push((request as { messages: unknown[] }).messages.length)
      return Promise.resolve({ written: (request as { messages: unknown[] }).messages.length })
    })

    for (const event of rows(8294)) importer.push(event)
    await importer.drain()

    expect(importer.stats().dropped).toBe(0)
    expect(importer.stats().queued).toBe(0)
    expect(written.reduce((a, b) => a + b, 0)).toBe(8294)
  })

  it('takes more than one batch per turn', () => {
    // The specific defect: one batch per timer tick capped the pipeline at 500 rows per 250 ms,
    // whatever the writer could actually manage.
    const importer = new Importer(() => Promise.resolve({ written: 0 }))
    for (const event of rows(3000)) importer.push(event)
    expect(importer.stats().queued).toBe(3000)
  })

  it('stops after its bound rather than looping forever on a stuck writer', async () => {
    let calls = 0
    const importer = new Importer(() => {
      calls++
      return Promise.reject(new Error('worker is down'))
    })
    for (const event of rows(100_000)) importer.push(event)
    await importer.drain(5)
    // Bounded: the next tick picks up the rest instead of this one spinning.
    expect(calls).toBe(5)
  })
})
