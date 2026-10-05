import { deflateRawSync } from 'node:zlib'
import { describe, expect, it } from 'vitest'
import { crc32, ZipWriter } from '../../src/extension/panel/zip'
import {
  entryBlob,
  NotAZipError,
  readZipEntries,
  entryStream,
} from '../../src/extension/panel/zip-reader'

/** An archive written by our own writer, as a Blob — what a ZIP backup is. */
async function written(files: [string, Uint8Array][]): Promise<Blob> {
  let buffer = new Uint8Array(0)
  const zip = new ZipWriter((data, at) => {
    const end = at + data.length
    if (end > buffer.length) {
      const grown = new Uint8Array(end)
      grown.set(buffer)
      buffer = grown
    }
    buffer.set(data, at)
    return Promise.resolve()
  })
  for (const [name, data] of files) await zip.add(name, new Blob([data]))
  await zip.finish()
  return new Blob([buffer])
}

/**
 * A deflated archive with a trailing comment, built by hand the way a file manager writes one —
 * what a backup looks like after somebody unpacked it and zipped it again.
 */
function deflated(files: [string, Uint8Array][], comment = ''): Blob {
  const parts: Uint8Array[] = []
  const central: Uint8Array[] = []
  let offset = 0
  for (const [name, data] of files) {
    const nameBytes = new TextEncoder().encode(name)
    const packed = deflateRawSync(data)
    const local = Buffer.alloc(30)
    local.writeUInt32LE(0x04034b50, 0)
    local.writeUInt16LE(20, 4)
    local.writeUInt16LE(8, 8)
    local.writeUInt32LE(crc32(data), 14)
    local.writeUInt32LE(packed.length, 18)
    local.writeUInt32LE(data.length, 22)
    local.writeUInt16LE(nameBytes.length, 26)
    const header = Buffer.alloc(46)
    header.writeUInt32LE(0x02014b50, 0)
    header.writeUInt16LE(20, 4)
    header.writeUInt16LE(20, 6)
    header.writeUInt16LE(8, 10)
    header.writeUInt32LE(crc32(data), 16)
    header.writeUInt32LE(packed.length, 20)
    header.writeUInt32LE(data.length, 24)
    header.writeUInt16LE(nameBytes.length, 28)
    header.writeUInt32LE(offset, 42)
    central.push(header, nameBytes)
    parts.push(local, nameBytes, packed)
    offset += local.length + nameBytes.length + packed.length
  }
  const directorySize = central.reduce((sum, part) => sum + part.length, 0)
  const commentBytes = new TextEncoder().encode(comment)
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50, 0)
  end.writeUInt16LE(files.length, 8)
  end.writeUInt16LE(files.length, 10)
  end.writeUInt32LE(directorySize, 12)
  end.writeUInt32LE(offset, 16)
  end.writeUInt16LE(commentBytes.length, 20)
  return new Blob([...parts, ...central, end, commentBytes].map((part) => new Uint8Array(part)))
}

async function contents(zip: Blob): Promise<Record<string, string>> {
  const out: Record<string, string> = {}
  for (const entry of await readZipEntries(zip)) {
    out[entry.name] = await (await entryBlob(zip, entry)).text()
  }
  return out
}

const text = (s: string): Uint8Array => new TextEncoder().encode(s)

describe('readZipEntries', () => {
  it('reads back what our own writer wrote, byte for byte', async () => {
    const photo = new Uint8Array(300_000).fill(7)
    const zip = await written([
      ['archive.sqlite', text('SQLite format 3\u0000…')],
      ['blobs/ab/cd/' + 'a'.repeat(64) + '.jpg', photo],
      ['BACKUP.json', text('{"kind":"zip"}')],
    ])
    const entries = await readZipEntries(zip)
    expect(entries.map((e) => [e.name, e.method, e.size])).toEqual([
      ['archive.sqlite', 0, 19],
      ['blobs/ab/cd/' + 'a'.repeat(64) + '.jpg', 0, 300_000],
      ['BACKUP.json', 0, 14],
    ])
    const photoEntry = entries[1]
    if (!photoEntry) throw new Error('the photo is missing')
    const back = new Uint8Array(
      await new Response(await entryStream(zip, photoEntry)).arrayBuffer(),
    )
    expect(back).toEqual(photo)
  })

  it('reads a deflated archive with a comment, as file managers write them', async () => {
    const zip = deflated(
      [
        ['BACKUP.json', text('{"createdAt":"2026-10-05T08:00:00.000Z"}')],
        ['blobs/00/11/' + 'b'.repeat(64) + '.ogg', text('Grüße '.repeat(500))],
      ],
      'neu gepackt',
    )
    expect(await contents(zip)).toEqual({
      'BACKUP.json': '{"createdAt":"2026-10-05T08:00:00.000Z"}',
      ['blobs/00/11/' + 'b'.repeat(64) + '.ogg']: 'Grüße '.repeat(500),
    })
  })

  it('says plainly when a file is not a ZIP', async () => {
    await expect(readZipEntries(new Blob([text('SQLite format 3')]))).rejects.toBeInstanceOf(
      NotAZipError,
    )
  })
})
