import { useEffect, useState } from 'react'
import { api } from '../api'

/**
 * What the content index is doing, per kind of extraction.
 *
 * Asked for directly: "ich brauche ein status des OCR dienstes. Was ist mit Transkript?" Both
 * halves of that question were unanswerable from the archive view. Search over message text works
 * the moment a message arrives; text inside a photo or a PDF has to be extracted first, in the
 * background, and there was nothing anywhere that said whether that had happened, was running, or
 * had failed. "Die Suche funktioniert nur mit Text" was the reasonable conclusion.
 *
 * Voice notes are the sharp case and get said out loud rather than left to be inferred: they are
 * queued, find no engine, and are skipped, because ADR 0008 defers Whisper. A filter chip for
 * Sprachnachrichten with no transcription behind it is a promise the application does not keep.
 */

interface Counts {
  queued: number
  running: number
  done: number
  failed: number
  skipped: number
}

interface Status {
  counts?: Counts | null
  byKind?: Record<string, Counts> | null
  engines?: string[]
  working?: boolean
}

const LABEL: Record<string, string> = {
  ocr: 'Text in Bildern',
  pdf: 'PDFs',
  docx: 'Word-Dokumente',
  text: 'Textdateien',
  transcript: 'Sprachnachrichten',
}

/** The order they are worth reading in, rather than whatever the database returns first. */
const ORDER = ['ocr', 'pdf', 'transcript', 'docx', 'text']

export function IndexStatus(): React.JSX.Element | null {
  const [status, setStatus] = useState<Status | undefined>(undefined)

  useEffect(() => {
    let cancelled = false
    const read = (): void => {
      void api()
        .getIndexStatus()
        .then(
          (value) => {
            if (!cancelled) setStatus(value as Status)
          },
          () => {
            /* the health banner already reports a worker that is not answering */
          },
        )
    }
    read()
    const timer = setInterval(read, 4000)
    return () => {
      cancelled = true
      clearInterval(timer)
    }
  }, [])

  if (!status) return null

  const byKind = status.byKind ?? {}
  const engines = new Set(status.engines ?? [])
  const kinds = ORDER.filter((k) => byKind[k] !== undefined || k === 'transcript')

  return (
    <section className="rounded-lg border border-wa-hairline bg-wa-surface px-3 py-2 text-xs">
      <header className="mb-1.5 flex items-baseline justify-between gap-2">
        <h2 className="text-xs font-semibold">Texterkennung</h2>
        <span className="text-[11px] text-wa-muted">
          {status.working ? 'arbeitet gerade' : 'im Leerlauf'}
        </span>
      </header>

      {kinds.length === 0 && (
        <p className="text-wa-muted">
          Noch nichts zu verarbeiten. Sobald Bilder oder PDFs im Archiv liegen, wird ihr Text hier
          durchsuchbar gemacht.
        </p>
      )}

      <dl className="flex flex-col gap-1">
        {kinds.map((kind) => {
          const c = byKind[kind] ?? { queued: 0, running: 0, done: 0, failed: 0, skipped: 0 }
          const waiting = c.queued + c.running
          const unavailable = !engines.has(kind)
          return (
            <div key={kind} className="flex items-baseline justify-between gap-3">
              <dt className={unavailable ? 'text-wa-muted' : ''}>{LABEL[kind] ?? kind}</dt>
              <dd className="shrink-0 tabular-nums">
                {unavailable ? (
                  <span className="text-wa-muted">nicht verfügbar</span>
                ) : waiting > 0 ? (
                  <span className="text-wa-warning">
                    {waiting.toLocaleString('de-DE')} offen, {c.done.toLocaleString('de-DE')} fertig
                  </span>
                ) : c.failed > 0 ? (
                  <span className="text-wa-danger">
                    {c.done.toLocaleString('de-DE')} fertig, {c.failed.toLocaleString('de-DE')}{' '}
                    fehlgeschlagen
                  </span>
                ) : (
                  <span className="text-wa-muted">
                    {c.done.toLocaleString('de-DE')} fertig
                    {c.skipped > 0 && `, ${c.skipped.toLocaleString('de-DE')} übersprungen`}
                  </span>
                )}
              </dd>
            </div>
          )
        })}
      </dl>

      {!engines.has('transcript') && (
        <p className="mt-1.5 text-[11px] text-wa-muted">
          Sprachnachrichten werden nicht transkribiert. Die Entscheidung steht in ADR 0008: die
          nötige Spracherkennung bräuchte ein zusätzliches Programm neben der App und einen
          Modell-Download — beides verträgt sich nicht mit „läuft ohne Adminrechte, lädt nichts
          nach". Der Filter <em>Sprachnachrichten</em> in der Suche findet deshalb nichts.
        </p>
      )}
    </section>
  )
}
