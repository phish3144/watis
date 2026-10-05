import type { BridgeCommand } from '../../bridge/protocol'
import { ext } from '../ext'
import type { Reply } from '../protocol'
import { ArchiveHost } from './archive-host'
import { transcribeHere } from '../whisper'
import { CONNECT, frameTokenKey, type FromFrame, type ToFrame } from './frame-link'

/**
 * The hidden page framed into the WhatsApp tab: the archive's home for as long as the tab is open,
 * in every browser (ADR 0010). It renders nothing.
 *
 * It talks to exactly one party, the relay that framed it, over a port handed over with a token
 * (`frame-link.ts`). Everything the archive needs from the rest of the extension goes through the
 * relay; that is what makes it work in Firefox, where this frame has hardly any extension APIs.
 */

const frameId = location.hash.slice(1)
let port: MessagePort | undefined
let nextBridge = 1
const bridgeCalls = new Map<number, (reply: Reply) => void>()

const send = (message: FromFrame): void => {
  port?.postMessage(message)
}

const host = new ArchiveHost({
  where: 'tab',
  bridge: (op: BridgeCommand['op'], args?: Record<string, unknown>) =>
    new Promise((resolve, reject) => {
      if (!port) {
        reject(new Error('not connected to the WhatsApp tab'))
        return
      }
      const id = nextBridge++
      bridgeCalls.set(id, (reply) => {
        if (reply.ok) resolve(reply.value)
        else reject(new Error(reply.error))
      })
      send(args ? { id, kind: 'bridge', op, args } : { id, kind: 'bridge', op })
    }),
  report: (report) => {
    send(report)
  },
})

/**
 * whisper.cpp, run here for Firefox: its extension pages are not cross-origin isolated, this frame
 * is, and whisper.cpp's threads need that (ADR 0012). The result goes straight into the archive
 * this frame holds.
 */
async function transcribe(mediaId: string, path: string): Promise<Reply> {
  try {
    const text = await transcribeHere(
      mediaId,
      path,
      () => undefined,
      async (transcript) => {
        const stored = await host.request(transcript)
        if (!stored.ok) throw new Error(stored.error)
      },
    )
    return { ok: true, value: text }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) }
  }
}

async function answer(message: ToFrame): Promise<void> {
  switch (message.kind) {
    case 'archive':
      send({ id: message.id, kind: 'reply', reply: await host.request(message.request) })
      return
    case 'fetch-media':
      send({ id: message.id, kind: 'reply', reply: await host.fetchMedia(message.mediaId) })
      return
    case 'export-database':
      send({ id: message.id, kind: 'reply', reply: await host.exportDatabase() })
      return
    case 'import-database':
      send({ id: message.id, kind: 'reply', reply: await host.importDatabase(message.path) })
      return
    case 'transcribe':
      send({
        id: message.id,
        kind: 'reply',
        reply: await transcribe(message.mediaId, message.path),
      })
      return
    case 'bridge-state':
      host.setBridgeReady(message.ok)
      return
    case 'reply':
      bridgeCalls.get(message.id)?.(message.reply)
      bridgeCalls.delete(message.id)
      return
  }
}

// Registered before anything is awaited: the relay hands the port over as soon as this frame has
// loaded, and a message that arrives before its listener is simply gone.
const offered: { token: unknown; port: MessagePort }[] = []
let token: string | undefined

function accept(): void {
  if (port || token === undefined) return
  const match = offered.find((offer) => offer.token === token)
  if (!match) return
  port = match.port
  port.onmessage = (event: MessageEvent<ToFrame>) => {
    void answer(event.data)
  }
  // One use. Leaving it in storage would let a later page load replay it.
  void ext.storage.local.remove(frameTokenKey(frameId))
}

window.addEventListener('message', (event) => {
  const data = event.data as { type?: unknown; token?: unknown } | null
  const offeredPort = event.ports[0]
  if (data?.type !== CONNECT || !offeredPort) return
  offered.push({ token: data.token, port: offeredPort })
  accept()
})

void (async () => {
  const stored = await ext.storage.local.get(frameTokenKey(frameId))
  const value = stored[frameTokenKey(frameId)] as { token?: unknown } | undefined
  token = typeof value?.token === 'string' ? value.token : undefined
  accept()
  await host.start()
})()

// For diagnosis from the browser's developer tools, and for the Firefox end-to-end check, which can
// reach this frame but cannot message it. The frame is an extension origin; WhatsApp's page cannot
// see this property.
;(window as unknown as { __watisHost: ArchiveHost }).__watisHost = host
