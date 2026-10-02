/**
 * A ZIP writer for the browser backup (ADR 0011): stored, not deflated — photos, videos and voice
 * messages are compressed already, and squeezing them again costs time for a percent or two.
 *
 * It writes in one pass to a sink that can write at a position: each entry's local header goes
 * out with a zero checksum, the bytes stream after it, and the checksum is patched in once known.
 * That keeps a two-gigabyte video out of memory and avoids reading it twice.
 *
 * No ZIP64. The caller keeps each archive under {@link ZIP_PART_LIMIT} bytes and
 * {@link ZIP_ENTRY_LIMIT} entries, which keeps every offset and count inside the classic format —
 * the one every unzip tool, Windows Explorer included, reads without question.
 */

export const ZIP_PART_LIMIT = 1024 ** 3
export const ZIP_ENTRY_LIMIT = 60_000

/** Writes `data` at byte `position` of the archive. */
export type ZipSink = (data: Uint8Array, position: number) => Promise<void>

const CRC_TABLE = (() => {
  const table = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[n] = c >>> 0
  }
  return table
})()

/** CRC-32 as ZIP uses it; pass the previous result to continue over the next chunk. */
export function crc32(data: Uint8Array, previous = 0): number {
  let crc = ~previous >>> 0
  for (const byte of data) crc = (CRC_TABLE[(crc ^ byte) & 0xff] ?? 0) ^ (crc >>> 8)
  return ~crc >>> 0
}

/** MS-DOS date and time, local, two-second resolution; 1980 is as early as the format goes. */
function dosDateTime(date: Date): { time: number; date: number } {
  const year = Math.max(1980, date.getFullYear())
  return {
    time: (date.getHours() << 11) | (date.getMinutes() << 5) | (date.getSeconds() >> 1),
    date: ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate(),
  }
}

interface Entry {
  name: Uint8Array
  crc: number
  size: number
  offset: number
  time: number
  date: number
}

export class ZipWriter {
  readonly #sink: ZipSink
  readonly #entries: Entry[] = []
  #offset = 0

  constructor(sink: ZipSink) {
    this.#sink = sink
  }

  /** Bytes written so far: what the archive would weigh if it were finished now, minus the index. */
  get size(): number {
    return this.#offset
  }

  get count(): number {
    return this.#entries.length
  }

  async add(path: string, file: Blob, modified = new Date()): Promise<void> {
    const name = new TextEncoder().encode(path)
    const { time, date } = dosDateTime(modified)
    const offset = this.#offset

    const header = new DataView(new ArrayBuffer(30))
    header.setUint32(0, 0x04034b50, true)
    header.setUint16(4, 20, true) // version needed
    header.setUint16(6, 0x0800, true) // UTF-8 names
    header.setUint16(8, 0, true) // stored
    header.setUint16(10, time, true)
    header.setUint16(12, date, true)
    header.setUint32(14, 0, true) // CRC, patched below
    header.setUint32(18, file.size, true)
    header.setUint32(22, file.size, true)
    header.setUint16(26, name.length, true)
    header.setUint16(28, 0, true)
    await this.#write(new Uint8Array(header.buffer))
    await this.#write(name)

    let crc = 0
    let size = 0
    const reader = file.stream().getReader()
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      crc = crc32(value, crc)
      size += value.length
      await this.#write(value)
    }
    // A file that changed size between the header and the end would make an archive that lies.
    if (size !== file.size) throw new Error(`${path} changed while it was being read`)

    const patch = new DataView(new ArrayBuffer(4))
    patch.setUint32(0, crc, true)
    await this.#sink(new Uint8Array(patch.buffer), offset + 14)
    this.#entries.push({ name, crc, size, offset, time, date })
  }

  /** Writes the central directory. The archive is complete after this, and the writer spent. */
  async finish(): Promise<void> {
    const start = this.#offset
    for (const entry of this.#entries) {
      const central = new DataView(new ArrayBuffer(46))
      central.setUint32(0, 0x02014b50, true)
      central.setUint16(4, 20, true) // version made by
      central.setUint16(6, 20, true) // version needed
      central.setUint16(8, 0x0800, true)
      central.setUint16(10, 0, true)
      central.setUint16(12, entry.time, true)
      central.setUint16(14, entry.date, true)
      central.setUint32(16, entry.crc, true)
      central.setUint32(20, entry.size, true)
      central.setUint32(24, entry.size, true)
      central.setUint16(28, entry.name.length, true)
      // extra, comment, disk, internal and external attributes: all zero
      central.setUint32(42, entry.offset, true)
      await this.#write(new Uint8Array(central.buffer))
      await this.#write(entry.name)
    }
    const end = new DataView(new ArrayBuffer(22))
    end.setUint32(0, 0x06054b50, true)
    end.setUint16(8, this.#entries.length, true)
    end.setUint16(10, this.#entries.length, true)
    end.setUint32(12, this.#offset - start, true)
    end.setUint32(16, start, true)
    await this.#write(new Uint8Array(end.buffer))
  }

  async #write(data: Uint8Array): Promise<void> {
    await this.#sink(data, this.#offset)
    this.#offset += data.length
  }
}
