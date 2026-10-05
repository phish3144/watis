import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { HELP as BROWSER_HELP, SEARCH_SYNTAX } from '../../src/extension/panel/help'
import { explainMediaProblem } from '../../src/extension/panel/problems'
import { LABELS } from '../../src/extension/panel/strings'
import models from '../../src/extension/whisper-models.json'
import { HELP as DESKTOP_HELP } from '../../src/renderer/src/help/articles'
import {
  articleTexts,
  namedLabels,
  tokenizeHelp,
  type HelpArticle,
} from '../../src/shared/help/content'
import { HAS_VALUES, SOURCE_VALUES, parseQuery } from '../../src/shared/search/query'

/**
 * Keeps the help inside both panels true as the software changes (CLAUDE.md, "Hilfe aktuell
 * halten"). Each test fails on a specific kind of drift: a renamed button, a search example the
 * parser no longer understands, a new reason a file did not come that nobody explained, a new
 * settings section without its "?".
 */

const root = join(__dirname, '..', '..')
const source = (path: string): string => readFileSync(join(root, path), 'utf8')

function filesUnder(dir: string): string[] {
  return readdirSync(join(root, dir)).flatMap((name) => {
    const path = join(dir, name)
    return statSync(join(root, path)).isDirectory() ? filesUnder(path) : [path]
  })
}

/** Source without its comments, so a label that survives only in a comment does not count. */
const withoutComments = (text: string): string =>
  text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

/**
 * What the desktop panel and its tray menu actually say: the renderer's source, minus the help
 * itself (which would otherwise vouch for its own labels), plus the tray.
 */
const desktopInterface = [
  ...filesUnder('src/renderer/src').filter(
    (path) => /\.tsx?$/.test(path) && !path.includes(join('src', 'renderer', 'src', 'help')),
  ),
  join('src', 'main', 'tray', 'index.ts'),
]
  .map((path) => withoutComments(source(path)))
  .join('\n')

const browserLabels = new Set(LABELS)

const surfaces: [string, readonly HelpArticle<string>[], (label: string) => boolean][] = [
  ['the browser extension', BROWSER_HELP, (label) => browserLabels.has(label)],
  ['the desktop app', DESKTOP_HELP, (label) => desktopInterface.includes(label)],
]

describe.each(surfaces)('the help in %s', (_, help, labelExists) => {
  const allTexts = help.flatMap(articleTexts)

  it('has one article per topic, and every cross-reference leads somewhere', () => {
    const ids = help.map((a) => a.id)
    expect(new Set(ids).size).toBe(ids.length)
    for (const article of help) {
      for (const related of article.related ?? []) expect(ids).toContain(related)
    }
  })

  it('names only buttons and labels this interface actually has', () => {
    // [[label]] marks a label of the panel. Renaming one without updating the help fails here —
    // which is the point.
    const named = allTexts.flatMap(namedLabels)
    expect(named.length).toBeGreaterThan(10)
    expect(named.filter((label) => !labelExists(label))).toEqual([])
  })

  it('leaves no markup unbalanced', () => {
    for (const text of allTexts) {
      expect(text.split('**').length % 2, text).toBe(1)
      expect(text.split('`').length % 2, text).toBe(1)
      expect((text.match(/\[\[/g) ?? []).length, text).toBe((text.match(/\]\]/g) ?? []).length)
    }
  })
})

describe('the browser extension help', () => {
  it('quotes model sizes only for models that exist', () => {
    const keys = BROWSER_HELP.flatMap(articleTexts).flatMap((text) =>
      [...text.matchAll(/\{size:(\w+)\}/g)].map((m) => m[1]),
    )
    expect(keys.length).toBeGreaterThan(0)
    for (const key of keys) expect(Object.keys(models.models)).toContain(key)
  })
})

describe('the desktop help', () => {
  it('has a "?" beside every settings section', () => {
    // A new section without a help topic would be the one place the panel cannot explain.
    const app = source('src/renderer/src/App.tsx')
    const sections = [...app.matchAll(/<Section\s+title=[^>]*>/g)].map((m) => m[0])
    expect(sections.length).toBeGreaterThan(10)
    expect(sections.filter((tag) => !/\shelp="[a-z-]+"/.test(tag))).toEqual([])
  })

  it('opens only topics that exist', () => {
    const ids = new Set<string>(DESKTOP_HELP.map((a) => a.id))
    const used = filesUnder('src/renderer/src')
      .filter((path) => path.endsWith('.tsx'))
      .flatMap((path) => [...source(path).matchAll(/(?:topic|help)="([a-z-]+)"/g)].map((m) => m[1]))
    expect(used.length).toBeGreaterThan(15)
    expect(used.filter((id) => !ids.has(id ?? ''))).toEqual([])
  })
})

describe('the help markup', () => {
  it('splits bold, labels and typed text, and leaves everything else as text', () => {
    expect(tokenizeHelp('Auf [[Laden]] klicken, **nicht** `rm` tippen <b>x</b>')).toEqual([
      { kind: 'text', text: 'Auf ' },
      { kind: 'label', text: 'Laden' },
      { kind: 'text', text: ' klicken, ' },
      { kind: 'bold', text: 'nicht' },
      { kind: 'text', text: ' ' },
      { kind: 'code', text: 'rm' },
      { kind: 'text', text: ' tippen <b>x</b>' },
    ])
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

  it.each(surfaces)('the combined example in %s parses too', (_, help) => {
    const combined = /`(Rechnung [^`]+)`/.exec(help.flatMap(articleTexts).join('\n'))?.[1]
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
