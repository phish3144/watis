import { mkdtemp, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  BlobStore,
  extensionFor,
  shardPath,
  sha256Of,
  sha256OfFile,
} from '../../src/workers/archive/blob-store'

let root: string
let store: BlobStore

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'watis-blobs-'))
  store = new BlobStore(root, 20 * 1024 * 1024 * 1024)
})
afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

describe('extensionFor', () => {
  it('prefers the filename extension', () => {
    expect(extensionFor('application/octet-stream', 'Rechnung.pdf')).toBe('pdf')
  })

  it('lowercases, so .JPEG and .jpeg cannot become two files for one hash', () => {
    expect(extensionFor(null, 'Foto.JPEG')).toBe('jpeg')
  })

  it('falls back to the mime type', () => {
    expect(extensionFor('image/jpeg', null)).toBe('jpg')
  })

  it('falls back to bin for anything unknown', () => {
    expect(extensionFor('application/x-weird', null)).toBe('bin')
    expect(extensionFor(undefined, undefined)).toBe('bin')
  })
})

describe('shardPath', () => {
  it('shards two levels deep', () => {
    expect(shardPath('abcdef0123', 'jpg')).toBe('ab/cd/abcdef0123.jpg')
  })
})

describe('BlobStore', () => {
  it('stores a blob at its content address', async () => {
    const data = Buffer.from('hallo welt')
    const ref = await store.put(data, { mime: 'text/plain' })

    expect(ref.sha256).toBe(sha256Of(data))
    expect(ref.size).toBe(data.byteLength)
    expect(ref.relativePath).toBe(shardPath(ref.sha256, 'txt'))
    expect(await store.has(ref.sha256, 'text/plain')).toBe(true)
  })

  it('deduplicates identical content', async () => {
    // The same photo forwarded through five chats must be one file on disk.
    const data = Buffer.from('dasselbe bild')
    const a = await store.put(data, { mime: 'image/jpeg' })
    const b = await store.put(data, { mime: 'image/jpeg' })

    expect(b.sha256).toBe(a.sha256)
    expect(b.relativePath).toBe(a.relativePath)

    const leaf = join(root, a.sha256.slice(0, 2), a.sha256.slice(2, 4))
    expect(await readdir(leaf)).toHaveLength(1)
  })

  it('counts a re-put only once against the quota', async () => {
    const data = Buffer.from('x'.repeat(1000))
    await store.put(data, { mime: 'image/png' })
    await store.put(data, { mime: 'image/png' })
    expect(store.quota().bytes).toBe(1000)
  })

  it('leaves no partial file behind at the content address', async () => {
    await store.put(Buffer.from('inhalt'), { mime: 'text/plain' })
    const leaves = await readdir(root, { recursive: true, withFileTypes: true })
    expect(leaves.filter((e) => e.isFile() && e.name.endsWith('.part'))).toEqual([])
  })

  it('reports quota state and the point at which the UI should warn', () => {
    const small = new BlobStore(root, 1000)
    expect(small.quota(900)).toEqual({
      bytes: 900,
      limitBytes: 1000,
      used: 0.9,
      exceeded: false,
    })
    expect(small.quota(1000).exceeded).toBe(true)
  })

  it('treats a zero limit as no limit rather than as full', () => {
    const unlimited = new BlobStore(root, 0)
    expect(unlimited.quota(10_000).exceeded).toBe(false)
  })

  it('deletes a blob and gives the bytes back', async () => {
    const ref = await store.put(Buffer.from('temporär'), { mime: 'text/plain' })
    expect(await store.delete(ref.sha256, 'text/plain')).toBe(true)
    expect(await store.has(ref.sha256, 'text/plain')).toBe(false)
    expect(store.quota().bytes).toBe(0)
  })

  it('reports a miss for deleting something that is not there', async () => {
    expect(await store.delete('0'.repeat(64), 'text/plain')).toBe(false)
  })

  it('derives the same path from the hash without consulting the database', async () => {
    // §5.4 stores no path, which is what makes the store relocatable.
    const ref = await store.put(Buffer.from('daten'), { mime: 'application/pdf' })
    expect(store.pathFor(ref.sha256, 'application/pdf')).toBe(join(root, ref.relativePath))
  })

  it('hashes a file the same way as a buffer', async () => {
    const data = Buffer.from('gleich')
    const file = join(root, 'probe.bin')
    await writeFile(file, data)
    expect(await sha256OfFile(file)).toBe(sha256Of(data))
  })
})
