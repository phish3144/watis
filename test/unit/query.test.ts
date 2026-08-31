import { describe, expect, it } from 'vitest'
import { parseDate, parseQuery, toMatchExpression } from '@shared/search/query'

describe('parseQuery', () => {
  it('collects bare words as free terms', () => {
    expect(parseQuery('rechnung august').terms).toEqual(['rechnung', 'august'])
  })

  it('keeps a quoted phrase as one term', () => {
    expect(parseQuery('"guten morgen" test').terms).toEqual(['guten morgen', 'test'])
  })

  it('reads the field filters', () => {
    const q = parseQuery('from:anna in:Familie has:image source:ocr')
    expect(q.from).toEqual(['anna'])
    expect(q.in).toEqual(['Familie'])
    expect(q.has).toEqual(['image'])
    expect(q.source).toEqual(['ocr'])
    expect(q.terms).toEqual([])
  })

  it('accepts a quoted field value with spaces', () => {
    expect(parseQuery('in:"Familie Müller"').in).toEqual(['Familie Müller'])
  })

  it('accumulates repeated filters', () => {
    const q = parseQuery('from:anna from:bernd')
    expect(q.from).toEqual(['anna', 'bernd'])
  })

  it('parses dates into unix seconds at UTC midnight', () => {
    const q = parseQuery('after:2026-01-01 before:2026-02-01')
    expect(q.after).toBe(Date.UTC(2026, 0, 1) / 1000)
    expect(q.before).toBe(Date.UTC(2026, 1, 1) / 1000)
  })

  it('warns instead of silently dropping an unusable value', () => {
    // A silent filter is worse than none: the user sees too few hits and cannot tell why.
    const q = parseQuery('has:banana source:magic before:gestern')
    expect(q.has).toEqual([])
    expect(q.source).toEqual([])
    expect(q.before).toBeUndefined()
    expect(q.warnings).toEqual(['has:banana', 'source:magic', 'before:gestern'])
  })

  it('treats an unknown field as an ordinary term', () => {
    // "Termin 10:30" must search for the time, not filter on a field called "10".
    expect(parseQuery('Termin 10:30').terms).toEqual(['Termin', '10:30'])
  })

  it('is case-insensitive on field names and values', () => {
    const q = parseQuery('HAS:IMAGE Source:OCR')
    expect(q.has).toEqual(['image'])
    expect(q.source).toEqual(['ocr'])
  })

  it('handles an empty query', () => {
    const q = parseQuery('')
    expect(q.terms).toEqual([])
    expect(q.warnings).toEqual([])
  })

  it('keeps an explicitly empty phrase out of the terms only when it was bare', () => {
    expect(parseQuery('""').terms).toEqual([''])
  })
})

describe('parseDate', () => {
  it('accepts YYYY-MM-DD and YYYY-MM', () => {
    expect(parseDate('2026-03-15')).toBe(Date.UTC(2026, 2, 15) / 1000)
    expect(parseDate('2026-03')).toBe(Date.UTC(2026, 2, 1) / 1000)
  })

  it('rejects a day that does not exist in that month', () => {
    // Date.UTC would roll this into March rather than refusing it.
    expect(parseDate('2026-02-31')).toBeUndefined()
  })

  it('rejects malformed input', () => {
    for (const bad of ['gestern', '2026', '26-01-01', '2026-13-01', '2026-00-05', '']) {
      expect(parseDate(bad)).toBeUndefined()
    }
  })
})

describe('toMatchExpression', () => {
  it('ANDs the terms and expands umlauts', () => {
    expect(toMatchExpression(parseQuery('München rechnung'))).toBe(
      '("München" OR "Muenchen") AND "rechnung"',
    )
  })

  it('returns undefined for a filter-only query', () => {
    // FTS5 rejects an empty MATCH, and "everything in this chat" is a legitimate search.
    expect(toMatchExpression(parseQuery('in:Familie has:image'))).toBeUndefined()
  })

  it('quotes a term containing FTS operators', () => {
    expect(toMatchExpression(parseQuery('a* OR b'))).toBe('"a*" AND "OR" AND "b"')
  })
})
