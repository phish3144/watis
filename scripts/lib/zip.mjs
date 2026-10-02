// A minimal ZIP writer, for packing the browser extension.
//
// The stores want a .zip (Chrome Web Store, Edge Add-ons) or an .xpi, which is a .zip
// (addons.mozilla.org). Node has deflate and CRC-32 built in, and the format is a few fixed
// headers around them — small enough to own rather than to add a dependency for one call, and it
// runs the same on the Windows CI runner, which has no `zip` command.

import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import { crc32, deflateRawSync } from 'node:zlib'

function walk(dir) {
  const files = []
  for (const name of readdirSync(dir).sort()) {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) files.push(...walk(path))
    else files.push(path)
  }
  return files
}

// A fixed timestamp (1980-01-01, the ZIP epoch): the same input yields byte-identical archives,
// so a rebuilt release can be compared with the published one by hash.
const DOS_TIME = 0
const DOS_DATE = (0 << 9) | (1 << 5) | 1

/** Zips the contents of `dir` (not the directory itself) into `file`. */
export function zipDirectory(dir, file) {
  const locals = []
  const centrals = []
  let offset = 0

  for (const path of walk(dir)) {
    const name = Buffer.from(relative(dir, path).split(sep).join('/'), 'utf8')
    const data = readFileSync(path)
    const deflated = deflateRawSync(data, { level: 9 })
    const compressed = deflated.length < data.length
    const body = compressed ? deflated : data
    const crc = crc32(data)

    const local = Buffer.alloc(30)
    local.writeUInt32LE(0x04034b50, 0)
    local.writeUInt16LE(20, 4) // version needed
    local.writeUInt16LE(0x0800, 6) // UTF-8 names
    local.writeUInt16LE(compressed ? 8 : 0, 8) // 8 = deflate, 0 = stored
    local.writeUInt16LE(DOS_TIME, 10)
    local.writeUInt16LE(DOS_DATE, 12)
    local.writeUInt32LE(crc, 14)
    local.writeUInt32LE(body.length, 18)
    local.writeUInt32LE(data.length, 22)
    local.writeUInt16LE(name.length, 26)
    local.writeUInt16LE(0, 28)
    locals.push(local, name, body)

    const central = Buffer.alloc(46)
    central.writeUInt32LE(0x02014b50, 0)
    central.writeUInt16LE(20, 4) // version made by
    central.writeUInt16LE(20, 6)
    central.writeUInt16LE(0x0800, 8)
    central.writeUInt16LE(compressed ? 8 : 0, 10)
    central.writeUInt16LE(DOS_TIME, 12)
    central.writeUInt16LE(DOS_DATE, 14)
    central.writeUInt32LE(crc, 16)
    central.writeUInt32LE(body.length, 20)
    central.writeUInt32LE(data.length, 24)
    central.writeUInt16LE(name.length, 28)
    central.writeUInt32LE(offset, 42)
    centrals.push(central, name)

    offset += local.length + name.length + body.length
  }

  const centralSize = centrals.reduce((n, b) => n + b.length, 0)
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50, 0)
  end.writeUInt16LE(centrals.length / 2, 8)
  end.writeUInt16LE(centrals.length / 2, 10)
  end.writeUInt32LE(centralSize, 12)
  end.writeUInt32LE(offset, 16)

  writeFileSync(file, Buffer.concat([...locals, ...centrals, end]))
}
