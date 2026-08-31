import { useEffect, useState } from 'react'
import { api } from '../api'
import type { BridgeReady } from '../../../bridge/protocol'
import type { ImporterStats } from '../../../main/archive/importer'

/**
 * What the mirror is doing: whether the bridge resolved, how far behind the writer is, and how
 * much was dropped (PLAN.md Phase 3, "Backpressure-Zähler in der UI").
 *
 * Dropped events are shown rather than hidden. The ring buffer drops on purpose — a stalled worker
 * has to cost a countable gap instead of memory — and a gap the user cannot see is a gap they will
 * blame on the archive being wrong.
 */
export function MirrorStatus(): React.JSX.Element {
  const [bridge, setBridge] = useState<BridgeReady | undefined>(undefined)
  const [stats, setStats] = useState<ImporterStats | null>(null)
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState<string | undefined>(undefined)

  useEffect(() => {
    const off = api().onBridge(setBridge)
    const poll = (): void => {
      void api().getImportStats().then(setStats)
    }
    poll()
    const timer = setInterval(poll, 2000)
    return () => {
      clearInterval(timer)
      off()
    }
  }, [])

  const runSnapshot = (): void => {
    setBusy(true)
    setNote(undefined)
    void api()
      .bridge.snapshot()
      .then(
        (result) => {
          const count = (result as { count?: number } | undefined)?.count ?? 0
          setNote(`${count} Einträge übernommen.`)
        },
        (error: unknown) => {
          setNote(String(error))
        },
      )
      .finally(() => {
        setBusy(false)
      })
  }

  const behind = stats ? stats.queued : 0

  return (
    <div className="flex flex-col gap-2 rounded-lg bg-wa-surface px-3 py-2 text-xs">
      <div className="flex items-center justify-between gap-3">
        <span className="flex items-center gap-2">
          <span
            className={`inline-block h-2 w-2 rounded-full ${bridge?.ok ? 'bg-wa-accent' : 'bg-red-500'}`}
            aria-hidden="true"
          />
          {bridge === undefined
            ? 'Spiegel startet …'
            : bridge.ok
              ? `Spiegel läuft${bridge.version ? ` (WA Web ${bridge.version})` : ''}`
              : 'Spiegel steht'}
        </span>
        <button
          type="button"
          disabled={busy || bridge?.ok !== true}
          onClick={runSnapshot}
          className="rounded-md border border-wa-hairline px-2 py-1 disabled:opacity-40"
        >
          {busy ? 'Übernehme …' : 'Jetzt übernehmen'}
        </button>
      </div>

      {bridge?.ok === false && bridge.failures.length > 0 && (
        <p className="text-wa-muted">
          Nicht aufgelöst: {bridge.failures.map((f) => f.module).join(', ')}
        </p>
      )}

      {stats && (
        <dl className="grid grid-cols-3 gap-2 tabular-nums text-wa-muted">
          <div>
            <dt>Geschrieben</dt>
            <dd className="text-slate-200">{stats.written.toLocaleString('de-DE')}</dd>
          </div>
          <div>
            <dt>Wartend</dt>
            <dd className={behind > 1000 ? 'text-amber-400' : 'text-slate-200'}>
              {behind.toLocaleString('de-DE')}
            </dd>
          </div>
          <div>
            <dt>Verworfen</dt>
            <dd className={stats.dropped > 0 ? 'text-red-400' : 'text-slate-200'}>
              {stats.dropped.toLocaleString('de-DE')}
            </dd>
          </div>
        </dl>
      )}

      {stats?.lastError && <p className="text-red-400">Letzter Fehler: {stats.lastError}</p>}
      {note && <p className="text-wa-muted">{note}</p>}
    </div>
  )
}
