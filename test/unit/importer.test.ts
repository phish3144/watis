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
