import { describe, expect, it } from 'vitest'
import { indexForm, queryForm, quote } from '@shared/search/normalise'

describe('indexForm', () => {
  it('folds ß to ss so Straße and Strasse become one token', () => {
    expect(indexForm('Straße')).toBe('Strasse')
    expect(indexForm('WEIẞ')).toBe('WEISS')
  })

  it('emits umlaut tokens in both German spellings', () => {
    // "München" alone is unreachable from a query typed as "Muenchen", and vice versa.
    expect(indexForm('München')).toBe('München Muenchen')
    expect(indexForm('Grüße')).toBe('Grüsse Gruesse')
  })

  it('leaves tokens without umlauts alone', () => {
    expect(indexForm('hello world')).toBe('hello world')
  })

  it('preserves the whitespace between tokens', () => {
    expect(indexForm('Öl und Käse')).toBe('Öl Oel und Käse Kaese')
  })

  it('normalises combining marks before folding', () => {
    // A decomposed "ü" (u + U+0308) must fold the same way as the precomposed one.
    expect(indexForm('München')).toBe(indexForm('München'))
  })

  it('handles an empty string', () => {
    expect(indexForm('')).toBe('')
  })
})

describe('queryForm', () => {
  it('expands an umlaut term to both spellings', () => {
    expect(queryForm('München')).toBe('("München" OR "Muenchen")')
  })

  it('folds ß without expanding, because there is only one folded form', () => {
    expect(queryForm('Straße')).toBe('"Strasse"')
  })

  it('quotes a plain term so FTS operators cannot escape', () => {
    expect(queryForm('rechnung')).toBe('"rechnung"')
    expect(queryForm('a OR b')).toBe('"a OR b"')
  })

  it('is symmetric with indexForm for both spellings of the same word', () => {
    // The point of the whole rule: either spelling of the query reaches either spelling in the index.
    for (const written of ['München', 'Muenchen']) {
      for (const typed of ['München', 'Muenchen']) {
        const indexed = indexForm(written)
        const alternatives = queryForm(typed)
          .replace(/^\(|\)$/g, '')
          .split(' OR ')
          .map((s) => s.replace(/^"|"$/g, ''))
        expect(alternatives.some((a) => indexed.includes(a))).toBe(true)
      }
    }
  })
})

describe('quote', () => {
  it('doubles an embedded quote', () => {
    expect(quote('say "hi"')).toBe('"say ""hi"""')
  })
})
