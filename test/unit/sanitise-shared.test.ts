import { posix } from 'node:path'
import { describe, expect, it } from 'vitest'
import { extname, truncateToBytes } from '@shared/files/sanitise'

/**
 * The shared rules replaced `node:path` and `Buffer` so the browser extension can run them. These
 * hold the replacements to the originals, input for input.
 */

describe('extname without node:path', () => {
  const cases = [
    'a.pdf',
    'Angebot.final.PDF',
    '.bashrc',
    '..',
    '...',
    'a.',
    'a..',
    'noext',
    'dir/a.txt',
    'dir.d/noext',
    '',
    '.',
    'x/.hidden',
    'Grüße aus München.jpeg',
  ]
  for (const input of cases) {
    it(`matches path.posix.extname for ${JSON.stringify(input)}`, () => {
      expect(extname(input)).toBe(posix.extname(input))
    })
  }

  it('ends the name at a backslash too, as Windows does', () => {
    expect(extname('ordner\\datei')).toBe('')
  })
})

describe('truncateToBytes without Buffer', () => {
  const legacy = (value: string, maxBytes: number): string => {
    if (Buffer.byteLength(value, 'utf8') <= maxBytes) return value
    let text = Buffer.from(value, 'utf8').subarray(0, maxBytes).toString('utf8')
    if (text.endsWith('�')) text = text.slice(0, -1)
    const last = text.charCodeAt(text.length - 1)
    if (last >= 0xd800 && last <= 0xdbff) text = text.slice(0, -1)
    return text
  }

  it('cuts at the same place as the Buffer implementation did', () => {
    const samples = ['Grüße aus München', '日本語のファイル名', 'emoji 😀😀😀 tail', 'ascii only']
    for (const sample of samples) {
      for (let max = 1; max <= Buffer.byteLength(sample) + 1; max++) {
        expect(truncateToBytes(sample, max)).toBe(legacy(sample, max))
      }
    }
  })
})
