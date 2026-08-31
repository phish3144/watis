import { queryForm } from './normalise'

/**
 * The search syntax from PLAN.md Phase 4: words, phrases, `from:`, `in:`, `before:`, `after:`,
 * `has:` and `source:`.
 *
 * Field values are matched literally against columns and never go through the German normalisation —
 * only free terms do (ADR 0002). Everything the user types is treated as data: free terms are quoted
 * into FTS5 string literals, field values become bound parameters. Nothing is concatenated into SQL.
 */

export const HAS_VALUES = ['file', 'image', 'audio', 'video', 'link'] as const
export const SOURCE_VALUES = [
  'body',
  'filename',
  'ocr',
  'pdf',
  'docx',
  'text',
  'transcript',
] as const

export type HasFilter = (typeof HAS_VALUES)[number]
export type SourceFilter = (typeof SOURCE_VALUES)[number]

export interface ParsedQuery {
  /** Free terms and quoted phrases, in the order typed. */
  readonly terms: string[]
  readonly from: string[]
  readonly in: string[]
  readonly has: HasFilter[]
  readonly source: SourceFilter[]
  /** Unix seconds, exclusive upper bound. */
  readonly before?: number | undefined
  /** Unix seconds, inclusive lower bound. */
  readonly after?: number | undefined
  /** Field-looking tokens whose value was not understood, kept so the UI can say so. */
  readonly warnings: string[]
}

/** `field:value`, `field:"value with spaces"`, a `"quoted phrase"`, or a bare word. */
const TOKEN = /(\w+):"([^"]*)"|(\w+):(\S+)|"([^"]*)"|(\S+)/g

/**
 * Accepts a date as `YYYY-MM-DD` or `YYYY-MM`, returning Unix seconds at UTC midnight.
 * Returns undefined for anything else, so a typo becomes a warning instead of a silent filter.
 */
export function parseDate(value: string): number | undefined {
  const m = /^(\d{4})-(\d{2})(?:-(\d{2}))?$/.exec(value)
  if (!m) return undefined
  const [year, month, day] = [Number(m[1]), Number(m[2]), m[3] ? Number(m[3]) : 1]
  if (month < 1 || month > 12 || day < 1 || day > 31) return undefined
  const ms = Date.UTC(year, month - 1, day)
  const date = new Date(ms)
  // Date.UTC rolls 2026-02-31 over into March rather than rejecting it.
  if (date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return undefined
  return Math.floor(ms / 1000)
}

export function parseQuery(input: string): ParsedQuery {
  const terms: string[] = []
  const from: string[] = []
  const inChats: string[] = []
  const has: HasFilter[] = []
  const source: SourceFilter[] = []
  const warnings: string[] = []
  let before: number | undefined
  let after: number | undefined

  for (const match of input.matchAll(TOKEN)) {
    const field = (match[1] ?? match[3])?.toLowerCase()
    const value = match[2] ?? match[4]

    if (field === undefined || value === undefined) {
      const bare = match[5] ?? match[6]
      // match[5] is a quoted phrase, which may legitimately be empty; a bare token never is.
      if (bare !== undefined && (match[5] !== undefined || bare !== '')) terms.push(bare)
      continue
    }

    switch (field) {
      case 'from':
        from.push(value)
        break
      case 'in':
        inChats.push(value)
        break
      case 'has':
        if ((HAS_VALUES as readonly string[]).includes(value.toLowerCase())) {
          has.push(value.toLowerCase() as HasFilter)
        } else warnings.push(`has:${value}`)
        break
      case 'source':
        if ((SOURCE_VALUES as readonly string[]).includes(value.toLowerCase())) {
          source.push(value.toLowerCase() as SourceFilter)
        } else warnings.push(`source:${value}`)
        break
      case 'before': {
        const ts = parseDate(value)
        if (ts === undefined) warnings.push(`before:${value}`)
        else before = ts
        break
      }
      case 'after': {
        const ts = parseDate(value)
        if (ts === undefined) warnings.push(`after:${value}`)
        else after = ts
        break
      }
      default:
        // Not a known field, so it was never a field — "10:30" is a time, not a filter.
        terms.push(`${field}:${value}`)
    }
  }

  return { terms, from, in: inChats, has, source, before, after, warnings }
}

/**
 * The FTS5 MATCH expression for the free terms, or undefined when the query has none — a search
 * for `in:Familie has:image` alone is a valid filter-only query and must not be turned into an
 * empty MATCH, which FTS5 rejects.
 */
export function toMatchExpression(query: ParsedQuery): string | undefined {
  if (query.terms.length === 0) return undefined
  return query.terms.map((t) => queryForm(t)).join(' AND ')
}
