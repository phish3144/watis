/**
 * Reads the ZIP backups {@link ZipWriter} writes (zip.ts), to put them back (restore.ts).
 *
 * Only the central directory is read up front; each entry is streamed out of the file when it is
 * wanted, so a gigabyte-sized part never sits in memory. Stored entries come out as they are, and
 * deflated ones through the browser's own `DecompressionStream` — a backup somebody unpacked and
 * zipped again with their file manager is usually deflated. No ZIP64, like the writer: a backup part
 * stays under a gigabyte.
 */

export interface ZipEntry {
  name: string
  /** 0 stored, 8 deflated. */
  method: number
  compressedSize: number
  size: number
  /** Where the entry's local header starts. */
  headerOffset: number
}

const EOCD_SIGNATURE = 0x06054b50
const CENTRAL_SIGNATURE = 0x02014b50
const LOCAL_SIGNATURE = 0x04034b50
/** The end record is 22 bytes plus a comment of at most 65 535. */
const EOCD_SEARCH = 22 + 0xffff

async function bytesOf(file: Blob, start: number, end: number): Promise<DataView> {
  return new DataView(await file.slice(start, end).arrayBuffer())
}

export class NotAZipError extends Error {}

/** The entries of a ZIP file, from its central directory. */
export async function readZipEntries(file: Blob): Promise<ZipEntry[]> {
  const tailStart = Math.max(0, file.size - EOCD_SEARCH)
  const tail = await bytesOf(file, tailStart, file.size)
  let end = -1
  for (let i = tail.byteLength - 22; i >= 0; i--) {
    if (tail.getUint32(i, true) === EOCD_SIGNATURE) {
      end = i
      break
    }
  }
  if (end < 0) throw new NotAZipError('not a ZIP file')

  const count = tail.getUint16(end + 10, true)
  const directorySize = tail.getUint32(end + 12, true)
  const directoryOffset = tail.getUint32(end + 16, true)
  if (directoryOffset + directorySize > file.size) throw new NotAZipError('truncated ZIP file')

  const directory = await bytesOf(file, directoryOffset, directoryOffset + directorySize)
  const decoder = new TextDecoder()
  const entries: ZipEntry[] = []
  let at = 0
  for (let n = 0; n < count; n++) {
    if (directory.getUint32(at, true) !== CENTRAL_SIGNATURE) {
      throw new NotAZipError('damaged ZIP directory')
    }
    const nameLength = directory.getUint16(at + 28, true)
    const extraLength = directory.getUint16(at + 30, true)
    const commentLength = directory.getUint16(at + 32, true)
    const name = decoder.decode(
      new Uint8Array(directory.buffer, directory.byteOffset + at + 46, nameLength),
    )
    entries.push({
      name,
      method: directory.getUint16(at + 10, true),
      compressedSize: directory.getUint32(at + 20, true),
      size: directory.getUint32(at + 24, true),
      headerOffset: directory.getUint32(at + 42, true),
    })
    at += 46 + nameLength + extraLength + commentLength
  }
  return entries
}

/** The bytes of one entry, uncompressed, as a stream. */
export async function entryStream(
  file: Blob,
  entry: ZipEntry,
): Promise<ReadableStream<Uint8Array>> {
  const header = await bytesOf(file, entry.headerOffset, entry.headerOffset + 30)
  if (header.getUint32(0, true) !== LOCAL_SIGNATURE) throw new NotAZipError('damaged ZIP entry')
  // The local header's name and extra field can differ in length from the directory's copy.
  const start = entry.headerOffset + 30 + header.getUint16(26, true) + header.getUint16(28, true)
  const raw = file.slice(start, start + entry.compressedSize).stream()
  if (entry.method === 0) return raw
  if (entry.method === 8) {
    return raw.pipeThrough(new DecompressionStream('deflate-raw'))
  }
  throw new NotAZipError(`unsupported compression ${String(entry.method)} for ${entry.name}`)
}

/** One entry, uncompressed, as a Blob — for the small ones read whole (BACKUP.json). */
export async function entryBlob(file: Blob, entry: ZipEntry): Promise<Blob> {
  return new Response(await entryStream(file, entry)).blob()
}
