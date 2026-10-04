import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { HELP, SEARCH_SYNTAX, type HelpBlock } from '../../src/extension/panel/help'
import { explainMediaProblem } from '../../src/extension/panel/problems'
import { LABELS } from '../../src/extension/panel/strings'
import models from '../../src/extension/whisper-models.json'
import { HAS_VALUES, SOURCE_VALUES, parseQuery } from '../../src/shared/search/query'

/**
 * Keeps the help inside the panel true as the software changes (CLAUDE.md, "Hilfe aktuell
 * halten"). Each test fails on a specific kind of drift: a renamed button, a search example the
 * parser no longer understands, a new reason a file did not come that nobody explained.
 */

const root = join(__dirname, '..', '..')
const source = (path: string): string => readFileSync(join(root, path), 'utf8')

function texts(block: HelpBlock): string[] {
  if ('p' in block) return [block.p]
  if ('h' in block) return [block.h]
  if ('note' in block) return [block.note]
  if ('list' in block) return block.list
  if ('steps' in block) return block.steps
  if ('table' in block) return block.table.flat()
  return []
}

const allTexts = HELP.flatMap((article) => [
  article.title,
  article.summary,
  ...article.body.flatMap(texts),
])

describe('the help', () => {
  it('has one article per topic, and every cross-reference leads somewhere', () => {
    const ids = HELP.map((a) => a.id)
    expect(new Set(ids).size).toBe(ids.length)
    for (const article of HELP) {
      for (const related of article.related ?? []) expect(ids).toContain(related)
    }
  })

  it('names only buttons and labels this interface actually has', () => {
    // [[label]] marks a label of the panel. Renaming one in strings.ts without updating the help
    // fails here — which is the point.
    const labels = new Set(LABELS)
    const named = allTexts.flatMap((text) =>
      [...text.matchAll(/\[\[([^\]]+)\]\]/g)].map((m) => m[1]),
    )
    expect(named.length).toBeGreaterThan(10)
    expect(named.filter((label) => !labels.has(label ?? ''))).toEqual([])
  })

  it('quotes model sizes only for models that exist', () => {
    const keys = allTexts.flatMap((text) => [...text.matchAll(/\{size:(\w+)\}/g)].map((m) => m[1]))
    expect(keys.length).toBeGreaterThan(0)
    for (const key of keys) expect(Object.keys(models.models)).toContain(key)
  })

  it('leaves no markup unbalanced', () => {
    for (const text of allTexts) {
      expect(text.split('**').length % 2, text).toBe(1)
      expect(text.split('`').length % 2, text).toBe(1)
      expect((text.match(/\[\[/g) ?? []).length, text).toBe((text.match(/\]\]/g) ?? []).length)
    }
  })
})

describe('the search syntax the help teaches', () => {
  it.each(SEARCH_SYNTAX.map((entry) => [entry.example]))(
    '%s is understood by the search',
    (example) => {
      const parsed = parseQuery(example)
      expect(parsed.warnings).toEqual([])
      const used =
        parsed.terms.length +
        parsed.from.length +
        parsed.in.length +
        parsed.has.length +
        parsed.source.length +
        (parsed.before === undefined ? 0 : 1) +
        (parsed.after === undefined ? 0 : 1)
      expect(used).toBe(1)
    },
  )

  it('lists only values hat: and quelle: accept', () => {
    for (const entry of SEARCH_SYNTAX) {
      const others = /ebenso (.+)$/.exec(entry.meaning)?.[1]
      if (!others) continue
      const values = others.split(/,\s*/).map((v) => v.trim())
      const allowed: readonly string[] = entry.example.startsWith('hat:')
        ? HAS_VALUES
        : SOURCE_VALUES
      for (const value of values) expect(allowed).toContain(value)
    }
  })

  it('the combined example in the article parses too', () => {
    const combined = /`(Rechnung [^`]+)`/.exec(allTexts.join('\n'))?.[1]
    expect(combined).toBeDefined()
    expect(parseQuery(combined ?? '').warnings).toEqual([])
  })
})

describe('reasons a file did not come', () => {
  /**
   * Every reason the bridge, the media fetcher, the fetch rules and the archive can hand the panel,
   * read from the source rather than listed here — so a new one without a German explanation fails.
   */
  /** A quoted string literal, single or double quotes, after `prefix`. */
  const literals = (text: string, prefix: string): string[] =>
    [...text.matchAll(new RegExp(`${prefix}(?:'([^']+)'|"([^"]+)")`, 'g'))].map(
      (m) => m[1] ?? m[2] ?? '',
    )
  const operations = source('src/bridge/operations.ts')
  const refusals = operations.slice(
    operations.indexOf('function refusalFor'),
    operations.indexOf('function startQpl'),
  )
  const reasons = [
    ...literals(operations, 'skipped: '),
    ...literals(refusals, 'return '),
    ...literals(source('src/main/archive/media-fetcher.ts'), 'lastReason = '),
    ...literals(source('src/main/archive/fetch-rules.ts'), 'fetch: false, reason: '),
    ...literals(source('src/extension/host/archive-host.ts'), 'error: '),
    ...literals(source('src/extension/content/relay.ts'), 'error: '),
    ...literals(source('src/extension/host/archive-worker.ts'), 'reason: '),
    // Built from templates in the source; one instance of each.
    'WhatsApp does not accept audio/ogg as ptt',
    'larger than 2147483648 bytes',
  ]

  it('finds the reasons in the source', () => {
    expect(reasons).toEqual(
      expect.arrayContaining([
        "no longer on WhatsApp's servers",
        'view-once media is not archived',
      ]),
    )
    expect(reasons.length).toBeGreaterThan(20)
  })

  it.each(reasons.map((reason) => [reason]))('explains "%s" in German', (reason) => {
    expect(explainMediaProblem(reason).known).toBe(true)
  })

  it('says something useful even for a reason nobody foresaw', () => {
    const explained = explainMediaProblem('something new and strange')
    expect(explained).toMatchObject({ known: false, help: 'probleme' })
    expect(explained.text).not.toBe('')
  })
})
