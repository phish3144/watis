import { useEffect, useState } from 'react'
import { MAX_ACCOUNTS } from '@shared/accounts'
import { api, type AccountList, type UnreadCounts } from '../api'

/**
 * Switching between accounts (PLAN.md Phase 8).
 *
 * The row is hidden entirely while there is only one account: a tab bar with one tab in it is
 * furniture, and most people will never add a second. Adding one is in the settings, where it
 * belongs — it is a rare, deliberate act, not something to put a button for next to the chat list.
 */
export function AccountTabs({ unread }: { unread: UnreadCounts }): React.JSX.Element | null {
  const [list, setList] = useState<AccountList | undefined>(undefined)

  useEffect(() => {
    void api().accounts.list().then(setList)
    return api().onAccounts(setList)
  }, [])

  if (!list || list.accounts.length < 2) return null

  return (
    <nav className="mb-2 flex shrink-0 flex-wrap gap-1" aria-label="Konten">
      {list.accounts.map((account) => {
        const count = unread.byAccount?.[account.id]?.unread ?? 0
        const active = account.id === list.activeId
        return (
          <button
            key={account.id}
            type="button"
            aria-current={active ? 'true' : undefined}
            onClick={() => {
              void api().accounts.activate(account.id).then(setList)
            }}
            className={`flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs ${
              active ? 'bg-wa-surface font-medium' : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            {account.label}
            {count > 0 && (
              <span className="rounded-full bg-wa-accent px-1.5 text-[10px] font-semibold text-black tabular-nums">
                {count > 99 ? '99+' : count}
              </span>
            )}
          </button>
        )
      })}
    </nav>
  )
}

/** Adding, renaming and removing accounts. Lives in the settings, not beside the chat list. */
export function AccountSettings(): React.JSX.Element {
  const [list, setList] = useState<AccountList | undefined>(undefined)
  const [label, setLabel] = useState('')
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState<string | undefined>(undefined)

  useEffect(() => {
    void api().accounts.list().then(setList)
    return api().onAccounts(setList)
  }, [])

  const full = (list?.accounts.length ?? 0) >= MAX_ACCOUNTS

  return (
    <div className="flex flex-col gap-2 text-xs">
      <ul className="flex flex-col gap-1">
        {list?.accounts.map((account) => (
          <li key={account.id} className="flex items-center gap-2">
            <input
              defaultValue={account.label}
              aria-label={`Name für ${account.label}`}
              onBlur={(e) => {
                if (e.target.value !== account.label) {
                  void api().accounts.rename(account.id, e.target.value).then(setList)
                }
              }}
              className="flex-1 rounded-md border border-wa-hairline bg-transparent px-2 py-1"
            />
            {account.primary ? (
              <span className="text-wa-muted">erstes Konto</span>
            ) : (
              <button
                type="button"
                onClick={() => {
                  void api()
                    .accounts.remove(account.id)
                    .then((result) => {
                      setList({ accounts: result.accounts, activeId: result.activeId })
                      setNote(
                        `Aus der Liste entfernt. Die Daten liegen weiter in ${result.dataDir}`,
                      )
                    })
                }}
                className="rounded-md border border-wa-hairline px-2 py-1"
              >
                Entfernen
              </button>
            )}
          </li>
        ))}
      </ul>

      <div className="flex gap-2">
        <input
          value={label}
          onChange={(e) => {
            setLabel(e.target.value)
          }}
          placeholder="Name des neuen Kontos"
          aria-label="Name des neuen Kontos"
          disabled={full}
          className="flex-1 rounded-md border border-wa-hairline bg-transparent px-2 py-1 disabled:opacity-40"
        />
        <button
          type="button"
          disabled={busy || full}
          onClick={() => {
            setBusy(true)
            setNote(undefined)
            void api()
              .accounts.add(label)
              .then((next) => {
                setList(next)
                setLabel('')
                setNote('Konto angelegt. Beim Wechsel dorthin erscheint ein neuer QR-Code.')
              })
              .catch((error: unknown) => {
                setNote(String(error))
              })
              .finally(() => {
                setBusy(false)
              })
          }}
          className="rounded-md border border-wa-hairline px-2 py-1 disabled:opacity-40"
        >
          Hinzufügen
        </button>
      </div>

      <p className="text-[11px] leading-snug text-slate-500">
        Jedes Konto bekommt eine eigene Anmeldung, ein eigenes Archiv und einen eigenen Medienordner
        — kein gemeinsamer Speicher mit einem Filter davor. Jedes läuft mit, auch das im
        Hintergrund; das kostet ungefähr so viel Speicher wie ein weiteres WhatsApp Web, und genau
        das ist es auch. <strong>Entfernen löscht keine Daten</strong>, es nimmt das Konto nur aus
        der Liste.
      </p>
      {note && <p className="text-wa-muted">{note}</p>}
    </div>
  )
}
