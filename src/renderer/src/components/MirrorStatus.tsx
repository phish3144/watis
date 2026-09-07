import { useEffect, useState } from 'react'
import { api } from '../api'
import type { BridgeReady } from '../../../bridge/protocol'
import type { ImporterStats } from '../../../main/archive/importer'
import type { ArchiveStats } from '@shared/ipc/archive-protocol'

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
  const [archive, setArchive] = useState<ArchiveStats | undefined>(undefined)
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState<string | undefined>(undefined)

  useEffect(() => {
    // Ask first, then subscribe. The subscription only reports changes, and by the time this panel
    // mounts the bridge has usually already resolved — so without this the status sits on
    // "startet …" with a red dot forever, over a bridge that is working.
    void api()
      .getBridge()
      .then((current) => {
        if (current) setBridge(current)
      })
    const off = api().onBridge(setBridge)
    const poll = (): void => {
      void api().getImportStats().then(setStats)
      // A failing stats call means the archive worker is restarting; the health banner already
      // says so, and blanking the numbers on a blip would be worse than leaving the last ones up.
      void (api().archive({ op: 'stats' }) as Promise<ArchiveStats>).then(setArchive, () => {
        /* keep the previous numbers */
      })
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
          // Broken down by kind, because "514 Einträge übernommen" above an archive holding zero
          // messages tells the user nothing about which half went wrong. `models` is what WhatsApp
          // actually held and `mapped` is what survived being read: 0 of 0 means WhatsApp has not
          // loaded that history yet, 0 of 5000 means WatIs? could not read what was there.
          const r = result as
            | {
                count?: number
                tally?: Record<
                  'chat' | 'contact' | 'message',
                  { models: number; mapped: number }
                > & {
                  messages?: {
                    noId: number
                    noChatId: number
                    noTs: number
                    firstRejected?: Record<string, string>
                  }
                }
              }
            | undefined
          const t = r?.tally
          if (!t) {
            setNote(`${r?.count ?? 0} Einträge übernommen.`)
            return
          }
          const part = (label: string, k: 'chat' | 'contact' | 'message'): string =>
            t[k].models === t[k].mapped
              ? `${t[k].mapped.toLocaleString('de-DE')} ${label}`
              : `${t[k].mapped.toLocaleString('de-DE')} von ${t[k].models.toLocaleString('de-DE')} ${label}`
          const head = `Übernommen: ${part('Chats', 'chat')}, ${part('Kontakte', 'contact')}, ${part('Nachrichten', 'message')}.`
          if (t.message.models === 0) {
            setNote(
              `${head} WhatsApp Web hält noch keine Nachrichten im Speicher — dafür ist „Ältere Nachrichten nachladen" da.`,
            )
            return
          }
          // Messages were there and none could be read. Which field was missing is the whole
          // question, and it cannot be answered from a developer machine: there is no logged-in
          // WhatsApp here or in CI. So it is shown, and it is only ever field names and types —
          // never a chat id, never a body.
          const d = t.messages
          if (d && t.message.mapped === 0 && t.message.models > 0) {
            const why = [
              d.noId > 0 ? `${d.noId}× ohne lesbare Nachrichten-ID` : '',
              d.noChatId > 0 ? `${d.noChatId}× ohne lesbare Chat-ID` : '',
              d.noTs > 0 ? `${d.noTs}× ohne Zeitstempel` : '',
            ]
              .filter(Boolean)
              .join(', ')
            const shape = d.firstRejected
              ? Object.entries(d.firstRejected)
                  .map(([k, v]) => `${k}=${v}`)
                  .join('\n')
              : ''
            setNote(
              `${head}\nKeine einzige Nachricht war lesbar: ${why}.\n` +
                `Form des ersten verworfenen Modells (nur Feldnamen und Typen, keine Inhalte):\n${shape}`,
            )
            return
          }
          setNote(head)
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
          {/*
            Three states in the text, so three in the dot. It used to be `bridge?.ok ? green : red`,
            which painted "still starting" in the same red as "broken" — an alarm for something
            that has not gone wrong yet, and the first thing a new user sees.
          */}
          <span
            className={`inline-block h-2 w-2 shrink-0 rounded-full ${
              bridge === undefined
                ? 'animate-pulse bg-wa-muted'
                : bridge.ok
                  ? 'bg-wa-accent'
                  : 'bg-wa-danger'
            }`}
            aria-hidden="true"
          />
          {bridge === undefined
            ? 'Mitschreiben startet …'
            : bridge.ok
              ? `Schreibt mit${bridge.version ? ` (WA Web ${bridge.version})` : ''}`
              : 'Schreibt gerade nicht mit'}
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

      {bridge?.ok === false && (
        <p className="text-wa-muted">
          WatIs? kommt an WhatsApps Innenleben gerade nicht heran — meistens nach einem Update von
          WhatsApp Web. Lesen und Schreiben in WhatsApp geht normal weiter, und das bereits
          Archivierte bleibt durchsuchbar; nur Neues kommt vorerst nicht dazu.
          {bridge.failures.length > 0 && (
            <span className="mt-0.5 block font-mono text-[10px] opacity-70">
              {bridge.failures.map((f) => f.module).join(', ')}
            </span>
          )}
        </p>
      )}

      {/*
        These used to read "Geschrieben", from the importer's own counter — which is the sum of
        upserted chats, contacts, messages AND media rows. It showed 1.438 directly above a box
        saying the archive was empty, and both were telling the truth about different things. What
        somebody wants to know here is what is actually IN the archive, so that is what it says now.
      */}
      {archive && (
        <dl className="grid grid-cols-3 gap-2 tabular-nums text-wa-muted">
          <div>
            <dt>Nachrichten</dt>
            <dd className="text-wa-text">{archive.messages.toLocaleString('de-DE')}</dd>
          </div>
          <div>
            <dt>Chats</dt>
            <dd className="text-wa-text">{archive.chats.toLocaleString('de-DE')}</dd>
          </div>
          <div>
            <dt>Wartend</dt>
            <dd className={behind > 1000 ? 'text-wa-warning' : 'text-wa-text'}>
              {behind.toLocaleString('de-DE')}
            </dd>
          </div>
        </dl>
      )}

      {/* An exception, not a statistic: shown only when it has actually happened. */}
      {stats !== null && stats.dropped > 0 && (
        <p className="text-wa-danger">
          {stats.dropped.toLocaleString('de-DE')} Ereignisse verworfen — der Schreiber kam nicht
          hinterher.
        </p>
      )}

      {stats?.lastError && <p className="text-wa-danger">Letzter Fehler: {stats.lastError}</p>}
      {note && (
        <p className="whitespace-pre-wrap break-words font-mono text-[10px] leading-snug text-wa-muted select-text">
          {note}
        </p>
      )}
    </div>
  )
}
