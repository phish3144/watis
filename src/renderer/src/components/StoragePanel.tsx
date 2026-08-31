import { useEffect, useState } from 'react'
import { formatBytes, type StorageOverview } from '@shared/extras/storage-overview'
import { api, type ExportScheduleState } from '../api'

/**
 * Where the disk went, and what may be cleared (PLAN.md Phase 9).
 *
 * The official client answers "what is using my disk" with nothing at all, which is how people end
 * up deleting the whole profile and scanning the QR code again. Each row here says what it is and
 * whether it is safe to remove — and the ones that are not safe say why, because "you cannot delete
 * this" without a reason just reads as the application being precious about its files.
 */
export function StoragePanel(): React.JSX.Element {
  const [storage, setStorage] = useState<StorageOverview | undefined>(undefined)
  const [schedule, setSchedule] = useState<ExportScheduleState | null>(null)
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState<string | undefined>(undefined)

  const refresh = (): void => {
    // Measured on request, never on a timer: walking the blob store means stat-ing every file.
    void api().getStorage().then(setStorage)
    void api().exportSchedule.state().then(setSchedule)
  }

  useEffect(refresh, [])

  return (
    <div className="flex flex-col gap-3 text-xs">
      <div className="flex items-center justify-between">
        <span className="text-wa-muted">
          {storage ? `Gesamt ${formatBytes(storage.totalBytes)}` : 'Wird berechnet …'}
        </span>
        <button
          type="button"
          onClick={refresh}
          className="rounded-md border border-wa-hairline px-2 py-1"
        >
          Neu berechnen
        </button>
      </div>

      <ul className="flex flex-col gap-1">
        {storage?.sections.map((section) => (
          <li key={section.key} className="rounded-md bg-wa-surface px-3 py-2">
            <div className="flex items-baseline justify-between gap-3">
              <span>{section.label}</span>
              <span className="tabular-nums text-slate-200">{formatBytes(section.bytes)}</span>
            </div>
            {section.note && <p className="mt-0.5 text-wa-muted">{section.note}</p>}
            {!section.clearable && !section.note && (
              <p className="mt-0.5 text-wa-muted">Nicht löschbar.</p>
            )}
          </li>
        ))}
      </ul>

      <div className="flex items-center justify-between gap-3">
        <span className="text-wa-muted">
          Löschbar: {storage ? formatBytes(storage.clearableBytes) : '—'}
        </span>
        <button
          type="button"
          disabled={busy}
          onClick={() => {
            setBusy(true)
            setNote(undefined)
            void api()
              .clearCaches()
              .then(
                (next) => {
                  setStorage(next)
                  setNote('Cache geleert. Anmeldung und Archiv sind unberührt.')
                },
                (error: unknown) => {
                  setNote(String(error))
                },
              )
              .finally(() => {
                setBusy(false)
              })
          }}
          className="rounded-md border border-wa-hairline px-2 py-1 disabled:opacity-40"
        >
          Browser-Cache leeren
        </button>
      </div>

      <div className="rounded-md bg-wa-surface px-3 py-2">
        <div className="flex items-baseline justify-between gap-3">
          <span>Zeitgesteuerter Export</span>
          <button
            type="button"
            onClick={() => {
              setNote(undefined)
              void api()
                .exportSchedule.runNow()
                .then((ran) => {
                  setNote(ran ? 'Export gelaufen.' : 'Nichts exportiert — Zielordner prüfen.')
                  refresh()
                })
            }}
            className="rounded-md border border-wa-hairline px-2 py-1"
          >
            Jetzt exportieren
          </button>
        </div>
        <p className="mt-0.5 text-wa-muted">
          {schedule?.lastRunMs
            ? `Zuletzt ${new Date(schedule.lastRunMs).toLocaleString('de-DE')}, ${String(
                schedule.lastResult?.messages ?? 0,
              )} Nachrichten`
            : 'Noch nie gelaufen.'}
        </p>
        {schedule?.lastError && <p className="text-red-400">Fehler: {schedule.lastError}</p>}
      </div>

      {note && <p className="text-wa-muted">{note}</p>}
    </div>
  )
}
