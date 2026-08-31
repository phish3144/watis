import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({}))
vi.mock('../../src/main/logging', () => ({
  log: { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

const { MediaFetcher } = await import('../../src/main/archive/media-fetcher')

interface Row {
  id: string
  msgId?: string | null
  mime?: string | null
  size?: number | null
  filename?: string | null
}

describe('MediaFetcher', () => {
  let pending: Row[]
  let requests: { op: string; [key: string]: unknown }[]
  let download: (msgId: string) => unknown
  let bridgeReady: boolean

  const bridge = {
    get ready(): boolean {
      return bridgeReady
    },
    send: (op: string, args?: Record<string, unknown>): Promise<unknown> =>
      op === 'downloadMedia'
        ? Promise.resolve(download(String(args?.msgId)))
        : Promise.resolve(undefined),
  }

  const archive = (request: unknown): Promise<unknown> => {
    const r = request as { op: string; [key: string]: unknown }
    requests.push(r)
    if (r.op === 'pendingMedia') return Promise.resolve({ media: pending })
    if (r.op === 'storeBlob') return Promise.resolve({ stored: true, sha256: 'abc', size: 3 })
    return Promise.resolve({ ok: true })
  }

  const build = (rules?: Record<string, unknown>): InstanceType<typeof MediaFetcher> =>
    new MediaFetcher({ bridge: bridge as never, archive, rules, betweenFilesMs: 0 })

  beforeEach(() => {
    pending = []
    requests = []
    bridgeReady = true
    download = () => ({ data: Buffer.from('pdf').toString('base64'), mime: 'application/pdf' })
  })

  it('does nothing without a bridge', async () => {
    bridgeReady = false
    pending = [{ id: 'm1', msgId: 'x', mime: 'application/pdf' }]
    await build().pass()
    expect(requests).toHaveLength(0)
  })

  it('fetches a document and stores it', async () => {
    pending = [{ id: 'm1', msgId: 'msg1', mime: 'application/pdf', size: 1024 }]
    const fetcher = build()
    await fetcher.pass()

    const store = requests.find((r) => r.op === 'storeBlob')
    expect(store).toMatchObject({ mediaId: 'm1', mime: 'application/pdf' })
    expect(fetcher.stats().fetched).toBe(1)
  })

  it('leaves a video for a click and records why', async () => {
    // §10: videos only on request. The refusal goes on the row, not just into a log — a file that
    // is silently absent looks like a bug in the archive.
    pending = [{ id: 'm1', msgId: 'msg1', mime: 'video/mp4', size: 50_000_000 }]
    const fetcher = build()
    await fetcher.pass()

    expect(requests.find((r) => r.op === 'storeBlob')).toBeUndefined()
    expect(requests.find((r) => r.op === 'markMedia')).toMatchObject({
      mediaId: 'm1',
      status: 'skipped',
    })
    expect(fetcher.stats().lastReason).toContain('videos only on request')
  })

  it('fetches the same video when the user clicks it', async () => {
    const fetcher = build()
    const ok = await fetcher.fetchNow({
      id: 'm1',
      msgId: 'msg1',
      mime: 'video/mp4',
      size: 5_000_000,
    })
    expect(ok).toBe(true)
    expect(requests.find((r) => r.op === 'storeBlob')).toBeDefined()
  })

  it('still refuses a click past the hard ceiling', async () => {
    // The one rule a click does not override. Not about second-guessing the user's taste — it is
    // so a single file cannot fill the disk, and a limit any click gets past is not a limit.
    const fetcher = build({ hardMaxBytes: 1000 })
    const ok = await fetcher.fetchNow({
      id: 'm1',
      msgId: 'msg1',
      mime: 'video/mp4',
      size: 5_000_000,
    })
    expect(ok).toBe(false)
    expect(fetcher.stats().lastReason).toContain('larger than 1000 bytes')
  })

  it('skips rather than fails when WhatsApp hands over nothing', async () => {
    // A missing downloader is permanent; retrying it three times per file only burns the queue.
    download = () => undefined
    pending = [{ id: 'm1', msgId: 'msg1', mime: 'application/pdf' }]
    const fetcher = build()
    await fetcher.pass()
    expect(requests.find((r) => r.op === 'markMedia')).toMatchObject({ status: 'skipped' })
    expect(fetcher.stats().failed).toBe(0)
  })

  it('records a failure when the download throws', async () => {
    download = () => {
      throw new Error('decrypt failed')
    }
    pending = [{ id: 'm1', msgId: 'msg1', mime: 'application/pdf' }]
    const fetcher = build()
    await fetcher.pass()
    expect(requests.find((r) => r.op === 'markMedia')).toMatchObject({ status: 'failed' })
    expect(fetcher.stats().failed).toBe(1)
  })

  it('skips a row with no message behind it', async () => {
    pending = [{ id: 'm1', msgId: null, mime: 'application/pdf' }]
    const fetcher = build()
    await fetcher.pass()
    expect(fetcher.stats().lastReason).toBe('no message to download from')
  })

  it('does not stack overlapping passes', async () => {
    pending = [{ id: 'm1', msgId: 'msg1', mime: 'application/pdf' }]
    const fetcher = build()
    const first = fetcher.pass()
    await fetcher.pass()
    await first
    expect(requests.filter((r) => r.op === 'pendingMedia')).toHaveLength(1)
  })
})
