import { useState } from 'react'
import { api, type LockState } from '../api'

/** Sets, changes or removes the PIN, and says what the lock is actually worth. */
export function LockSettings({
  state,
  onChange,
}: {
  state: LockState | undefined
  onChange: (state: LockState) => void
}): React.JSX.Element {
  const [pin, setPin] = useState('')
  const [idleMinutes, setIdleMinutes] = useState(String((state?.idleSeconds ?? 0) / 60))
  const [note, setNote] = useState<string | undefined>(undefined)

  const save = (nextPin: string): void => {
    setNote(undefined)
    void api()
      .lock.configure(nextPin, Math.round(Number(idleMinutes) * 60) || 0)
      .then((next) => {
        onChange(next)
        setPin('')
        setNote(next.configured ? 'PIN gesetzt.' : 'Sperre entfernt.')
      })
      .catch((error: unknown) => {
        setNote(String(error))
      })
  }

  return (
    <div className="flex flex-col gap-2 text-xs">
      <div className="flex flex-wrap items-center gap-2">
        <input
          type="password"
          inputMode="numeric"
          autoComplete="off"
          value={pin}
          onChange={(e) => {
            setPin(e.target.value)
          }}
          placeholder={state?.configured ? 'Neue PIN' : 'PIN setzen'}
          aria-label="PIN"
          className="w-28 rounded-md border border-wa-hairline bg-transparent px-2 py-1"
        />
        <button
          type="button"
          disabled={pin === ''}
          onClick={() => {
            save(pin)
          }}
          className="rounded-md border border-wa-hairline px-2 py-1 disabled:opacity-40"
        >
          Speichern
        </button>
        {state?.configured && (
          <>
            <button
              type="button"
              onClick={() => {
                save('')
              }}
              className="rounded-md border border-wa-hairline px-2 py-1"
            >
              Entfernen
            </button>
            <button
              type="button"
              onClick={() => {
                void api().lock.now().then(onChange)
              }}
              className="rounded-md border border-wa-hairline px-2 py-1"
            >
              Jetzt sperren
            </button>
          </>
        )}
      </div>

      <label className="flex items-center gap-2 text-wa-muted">
        Nach Inaktivität sperren
        <input
          type="number"
          min={0}
          max={1440}
          value={idleMinutes}
          onChange={(e) => {
            setIdleMinutes(e.target.value)
          }}
          className="w-16 rounded-md border border-wa-hairline bg-transparent px-2 py-1 text-right"
        />
        Minuten (0 = nur beim Start)
      </label>

      <p className="text-[11px] leading-snug text-slate-500">
        Sichtschutz, keine Verschlüsselung: Das Archiv bleibt lesbar auf der Platte, und wer Zugriff
        auf das Benutzerkonto hat, kommt daran. Die Sperre hält den Blick über die Schulter ab —
        wirklichen Schutz gibt BitLocker oder FileVault. Bei Fokusverlust wird das Fenster
        weichgezeichnet, auch ohne PIN-Abfrage.
      </p>
      {note && <p className="text-wa-muted">{note}</p>}
    </div>
  )
}
