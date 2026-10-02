import { crc32 as zlibCrc32 } from 'node:zlib'
import { describe, expect, it } from 'vitest'
import { crc32, ZipWriter } from '../../src/extension/panel/zip'

/** Writes into a growable buffer at whatever position the writer asks for. */
function memorySink(): {
  sink: (data: Uint8Array, at: number) => Promise<void>
  bytes: () => Buffer
} {
  let buffer = Buffer.alloc(0)
  return {
    sink: (data, at) => {
      const end = at + data.length
      if (end > buffer.length) buffer = Buffer.concat([buffer, Buffer.alloc(end - buffer.length)])
      buffer.set(data, at)
      return Promise.resolve()
    },
    bytes: () => buffer,
  }
}

/** Reads an archive back through its central directory, the way unzip tools do. */
function readZip(zip: Buffer): { name: string; data: Buffer; crc: number }[] {
  const eocd = zip.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]))
  expect(eocd).toBeGreaterThan(-1)
  const count = zip.readUInt16LE(eocd + 10)
  let at = zip.readUInt32LE(eocd + 16)
  const entries = []
  for (let i = 0; i < count; i++) {
    expect(zip.readUInt32LE(at)).toBe(0x02014b50)
    const crc = zip.readUInt32LE(at + 16)
    const size = zip.readUInt32LE(at + 20)
    const nameLength = zip.readUInt16LE(at + 28)
    const name = zip.subarray(at + 46, at + 46 + nameLength).toString('utf8')
    const local = zip.readUInt32LE(at + 42)
    expect(zip.readUInt32LE(local)).toBe(0x04034b50)
    // The local header must agree with the central one — some tools read only the local headers.
    expect(zip.readUInt32LE(local + 14)).toBe(crc)
    const start = local + 30 + zip.readUInt16LE(local + 26)
    entries.push({ name, data: zip.subarray(start, start + size), crc })
    at += 46 + nameLength
  }
  return entries
}

describe('crc32', () => {
  it('matches zlib, also when continued over chunks', () => {
    const data = Buffer.from('Grüße aus dem Archiv — WatIs?')
    expect(crc32(data)).toBe(zlibCrc32(data))
    expect(crc32(data.subarray(7), crc32(data.subarray(0, 7)))).toBe(zlibCrc32(data))
    expect(crc32(new Uint8Array())).toBe(0)
  })
})

describe('ZipWriter', () => {
  it('writes an archive whose entries read back byte for byte', async () => {
    const { sink, bytes } = memorySink()
    const zip = new ZipWriter(sink)
    const photo = Buffer.alloc(300_000, 7)
    photo.write('not really a photo', 1000)
    await zip.add('archive.sqlite', new Blob([Buffer.from('SQLite format 3\0')]))
    await zip.add('blobs/ab/cd/abcd.jpg', new Blob([photo]), new Date(2026, 9, 2, 14, 30, 10))
    await zip.add('Übersicht ä.txt', new Blob([]))
    await zip.finish()

    const entries = readZip(bytes())
    expect(entries.map((e) => e.name)).toEqual([
      'archive.sqlite',
      'blobs/ab/cd/abcd.jpg',
      'Übersicht ä.txt',
    ])
    expect(entries[1]?.data.equals(photo)).toBe(true)
    for (const entry of entries) expect(entry.crc).toBe(zlibCrc32(entry.data))
    expect(zip.count).toBe(3)
  })

  it('records the modification time in DOS format', async () => {
    const { sink, bytes } = memorySink()
    const zip = new ZipWriter(sink)
    await zip.add('a.txt', new Blob(['a']), new Date(2026, 9, 2, 14, 30, 10))
    await zip.finish()
    const zipBytes = bytes()
    expect(zipBytes.readUInt16LE(10)).toBe((14 << 11) | (30 << 5) | 5)
    expect(zipBytes.readUInt16LE(12)).toBe(((2026 - 1980) << 9) | (10 << 5) | 2)
  })
})
