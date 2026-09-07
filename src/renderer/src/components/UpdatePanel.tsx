import { useEffect, useState } from 'react'
import { api, type UpdateState } from '../api'

/**
 * Updates (PLAN.md Phase 9).
 *
 * The banner appears only when a new version is actually downloaded and waiting — an update
 * notice that shows up while nothing is ready is noise, and noise is what people learn to click
 * past. Everything else lives in the settings section below.
 */
export function UpdateBanner({
  state,
}: {
  state: UpdateState | undefined
}): React.JSX.Element | null {
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState<string | undefined>(undefined)

  if (state?.status !== 'ready') return null

  return (
    <div
      role="status"
      className="mb-3 flex shrink-0 flex-wrap items-center gap-3 rounded-lg bg-wa-accent/15 px-3 py-2 text-xs"
    >
      <span>
        <strong>Version {state.version}</strong> ist heruntergeladen und wartet.
      </span>
      <button
        type="button"
        disabled={busy}
        onClick={() => {
          setBusy(true)
          // If this returns at all, the install did not start — a successful one never comes back,
          // because the process is replaced.
          void api()
            .update.install()
            .then((started) => {
              if (!started) setNote('Es liegt gerade nichts zum Installieren bereit.')
            })
            .finally(() => {
              setBusy(false)
            })
        }}
        className="rounded-md border border-wa-accent px-2 py-1 text-wa-accent disabled:opacity-40"
      >
        {busy ? 'Starte neu …' : 'Jetzt neu starten'}
      </button>
      <button
        type="button"
        onClick={() => {
          void api()
            .update.installOnQuit(true)
            .then(() => {
              setNote('Wird beim nächsten Beenden installiert.')
            })
        }}
        className="text-wa-muted underline-offset-2 hover:underline"
      >
        Beim nächsten Beenden
      </button>
      {note && <span className="text-wa-muted">{note}</span>}
    </div>
  )
}

const STATUS_TEXT = (state: UpdateState): string => {
  switch (state.status) {
    case 'disabled':
      return state.reason
    case 'checking':
      return 'Sucht nach Updates …'
    case 'downloading':
      return `Lädt Version ${state.version} … ${String(state.percent)} %`
    case 'ready':
      return `Version ${state.version} liegt bereit.`
    case 'error':
      return `Letzte Suche fehlgeschlagen: ${state.message}`
    case 'idle':
      return state.lastCheckedMs
        ? `Aktuell. Zuletzt geprüft: ${new Date(state.lastCheckedMs).toLocaleTimeString('de-DE')}`
        : 'Noch nicht geprüft.'
  }
}

export function UpdateSettings({
  state,
  autoUpdate,
  onAutoUpdate,
}: {
  state: UpdateState | undefined
  autoUpdate: boolean
  onAutoUpdate: (value: boolean) => void
}): React.JSX.Element {
  const [busy, setBusy] = useState(false)
  const [local, setLocal] = useState<UpdateState | undefined>(state)

  useEffect(() => {
    setLocal(state)
  }, [state])

  return (
    <div className="flex flex-col gap-2 text-xs">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-wa-muted">{local ? STATUS_TEXT(local) : 'Wird geladen …'}</span>
        <button
          type="button"
          disabled={busy || local?.status === 'disabled'}
          onClick={() => {
            setBusy(true)
            void api()
              .update.check()
              .then(setLocal)
              .finally(() => {
                setBusy(false)
              })
          }}
          className="rounded-md border border-wa-hairline px-2 py-1 disabled:opacity-40"
        >
          {busy ? 'Suche …' : 'Jetzt nach Updates suchen'}
        </button>
      </div>

      <label className="flex items-center gap-2">
        <input
          type="checkbox"
          checked={autoUpdate}
          onChange={(e) => {
            onAutoUpdate(e.target.checked)
          }}
        />
        Automatisch nach Updates suchen
      </label>

      <p className="text-[11px] leading-snug text-wa-muted">
        Updates kommen von GitHub Releases. Sie brauchen keine Adminrechte und installieren nur,
        wenn du es sagst. <strong>Archiv, Mediendateien und die Anmeldung bleiben unberührt</strong>{' '}
        — sie liegen in einem anderen Verzeichnis als das Programm, und ein Test hält das fest.
        Abgeschaltet greift die App auf gar nichts außerhalb von WhatsApp zu.
      </p>
    </div>
  )
}
