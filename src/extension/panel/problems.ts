import type { HelpTopic } from './help'

/**
 * Why a file did not come, in words somebody can act on.
 *
 * The bridge, the media fetcher and the archive name their reasons in English, for logs and for the
 * desktop app; this turns the ones that reach the panel into German with a next step. The help
 * article on media renders its table from this same list, so the two cannot drift apart, and
 * test/unit/help.test.ts fails when the bridge or the fetcher gains a reason this list does not
 * explain (CLAUDE.md, "Hilfe aktuell halten").
 */

export interface MediaProblem {
  /** Matched against the English reason. */
  match: RegExp
  /** What happened, in one short sentence. */
  text: string
  /** What to do about it, if anything can be done. */
  advice?: string
  /** Shown in the help article's table; the first problem of a kind stands for the others. */
  inHelp?: boolean
}

export const MEDIA_PROBLEMS: readonly MediaProblem[] = [
  {
    match: /no longer on WhatsApp's servers/,
    text: 'Nicht mehr auf WhatsApps Servern.',
    advice: 'Auf dem Handy ist die Datei vielleicht noch da.',
    inHelp: true,
  },
  {
    match: /WhatsApp does not accept|WhatsApp refuses this file|WhatsApp blocks SVG/,
    text: 'WhatsApp gibt diese Datei nicht heraus.',
    advice: 'WhatsApp selbst lässt sie nicht zu, etwa wegen eines ungewöhnlichen Dateiformats.',
    inHelp: true,
  },
  {
    match: /view-once/,
    text: '„Einmal ansehen“-Medien archiviert WatIs? bewusst nicht.',
    inHelp: true,
  },
  {
    match:
      /no key for its attachment|no download path|has no attachment|does not treat this message as media|no message to download from|unknown attachment/,
    text: 'WhatsApp hat zu dieser Nachricht keine Angaben zum Herunterladen.',
    advice: 'Auf dem Handy öffnen – dort ist die Datei vielleicht noch da.',
    inHelp: true,
  },
  {
    match: /did not hand over the file|not fetched/,
    text: 'WhatsApp hat die Datei nicht herausgegeben.',
    advice: 'Später noch einmal auf „Laden“ klicken.',
    inHelp: true,
  },
  {
    match: /blob store quota reached/,
    text: 'Die Speichergrenze für Medien ist erreicht.',
    advice: 'Unter Einstellungen → Archiv und Sicherung die Speichergrenze erhöhen.',
    inHelp: true,
  },
  {
    match:
      /media fetching is not running|not the archive|archive is not connected|archive moved|Dafür muss WhatsApp Web offen sein|Das Archiv ist nicht geöffnet/,
    text: 'Dafür muss WhatsApp Web in einem Tab offen und angemeldet sein.',
    advice: 'WhatsApp Web öffnen, kurz warten, dann noch einmal „Laden“.',
    inHelp: true,
  },
  {
    match: /did not answer|antwortet nicht|abort/i,
    text: 'WhatsApp hat nicht rechtzeitig geantwortet.',
    advice: 'Noch einmal versuchen. Lädt der WhatsApp-Tab gerade neu, kurz warten.',
    inHelp: true,
  },
  {
    match: /media types could not be read|Cannot read properties|is not a function/,
    text: 'WhatsApp hat etwas geändert, und das Holen von Medien klappt gerade nicht.',
    advice: 'Bis WatIs? nachgezogen ist, gehen Nachrichten und Suche weiter. Bitte melden.',
    inHelp: true,
  },
  // The automatic rules. A click goes past them, so these show only for what was skipped on its own.
  {
    match:
      /videos only on request|video larger than the automatic limit|audio off|images off|documents off|larger than \d+ bytes|unknown type/,
    text: 'Nach deinen Einstellungen nicht automatisch geholt.',
    advice: 'Ein Klick auf „Laden“ holt die Datei trotzdem.',
  },
]

export interface Explained {
  text: string
  advice?: string | undefined
  /** False when no rule knew the reason; the panel then also shows it as it came. */
  known: boolean
  raw: string
  help: HelpTopic
}

export function explainMediaProblem(raw: string): Explained {
  const problem = MEDIA_PROBLEMS.find((p) => p.match.test(raw))
  if (problem)
    return { text: problem.text, advice: problem.advice, known: true, raw, help: 'medien' }
  return { text: 'Das hat nicht geklappt.', known: false, raw, help: 'probleme' }
}
