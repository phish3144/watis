import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { BlobStore } from '../../src/workers/archive/blob-store'
import { decideFetch, storeMedia } from '../../src/main/archive/media-pipeline'

describe('decideFetch', () => {
  it('always takes documents and images', () => {
    // §10: documents always, images always.
    expect(decideFetch({ id: 'a', mime: 'application/pdf', size: 1000 })).toMatchObject({
      fetch: true,
    })
    expect(decideFetch({ id: 'b', mime: 'image/jpeg', size: 1000 })).toMatchObject({ fetch: true })
  })

  it('leaves video for a click', () => {
    // An archive that eagerly pulls every forwarded video fills a disk in a week.
    expect(decideFetch({ id: 'c', mime: 'video/mp4', size: 1000 })).toMatchObject({
      fetch: false,
      reason: 'videos only on request',
    })
  })

  it('takes small video when the user raises the limit', () => {
    expect(
      decideFetch({ id: 'c', mime: 'video/mp4', size: 1000 }, { videoAutoMaxBytes: 5000 }),
    ).toMatchObject({ fetch: true, reason: 'video' })
    expect(
      decideFetch({ id: 'c', mime: 'video/mp4', size: 9000 }, { videoAutoMaxBytes: 5000 }),
    ).toMatchObject({ fetch: false })
  })

  it('leaves voice messages alone by default', () => {
    expect(decideFetch({ id: 'd', mime: 'audio/ogg', size: 100 })).toMatchObject({ fetch: false })
  })

  it('refuses anything past the hard ceiling', () => {
    expect(
      decideFetch({ id: 'e', mime: 'application/pdf', size: 500 * 1024 * 1024 }),
    ).toMatchObject({
      fetch: false,
    })
  })

  it('honours a manual request over every rule but the ceiling', () => {
    // The user clicked the file; that outranks a default.
    expect(decideFetch({ id: 'f', mime: 'video/mp4', size: 50_000_000 }, {}, true)).toMatchObject({
      fetch: true,
      reason: 'manual',
    })
  })

  it('says why it declined rather than staying silent', () => {
    const decision = decideFetch({ id: 'g', mime: 'image/png', size: 10 }, { images: false })
    expect(decision).toMatchObject({ fetch: false, reason: 'images off' })
  })

  it('declines a candidate it cannot classify at all', () => {
    expect(decideFetch({ id: 'h' })).toMatchObject({ fetch: false, reason: 'unknown type' })
  })
})

describe('storeMedia', () => {
  let root: string
  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'watis-media-'))
  })
  afterEach(async () => {
    await rm(root, { recursive: true, force: true })
  })

  it('stores the bytes and reports the hash for the media row', async () => {
    const store = new BlobStore(root, 1024 * 1024)
    const result = await storeMedia(store, { id: 'me1', mime: 'image/png' }, Buffer.from('bild'), 0)

    expect(result.status).toBe('done')
    expect(result.sha256).toMatch(/^[0-9a-f]{64}$/)
    expect(result.size).toBe(4)
  })

  it('refuses before writing once the quota is reached', async () => {
    // Declining a file is recoverable; filling the disk is not.
    const store = new BlobStore(root, 1000)
    const result = await storeMedia(store, { id: 'me1', mime: 'image/png' }, Buffer.alloc(10), 1000)

    expect(result).toMatchObject({ status: 'skipped', reason: 'blob store quota reached' })
  })

  it('is idempotent, so a retried download is safe', async () => {
    const store = new BlobStore(root, 1024 * 1024)
    const first = await storeMedia(store, { id: 'me1', mime: 'image/png' }, Buffer.from('x'), 0)
    const second = await storeMedia(store, { id: 'me1', mime: 'image/png' }, Buffer.from('x'), 0)

    expect(second.sha256).toBe(first.sha256)
    expect(store.quota().bytes).toBe(1)
  })
})
