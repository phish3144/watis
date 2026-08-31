# ADR 0002 – Deutsche Suchnormalisierung im Volltextindex

- **Status:** akzeptiert
- **Datum:** 2026-08-30
- **Betrifft:** PLAN.md §5.4 (`search_docs`/`search_fts`), Phase 4

## Problem

PLAN.md §5.4 sieht `tokenize='unicode61 remove_diacritics 2'` vor. Das reicht für Deutsch nicht.
Gemessen mit better-sqlite3 13.0.3 (SQLite 3.53.4):

| Suchbegriff | findet „München Grüße Straße Käse Öl" | findet „Muenchen Gruesse Strasse Kaese Oel" |
| ----------- | ------------------------------------- | ------------------------------------------- |
| `münchen`   | ja                                    | **nein**                                    |
| `muenchen`  | **nein**                              | ja                                          |
| `straße`    | ja                                    | **nein**                                    |
| `strasse`   | **nein**                              | ja                                          |
| `grüße`     | ja                                    | **nein**                                    |
| `gruesse`   | **nein**                              | ja                                          |

`remove_diacritics 2` faltet `ü → u`, aber niemand tippt „Munchen". Getippt wird entweder „München" oder
„Muenchen" – und genau zwischen diesen beiden Schreibweisen ist der Index blind. `ß` ist zudem gar kein
diakritisches Zeichen und wird von unicode61 überhaupt nicht angefasst, weshalb „Straße" und „Strasse"
zwei verschiedene Tokens sind.

Bei einem Archiv aus deutschen Chats ist das kein Randfall, sondern der Normalfall: Ortsnamen,
Straßennamen, Nachnamen, „Grüße", „Maße", „Größe", „Anhänge".

## Entscheidung

Zweistufige Normalisierung, angewandt **symmetrisch auf Index und Anfrage**:

1. **`ß` faltet immer zu `ss`** (`ẞ` zu `SS`). Es gibt keinen Fall, in dem die Unterscheidung hilft.
2. **Jedes Token mit Umlaut wird in beiden deutschen Schreibweisen indiziert:** die Umlautform (die
   unicode61 dann zur nackten Vokalform faltet) und die Digraph-Form (`ae`/`oe`/`ue`).
3. **Die Anfrage wird gleich behandelt** und als `("form1" OR "form2")` gestellt.

```ts
const UMLAUT: Record<string, string> = { ä: 'ae', ö: 'oe', ü: 'ue', Ä: 'Ae', Ö: 'Oe', Ü: 'Ue' }
const HAS_UMLAUT = /[äöüÄÖÜ]/

const foldEszett = (s: string): string => s.replace(/ß/g, 'ss').replace(/ẞ/g, 'SS')
const toDigraph = (s: string): string => s.replace(/[äöüÄÖÜ]/g, (c) => UMLAUT[c] ?? c)

/** Written into search_docs.text; search_fts indexes this form, never the raw text. */
export function indexForm(text: string): string {
  let out = ''
  for (const piece of foldEszett(text.normalize('NFC')).split(/(\s+)/)) {
    if (piece === '') continue
    if (/^\s+$/.test(piece)) {
      out += piece
      continue
    }
    out += piece
    if (HAS_UMLAUT.test(piece)) out += ` ${toDigraph(piece)}`
  }
  return out
}

/** Applied to every term of a parsed query before it becomes an FTS5 MATCH expression. */
export function queryForm(term: string): string {
  const folded = foldEszett(term.normalize('NFC'))
  const digraph = toDigraph(folded)
  return digraph === folded ? `"${folded}"` : `("${folded}" OR "${digraph}")`
}
```

> **Korrektur 2026-08-31.** Die erste Fassung dieses Schnipsels sammelte die Stücke in ein Array und
> fügte sie mit `join(' ')` zusammen. Weil `split` mit Fangklammer die Trenner als eigene Elemente
> behält, wurde damit aus jedem einzelnen Leerzeichen ein dreifaches. Für die Trefferqualität war das
> harmlos, für die Indexgröße nicht. Ein Unit-Test in `test/unit/normalise.test.ts` hält die Gaps jetzt fest.

## Messergebnis

Nach der Regel finden **beide** Schreibweisen **beide** Dokumente – für `münchen`, `muenchen`, `grüße`,
`grüsse`, `gruesse`, `straße`, `strasse`, `käse`, `kaese`, `öl`, `oel`, `weiß`, `weiss`.

Nicht gefunden werden `munchen`, `grusse`, `kase`, `ol` im Digraph-Dokument. Das ist beabsichtigt: Wer den
Umlaut ersatzlos weglässt, findet weiterhin die korrekt geschriebene Variante über `remove_diacritics`,
aber aus „munchen" lässt sich nicht erschließen, dass „Muenchen" gemeint war. Diesen Fall deckt bei Bedarf
der Trigram-Index ab (siehe unten).

## Konsequenzen

- `search_docs.text` enthält die **normalisierte** Form, nicht den Originaltext. Der Originaltext steht
  weiterhin in `messages.body` bzw. `content_text.text` und wird für die Trefferanzeige von dort gelesen.
  Das ist ohnehin nötig, weil die Anzeige den Text so zeigen muss, wie er geschrieben wurde.
- Die Expansion vergrößert den Index nur um die Tokens mit Umlaut, in deutschen Texten grob 10–15 %.
- Der Suchsyntax-Parser (`from:`, `in:`, `before:`, `source:` …) ruft `queryForm()` auf jeden freien
  Term auf, nie auf Feldwerte.
- **Beides muss zusammen versioniert werden.** Ändert sich `indexForm`, muss `search_docs` neu aufgebaut
  werden. Die Normalisierungsversion wird deshalb in `user_version` bzw. einer Metatabelle mitgeführt und
  löst bei Abweichung einen Reindex aus.
- Der in §5.4 optional erwähnte Trigram-Index ist damit **kein Ersatz**, sondern eine Ergänzung für
  Substring-Suche. Verfügbarkeit ist verifiziert (siehe ADR 0003).

## Verworfene Alternativen

- **Eigener FTS5-Tokenizer über die C-API.** Sauberer, aber better-sqlite3 exponiert `fts5_api` nicht, und
  ein eigenes natives Modul würde die in ADR 0003 gewonnene Rebuild-Freiheit wieder aufgeben.
- **Nur `ae/oe/ue`-Faltung ohne Doppelindizierung.** Gemessen: dann findet `münchen` zwar `Muenchen`, aber
  `munchen` findet gar nichts mehr. Verschiebt das Problem nur.
- **ICU-Tokenizer.** Nicht in den Prebuilds enthalten, und die deutsche Umlaut-Digraph-Äquivalenz ist auch
  dort keine Standard-Faltung.
