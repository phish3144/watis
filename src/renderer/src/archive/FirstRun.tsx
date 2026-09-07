import { useEffect, useState } from 'react'
import { api } from '../api'
import type { ArchiveStats } from '@shared/ipc/archive-protocol'
import type { BridgeReady } from '../../../bridge/protocol'

/**
 * One line on why the archive is still empty, shown only while it is.
 *
 * It exists because of a real report: someone ran this for a while and saw "no added value and no
 * extended functionality". Part of that was a hidden panel. The other part is this — an empty chat
 * list explains nothing, and a person who has just installed a WhatsApp wrapper has no way to tell
 * "it is working, give it time" apart from "it is broken".
 *
 * So this says which of the two it is, from real state, and disappears the moment the archive has
 * anything in it. It is not a tour and not a splash screen: once there are messages, the messages
 * are the better answer.
 *
 * It used to carry a heading and a paragraph listing every feature the archive would eventually
 * have. In a 460px panel that box was taller than everything below it, and it repeated what the
 * status line directly above it already said. What is left is the one sentence the status line
 * cannot give: what this means for the user.
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
    void api()
      .getBridge()
      .then((current) => {
        if (current) setBridge(current)
      })
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
    <section className="shrink-0 rounded-lg border border-wa-hairline bg-wa-surface px-3 py-2 text-xs leading-relaxed">
      {working && (
        <p>
          <strong className="text-wa-accent">Das Mitschreiben läuft.</strong> Jede Nachricht, die ab
          jetzt ankommt, bleibt hier — auch wenn WhatsApp sie irgendwann nicht mehr zeigt. Was schon
          geladen ist, holt <em>Jetzt übernehmen</em> sofort herein.
        </p>
      )}

      {failed && (
        <p>
          <strong className="text-wa-danger">Es wird gerade nichts mitgeschrieben.</strong> WatIs?
          kommt an WhatsApps Innenleben nicht heran — typischerweise nach einem Update von WhatsApp
          Web. WhatsApp selbst läuft normal weiter; nur das Archiv wächst nicht.
        </p>
      )}

      {bridge === undefined && <p>Warte darauf, dass WhatsApp Web geladen und verknüpft ist.</p>}
    </section>
  )
}
