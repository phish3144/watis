/**
 * The help's content model, shared by the desktop panel and the browser extension's panel.
 *
 * Each surface writes its own articles, because the two interfaces have different buttons, but the
 * shape of an article, its inline markup and the search syntax are the same everywhere — so they
 * live here once, and the help tests check both surfaces with the same rules (CLAUDE.md, "Hilfe
 * aktuell halten").
 *
 * Markup inside any text: `**bold**`, `[[label of this interface]]` (shown bold; the tests check
 * that the label exists), `` `typed text` ``. Nothing else is interpreted — no HTML, ever.
 */

/** One piece of an article. `generated` blocks are rendered from the data the interface uses. */
export type HelpBlock<Generated extends string = string> =
  | { p: string }
  | { h: string }
  | { list: string[] }
  | { steps: string[] }
  | { table: [string, string][] }
  | { note: string }
  | { generated: Generated }

export interface HelpArticle<Topic extends string, Generated extends string = string> {
  id: Topic
  title: string
  /** One line for the list of topics. */
  summary: string
  body: HelpBlock<Generated>[]
  related?: Topic[]
}

/** Every piece of written text in an article, for the tests. */
export function articleTexts(article: HelpArticle<string>): string[] {
  return [
    article.title,
    article.summary,
    ...article.body.flatMap((block): string[] => {
      if ('p' in block) return [block.p]
      if ('h' in block) return [block.h]
      if ('note' in block) return [block.note]
      if ('list' in block) return block.list
      if ('steps' in block) return block.steps
      if ('table' in block) return block.table.flat()
      return []
    }),
  ]
}

export type HelpToken =
  | { kind: 'text'; text: string }
  | { kind: 'bold'; text: string }
  | { kind: 'label'; text: string }
  | { kind: 'code'; text: string }

/** Splits a help text into its markup, for the panels to render as they like. */
export function tokenizeHelp(text: string): HelpToken[] {
  return text
    .split(/(\*\*[^*]+\*\*|\[\[[^\]]+\]\]|`[^`]+`)/g)
    .filter((part) => part !== '')
    .map((part): HelpToken => {
      if (part.startsWith('**') && part.endsWith('**') && part.length > 4)
        return { kind: 'bold', text: part.slice(2, -2) }
      if (part.startsWith('[[') && part.endsWith(']]') && part.length > 4)
        return { kind: 'label', text: part.slice(2, -2) }
      if (part.startsWith('`') && part.endsWith('`') && part.length > 2)
        return { kind: 'code', text: part.slice(1, -1) }
      return { kind: 'text', text: part }
    })
}

/** The labels of the interface a text names (`[[…]]`). */
export function namedLabels(text: string): string[] {
  return tokenizeHelp(text)
    .filter((token) => token.kind === 'label')
    .map((token) => token.text)
}

/**
 * The search syntax, once: both panels show it as tips and in their help, and the help test runs
 * every example through the real parser.
 */
export const SEARCH_SYNTAX: readonly { example: string; meaning: string; tip?: boolean }[] = [
  { example: '"genauer Satz"', meaning: 'die Wörter genau in dieser Reihenfolge', tip: true },
  { example: 'von:Anna', meaning: 'nur Nachrichten von Anna', tip: true },
  { example: 'in:Familie', meaning: 'nur im Chat „Familie“', tip: true },
  { example: 'nach:2026-01-01', meaning: 'ab diesem Tag', tip: true },
  { example: 'vor:2026-02-01', meaning: 'vor diesem Tag' },
  { example: 'hat:image', meaning: 'nur mit Bild – ebenso file, audio, video, link', tip: true },
  {
    example: 'quelle:ocr',
    meaning: 'nur Text aus Bildern – ebenso body, pdf, transcript, filename',
  },
]
