import { useEffect, useState } from 'react'
import { api } from '../api'
import type { ArchiveStats } from '@shared/ipc/archive-protocol'
import type { BridgeReady } from '../../../bridge/protocol'

/**
 * What the application is doing for you, shown while the archive is still empty.
 *
 * It exists because of a real report: someone ran this for a while and saw "no added value and no
 * extended functionality". Part of that was a hidden panel. The other part is this — an empty chat
 * list explains nothing, and a person who has just installed a WhatsApp wrapper has no way to tell
 * "it is working, give it time" apart from "it is broken".
 *
 * So this says which of the two it is, from real state, and disappears the moment the archive has
 * anything in it. It is not a tour and not a splash screen: once there are messages, the messages
 * are the better answer.
 */
export function FirstRun(): React.JSX.Element | null {
  const [stats, setStats] = useState<ArchiveStats | undefined>(undefined)
  const [bridge, setBridge] = useState<BridgeReady | undefined>(undefined)

  useEffect(() => {
    const read = (): void => {
      void (api().archive({ op: 'stats' }) as Promise<ArchiveStats>).then(setStats, () => {
        setStats(undefined)
      })
    }
    read()
    const timer = setInterval(read, 4000)
    const off = api().onBridge(setBridge)
    return () => {
      clearInterval(timer)
      off()
    }
  }, [])

  // Once anything is archived, the archive speaks for itself.
  if (stats === undefined || stats.messages > 0) return null

  const working = bridge?.ok === true
  const failed = bridge?.ok === false

  return (
    <section className="shrink-0 rounded-lg border border-wa-hairline bg-wa-surface px-4 py-3 text-xs leading-relaxed">
      <h2 className="mb-1 text-sm font-semibold">Das Archiv ist noch leer</h2>

      {working && (
        <p>
          <strong className="text-wa-accent">Das Mitschreiben läuft.</strong> Jede Nachricht, die ab
          jetzt ankommt, landet hier — dauerhaft, auch wenn WhatsApp sie irgendwann nicht mehr
          zeigt. Was WhatsApp gerade schon geladen hat, holt <em>Nachladen → Jetzt übernehmen</em>{' '}
          sofort herein.
        </p>
      )}

      {failed && (
        <p>
          <strong className="text-red-400">Es wird gerade nichts mitgeschrieben.</strong> WatIs?
          kommt an WhatsApps Innenleben nicht heran — das passiert typischerweise nach einem Update
          von WhatsApp Web. WhatsApp selbst funktioniert normal weiter; nur das Archiv wächst nicht.
        </p>
      )}

      {bridge === undefined && (
        <p>
          Warte darauf, dass WhatsApp Web geladen und verknüpft ist. Solange links noch der QR-Code
          steht, gibt es nichts mitzuschreiben.
        </p>
      )}

      <p className="mt-2 text-wa-muted">
        Sobald etwas drin ist, kannst du hier volltextsuchen — auch nach Text in Bildern und PDFs —,
        nach Datum springen, dir die Mediengalerie eines Chats ansehen und alles nach JSON, HTML
        oder TXT exportieren. Rückwirkend gibt WhatsApp Web höchstens rund 90 Tage her; ab heute
        geht nichts mehr verloren.
      </p>
    </section>
  )
}
