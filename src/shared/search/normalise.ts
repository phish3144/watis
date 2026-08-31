/**
 * German search normalisation, applied symmetrically to the index and to the query.
 *
 * `tokenize='unicode61 remove_diacritics 2'` folds `ü → u`, but nobody types "Munchen". People type
 * either "München" or "Muenchen", and between exactly those two spellings the index is blind. `ß` is
 * not a diacritic at all, so unicode61 leaves it alone and "Straße" and "Strasse" stay two tokens.
 *
 * Measured, with the resulting rule, in ADR 0002.
 */

const UMLAUT: Readonly<Record<string, string>> = {
  ä: 'ae',
  ö: 'oe',
  ü: 'ue',
  Ä: 'Ae',
  Ö: 'Oe',
  Ü: 'Ue',
}

const HAS_UMLAUT = /[äöüÄÖÜ]/
const WHITESPACE = /^\s+$/

const foldEszett = (s: string): string => s.replace(/ß/g, 'ss').replace(/ẞ/g, 'SS')
const toDigraph = (s: string): string => s.replace(/[äöüÄÖÜ]/g, (c) => UMLAUT[c] ?? c)

/**
 * The form written into `search_docs.text`. The FTS index only ever sees this, never the raw text —
 * the original stays in `messages.body` / `content_text.text`, which is where the hit display reads
 * it from anyway, because it has to show what was actually written.
 *
 * Tokens carrying an umlaut are emitted twice: once as written (which unicode61 then folds to the
 * bare vowel) and once in digraph spelling. Everything else passes through untouched, so the index
 * grows only by the umlaut tokens — roughly 10–15 % in German text.
 */
export function indexForm(text: string): string {
  let out = ''
  // split with a capturing group keeps the separators as elements, so they are re-emitted verbatim
  // rather than collapsed — joining the pieces with a space instead would triple every gap.
  for (const piece of foldEszett(text.normalize('NFC')).split(/(\s+)/)) {
    if (piece === '') continue
    if (WHITESPACE.test(piece)) {
      out += piece
      continue
    }
    out += piece
    if (HAS_UMLAUT.test(piece)) out += ` ${toDigraph(piece)}`
  }
  return out
}

/**
 * Applied to every free term of a parsed query before it becomes an FTS5 MATCH expression.
 * Never applied to field values (`from:`, `in:`, `source:` …) — those match literally.
 *
 * Returns a quoted FTS5 string, so a term containing FTS operators cannot escape into the syntax.
 */
export function queryForm(term: string): string {
  const folded = foldEszett(term.normalize('NFC'))
  const digraph = toDigraph(folded)
  return digraph === folded ? quote(folded) : `(${quote(folded)} OR ${quote(digraph)})`
}

/**
 * FTS5 string literals are double-quoted and escape an embedded quote by doubling it. Without this
 * a message body containing a quote character would be a syntax error at query time.
 */
export function quote(term: string): string {
  return `"${term.replace(/"/g, '""')}"`
}
