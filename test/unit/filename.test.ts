import { describe, expect, it } from 'vitest'
import {
  buildDownloadPath,
  resolveCollision,
  sanitiseComponent,
  sanitiseFilename,
  truncateToBytes,
  MAX_PATH_LENGTH,
} from '../../src/main/downloads/filename'

describe('sanitiseComponent', () => {
  it('replaces the characters Windows forbids', () => {
    expect(sanitiseComponent('a<b>c:d"e/f\\g|h?i*j')).toBe('a_b_c_d_e_f_g_h_i_j')
  })

  it('escapes reserved device names, with or without an extension', () => {
    for (const name of ['CON', 'con', 'PRN.txt', 'AUX', 'NUL', 'COM1', 'LPT9', 'CONIN$']) {
      expect(sanitiseComponent(name).startsWith('_')).toBe(true)
    }
    // Only exact matches — a chat called "Constanze" must survive intact.
    expect(sanitiseComponent('Constanze')).toBe('Constanze')
    expect(sanitiseComponent('COM10')).toBe('COM10')
  })

  it('strips trailing dots and spaces, which Windows would drop silently', () => {
    expect(sanitiseComponent('Bericht...')).toBe('Bericht')
    expect(sanitiseComponent('Bericht   ')).toBe('Bericht')
  })

  it('removes a leading dot so the file is not hidden', () => {
    expect(sanitiseComponent('.hidden')).toBe('hidden')
  })

  it('removes bidi override characters used for extension spoofing', () => {
    // Right-to-left override makes "exe.txt" render as "txt.exe" in a file manager.
    const spoofed = 'harmlos‮gnp.exe'
    expect(sanitiseComponent(spoofed)).not.toContain('‮')
  })

  it('never returns an empty string', () => {
    expect(sanitiseComponent('')).toBe('Unbenannt')
    expect(sanitiseComponent('...')).toBe('Unbenannt')
    expect(sanitiseComponent('   ')).toBe('Unbenannt')
  })

  it('keeps umlauts and emoji intact', () => {
    expect(sanitiseComponent('Baustelle Nord – Grüße 😀')).toBe('Baustelle Nord – Grüße 😀')
  })
})

describe('truncateToBytes', () => {
  it('counts bytes, not code units', () => {
    // 'ü' is two bytes in UTF-8; ten of them must not pass a 10-byte budget.
    expect(Buffer.byteLength(truncateToBytes('ü'.repeat(10), 10), 'utf8')).toBeLessThanOrEqual(10)
  })

  it('never splits a multi-byte character', () => {
    const result = truncateToBytes('äöü', 3)
    expect(result).not.toContain('�')
    expect(Buffer.byteLength(result, 'utf8')).toBeLessThanOrEqual(3)
  })

  it('never ends on a lone surrogate', () => {
    // Six bytes hold one emoji and half of the next; the half must be dropped, not shipped.
    const result = truncateToBytes('😀😀😀', 6)
    const lastUnit = result.charCodeAt(result.length - 1)
    expect(lastUnit >= 0xd800 && lastUnit <= 0xdbff).toBe(false)
    expect(result).toBe('😀')
  })

  it('leaves short input alone', () => {
    expect(truncateToBytes('kurz', 100)).toBe('kurz')
  })
})

describe('sanitiseFilename', () => {
  it('keeps the extension when the stem has to be truncated', () => {
    const long = `${'x'.repeat(400)}.pdf`
    const result = sanitiseFilename(long)
    expect(result.endsWith('.pdf')).toBe(true)
    expect(Buffer.byteLength(result, 'utf8')).toBeLessThanOrEqual(255)
  })

  it('cleans the extension too', () => {
    expect(sanitiseFilename('datei.p:df')).not.toContain(':')
  })
})

describe('resolveCollision', () => {
  it('returns the plain name when nothing is in the way', () => {
    expect(resolveCollision('/tmp/x', 'a.pdf', () => false)).toBe('/tmp/x/a.pdf')
  })

  it('counts up until it finds a free slot', () => {
    const taken = new Set(['/tmp/x/a.pdf', '/tmp/x/a (2).pdf'])
    expect(resolveCollision('/tmp/x', 'a.pdf', (p) => taken.has(p))).toBe('/tmp/x/a (3).pdf')
  })

  it('keeps the whole path inside the Windows limit', () => {
    const directory = `/tmp/${'d'.repeat(150)}`
    const result = resolveCollision(directory, `${'n'.repeat(200)}.pdf`, () => false)
    expect(result.length).toBeLessThanOrEqual(MAX_PATH_LENGTH)
    expect(result.endsWith('.pdf')).toBe(true)
  })
})

describe('buildDownloadPath', () => {
  const date = new Date(2026, 7, 30)

  it('sorts into a per-chat folder with a dated filename', () => {
    expect(
      buildDownloadPath({
        root: '/home/u/Downloads/WhatsApp',
        chatName: 'Baustelle Nord',
        filename: 'Angebot.pdf',
        date,
        sortByChat: true,
      }),
    ).toEqual({
      directory: '/home/u/Downloads/WhatsApp/Baustelle Nord',
      filename: '2026-08-30_Angebot.pdf',
    })
  })

  it('falls back to "Unsortiert" when the chat is unknown', () => {
    const result = buildDownloadPath({
      root: '/r',
      chatName: '',
      filename: 'a.pdf',
      date,
      sortByChat: true,
    })
    expect(result.directory).toBe('/r/Unsortiert')
  })

  it('sanitises a chat name that would break a path', () => {
    const result = buildDownloadPath({
      root: '/r',
      chatName: 'Team: A/B?',
      filename: 'a.pdf',
      date,
      sortByChat: true,
    })
    // Each forbidden character becomes an underscore, including a trailing one: stripping that
    // would collapse "Team A?" and "Team A" onto the same folder.
    expect(result.directory).toBe('/r/Team_ A_B_')
  })

  it('can be told not to sort by chat', () => {
    const result = buildDownloadPath({
      root: '/r',
      chatName: 'X',
      filename: 'a.pdf',
      date,
      sortByChat: false,
    })
    expect(result.directory).toBe('/r')
  })
})
