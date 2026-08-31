import { useEffect, useRef, useState } from 'react'
import { api, type LockState } from '../api'

/**
 * The unlock screen (PLAN.md Phase 8).
 *
 * It covers the panel and says what it is honestly: the archive is not encrypted, this keeps the
 * person walking past the desk from reading the screen. Claiming more than that would be worse than
 * having no lock — somebody might rely on it.
 */
export function LockScreen({ state }: { state: LockState | undefined }): React.JSX.Element | null {
  const [pin, setPin] = useState('')
  const [wrong, setWrong] = useState(false)
  const [busy, setBusy] = useState(false)
  const field = useRef<HTMLInputElement | null>(null)

  useEffect(() => {
    if (state?.locked) field.current?.focus()
  }, [state?.locked])

  if (!state?.locked) return null

  const submit = (): void => {
    if (busy || pin === '') return
    setBusy(true)
    setWrong(false)
    void api()
      .lock.unlock(pin)
      .then((ok) => {
        if (ok) setPin('')
        else setWrong(true)
      })
      .finally(() => {
        setBusy(false)
      })
  }

  return (
    <div className="absolute inset-0 z-50 flex flex-col items-center justify-center gap-3 bg-wa-panel p-6 text-sm">
      <h2 className="text-base font-semibold">WatIs? ist gesperrt</h2>
      <input
        ref={field}
        type="password"
        inputMode="numeric"
        autoComplete="off"
        value={pin}
        onChange={(e) => {
          setPin(e.target.value)
          setWrong(false)
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') submit()
        }}
        aria-label="PIN"
        aria-invalid={wrong}
        className="w-40 rounded-md border border-wa-hairline bg-transparent px-3 py-2 text-center tracking-[0.4em]"
      />
      <button
        type="button"
        disabled={busy || pin === ''}
        onClick={submit}
        className="rounded-md border border-wa-hairline px-4 py-1.5 disabled:opacity-40"
      >
        {busy ? 'Prüfe …' : 'Entsperren'}
      </button>
      {wrong && (
        <p role="alert" className="text-xs text-red-400">
          Falsche PIN.
        </p>
      )}
      <p className="max-w-xs text-center text-[11px] leading-snug text-slate-500">
        Diese Sperre ist ein Sichtschutz, keine Verschlüsselung. Das Archiv liegt weiterhin lesbar
        auf der Platte. Wirklichen Schutz gibt die Laufwerksverschlüsselung des Betriebssystems.
      </p>
    </div>
  )
}
