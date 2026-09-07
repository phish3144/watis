import { useEffect, useState } from 'react'
import { api, type ArchiveChat, type BackfillState } from '../api'

/**
 * The backfill's progress, deliberately without a progress bar (PLAN.md Phase 5).
 *
 * A bar needs a total, and there is no honest total here: WhatsApp Web hands over roughly ninety
 * days and says so only when asked, per chat, as it goes. A bar would fill up and then stop against
 * the ceiling, which reads as "nearly complete" when it actually means "this is all there is".
 * So the display counts what was fetched, names the date that turned out to be reachable, and says
 * where that date comes from.
 */

function formatDate(ts: number | undefined): string {
  if (ts === undefined) return 'unbekannt'
  return new Date(ts * 1000).toLocaleDateString('de-DE', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  })
}

/**
 * The bridge's reasons, in words. A raw 'empty-after-open' in the failure list is a clue for
 * whoever wrote it and nothing at all for the person reading the panel.
 */
const REASON_TEXT: Record<string, string> = {
  'chat-not-found': 'Chat in WhatsApp nicht gefunden.',
  'module-unresolved':
    'WatIs? findet die Stelle nicht mehr, an der WhatsApp ältere Nachrichten nachlädt — meist nach einem Update von WhatsApp Web.',
  'function-missing':
    'WhatsApp Web bietet das Nachladen an dieser Stelle nicht mehr an — meist nach einem Update.',
  'could-not-open': 'Der Chat ließ sich nicht öffnen.',
  'empty-after-open':
    'Der Chat wurde geöffnet, WhatsApp gab aber keine einzige Nachricht heraus. Das ist kein leerer Chat, sondern ein Problem an der Schnittstelle.',
}

const PAUSE_TEXT: Record<'bridge' | 'in-use', string> = {
  bridge: 'Wartet: keine Verbindung zu WhatsApps Interna.',
  'in-use': 'Wartet auf Leerlauf — das Nachladen öffnet Chats und würde dir dazwischenfunken.',
}

export function BackfillPanel({ chats }: { chats: ArchiveChat[] }): React.JSX.Element {
  const [state, setState] = useState<BackfillState | undefined>(undefined)
  const [error, setError] = useState<string | undefined>(undefined)

  useEffect(() => {
    const off = api().onBackfill((snapshot) => {
      setState((current) => ({ ...current, ...snapshot }))
    })
    const poll = (): void => {
      void api().backfill.state().then(setState)
    }
    poll()
    const timer = setInterval(poll, 3000)
    return () => {
      clearInterval(timer)
      off()
    }
  }, [])

  const done = state?.chats.filter((c) => c.state === 'done').length ?? 0
  const failed = state?.chats.filter((c) => c.state === 'failed') ?? []
  const messages = state?.chats.reduce((sum, c) => sum + c.messages, 0) ?? 0
  const oldest = state?.chats
    .map((c) => c.oldestTs)
    .filter((ts): ts is number => typeof ts === 'number')
    .sort((a, b) => a - b)[0]

  return (
    <section className="flex flex-col gap-2 rounded-lg bg-wa-surface px-3 py-2 text-xs">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-sm font-medium">Ältere Nachrichten nachladen</h2>
        {state?.running ? (
          <button
            type="button"
            onClick={() => {
              void api().backfill.stop()
            }}
            className="rounded-md border border-wa-hairline px-2 py-1"
          >
            Anhalten
          </button>
        ) : (
          <button
            type="button"
            disabled={chats.length === 0}
            onClick={() => {
              setError(undefined)
              void api()
                .backfill.start(chats.map((c) => c.id))
                .catch((e: unknown) => {
                  setError(String(e))
                })
            }}
            className="rounded-md border border-wa-hairline px-2 py-1 disabled:opacity-40"
          >
            Starten
          </button>
        )}
      </div>

      <p className="text-wa-muted">
        Das Nachladen öffnet jeden Chat der Reihe nach und bittet WhatsApp um eine Seite ältere
        Nachrichten — so, wie du selbst nach oben scrollen würdest. Geöffnete Chats gelten danach
        als gelesen.
      </p>

      {state?.running === false && state.chats.length === 0 && (
        <p className="text-wa-muted">Noch nicht gelaufen.</p>
      )}

      {state && state.chats.length > 0 && (
        <dl className="grid grid-cols-3 gap-2 tabular-nums text-wa-muted">
          <div>
            <dt>Chats fertig</dt>
            <dd className="text-wa-text">
              {done} / {state.chats.length}
            </dd>
          </div>
          <div>
            <dt>Nachgeladen</dt>
            <dd className="text-wa-text">{messages.toLocaleString('de-DE')}</dd>
          </div>
          <div>
            <dt>Zurück bis</dt>
            <dd className="text-wa-text">{formatDate(oldest)}</dd>
          </div>
        </dl>
      )}

      <p className="text-wa-muted">
        Erreichbar laut WhatsApp: <strong>{formatDate(state?.reachableTs)}</strong>. Diese Grenze
        setzt WhatsApp, nicht WatIs? — weiter zurück gibt es für Web-Clients nichts zu holen.
      </p>

      {state?.current && <p className="text-wa-muted">Gerade: {state.current}</p>}
      {!state?.running && state?.pauseReason && <p>{PAUSE_TEXT[state.pauseReason]}</p>}

      {failed.length > 0 && (
        <details>
          <summary className="cursor-pointer text-wa-danger">
            {failed.length} Chats fehlgeschlagen
          </summary>
          <ul className="mt-1 text-wa-muted">
            {failed.map((c) => (
              <li key={c.chatId}>
                {c.chatId}:{' '}
                {REASON_TEXT[(c.lastError ?? '').split(':')[0] ?? ''] ??
                  c.lastError ??
                  'unbekannter Fehler'}
                {/* The raw reason and its shape, kept verbatim and selectable: it is the thing
                    that has to reach whoever can fix it, and paraphrasing it loses the answer. */}
                {c.lastError?.includes(':') && (
                  <span className="mt-0.5 block font-mono text-[10px] break-words opacity-70 select-text">
                    {c.lastError}
                  </span>
                )}
              </li>
            ))}
          </ul>
        </details>
      )}

      {error !== undefined && <p className="text-wa-danger">{error}</p>}
    </section>
  )
}
