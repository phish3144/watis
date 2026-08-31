import { describe, expect, it } from 'vitest'
import { extractLinks, groupByHost } from '@shared/extras/links'
import { chatUrlFor, normaliseNumber, parseWhatsAppUrl } from '@shared/extras/phone'
import { buildOverview, formatBytes } from '@shared/extras/storage-overview'

describe('extractLinks', () => {
  it('finds http and https links', () => {
    expect(extractLinks('siehe https://example.com/a und http://b.de').map((l) => l.url)).toEqual([
      'https://example.com/a',
      'http://b.de/',
    ])
  })

  it('drops trailing punctuation that belongs to the sentence', () => {
    expect(extractLinks('schau hier: https://example.com/x.').map((l) => l.url)).toEqual([
      'https://example.com/x',
    ])
    expect(extractLinks('(https://example.com/y)').map((l) => l.url)).toEqual([
      'https://example.com/y',
    ])
  })

  it('deduplicates the same link in one message', () => {
    expect(extractLinks('https://a.de https://a.de')).toHaveLength(1)
  })

  it('ignores text that is not a link', () => {
    expect(extractLinks('kein link hier, auch example.com nicht')).toEqual([])
    expect(extractLinks(null)).toEqual([])
  })

  it('reports the host for grouping', () => {
    expect(extractLinks('https://sub.example.com/p')[0]?.host).toBe('sub.example.com')
  })
})

describe('groupByHost', () => {
  it('groups by host, biggest group first, newest link first', () => {
    const grouped = groupByHost([
      { url: 'https://a.de/1', host: 'a.de', ts: 100 },
      { url: 'https://a.de/2', host: 'a.de', ts: 200 },
      { url: 'https://b.de/1', host: 'b.de', ts: 300 },
    ])
    expect(grouped[0]?.host).toBe('a.de')
    expect(grouped[0]?.links.map((l) => l.ts)).toEqual([200, 100])
  })
})

describe('normaliseNumber', () => {
  it('accepts the shapes people actually type', () => {
    expect(normaliseNumber('+49 170 1234567')).toBe('491701234567')
    expect(normaliseNumber('0049 (170) 123-4567')).toBe('491701234567')
    expect(normaliseNumber('491701234567')).toBe('491701234567')
  })

  it('refuses a national number without a country', () => {
    // A leading trunk zero cannot be resolved without knowing the country, and guessing sends the
    // message to the wrong one.
    expect(normaliseNumber('0170 1234567')).toBeUndefined()
    expect(normaliseNumber('0170 1234567', '+49')).toBe('491701234567')
  })

  it('rejects anything too short, too long, or not a number', () => {
    expect(normaliseNumber('123')).toBeUndefined()
    expect(normaliseNumber('+' + '9'.repeat(20))).toBeUndefined()
    expect(normaliseNumber('kein telefon')).toBeUndefined()
    expect(normaliseNumber('  ')).toBeUndefined()
  })
})

describe('parseWhatsAppUrl', () => {
  it('reads a wa.me link', () => {
    expect(parseWhatsAppUrl('https://wa.me/491701234567')).toEqual({ number: '491701234567' })
  })

  it('reads the whatsapp: protocol', () => {
    expect(parseWhatsAppUrl('whatsapp://send?phone=%2B491701234567&text=Hallo')).toEqual({
      number: '491701234567',
      text: 'Hallo',
    })
  })

  it('reads api.whatsapp.com', () => {
    expect(parseWhatsAppUrl('https://api.whatsapp.com/send?phone=491701234567')?.number).toBe(
      '491701234567',
    )
  })

  it('ignores an unrelated or malformed url', () => {
    expect(parseWhatsAppUrl('https://example.com/491701234567')).toBeUndefined()
    expect(parseWhatsAppUrl('nonsense')).toBeUndefined()
  })

  it('builds a chat url that carries no prefilled text', () => {
    // Prefilling is fine in the box; a link that a stray Enter could submit is not, and this
    // project never sends.
    const url = chatUrlFor({ number: '491701234567', text: 'Hallo' })
    expect(url).toBe('https://web.whatsapp.com/send?phone=491701234567')
    expect(url).not.toContain('text')
  })
})

describe('storage overview', () => {
  const overview = buildOverview({
    sessionCacheBytes: 100,
    archiveBytes: 1000,
    blobBytes: 10_000,
    modelBytes: 500,
    indexQueueBytes: 10,
    logBytes: 5,
  })

  it('adds up every section', () => {
    expect(overview.totalBytes).toBe(11_615)
  })

  it('never offers to clear the archive or the media', () => {
    // Clearing these would silently destroy the thing the application exists for.
    const clearable = overview.sections.filter((s) => s.clearable).map((s) => s.key)
    expect(clearable).not.toContain('archive')
    expect(clearable).not.toContain('blobs')
  })

  it('offers the browser cache, which is safe, and says what it leaves alone', () => {
    const cache = overview.sections.find((s) => s.key === 'sessionCache')
    expect(cache?.clearable).toBe(true)
    expect(cache?.note).toContain('Anmeldung')
  })

  it('counts only the clearable bytes as reclaimable', () => {
    expect(overview.clearableBytes).toBe(100 + 500 + 10 + 5)
  })
})

describe('formatBytes', () => {
  it('uses German decimal separators', () => {
    expect(formatBytes(1536)).toBe('1,5 KB')
    expect(formatBytes(5 * 1024 * 1024)).toBe('5,0 MB')
  })

  it('drops the decimal once the number is large', () => {
    expect(formatBytes(500 * 1024 * 1024)).toBe('500 MB')
  })

  it('leaves small sizes in bytes', () => {
    expect(formatBytes(512)).toBe('512 B')
  })

  it('climbs to gigabytes and terabytes', () => {
    expect(formatBytes(3 * 1024 ** 3)).toBe('3,0 GB')
    expect(formatBytes(2 * 1024 ** 4)).toBe('2,0 TB')
  })
})
