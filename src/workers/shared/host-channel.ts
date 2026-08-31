import { parseHostMessage, type WorkerName, type WorkerToHost } from '@shared/ipc/worker-protocol'

/**
 * Both workers share this tiny control-plane wrapper. It is deliberately Electron-free apart
 * from the MessagePortMain handed over at startup, so the worker bodies can be unit-tested as
 * plain Node.
 */

interface MessagePortLike {
  on(event: 'message', listener: (event: { data: unknown }) => void): void
  postMessage(message: unknown): void
  start(): void
}

export interface HostChannel {
  send(message: WorkerToHost): void
  log(level: 'debug' | 'info' | 'warn' | 'error', message: string): void
}

/** Handles one data-plane request. Throwing turns into an error response, never a dead worker. */
export type RequestHandler = (payload: unknown) => unknown

export function connectToHost(options: {
  name: WorkerName
  onShutdown: (reason: string) => Promise<void> | void
  onRequest?: RequestHandler
}): Promise<HostChannel> {
  return new Promise((resolve) => {
    process.parentPort.once('message', (event) => {
      const port = event.ports[0] as unknown as MessagePortLike | undefined
      if (!port) throw new Error(`${options.name}: host did not hand over a MessagePort`)

      const channel: HostChannel = {
        send: (message) => {
          port.postMessage(message)
        },
        log: (level, message) => {
          port.postMessage({ type: 'log', level, message })
        },
      }

      port.on('message', (message) => {
        const parsed = parseHostMessage(message.data)
        if (!parsed) {
          channel.log('warn', 'dropped malformed host message')
          return
        }
        if (parsed.type === 'ping') {
          channel.send({ type: 'pong', nonce: parsed.nonce })
          return
        }
        if (parsed.type === 'request') {
          const { id } = parsed
          // Every request answers exactly once, success or failure. A handler that throws must not
          // leave the caller's promise hanging for the life of the process.
          void (async () => {
            try {
              const result = await options.onRequest?.(parsed.payload)
              channel.send({ type: 'response', id, ok: true, result })
            } catch (error) {
              channel.send({ type: 'response', id, ok: false, error: String(error) })
            }
          })()
          return
        }
        void Promise.resolve(options.onShutdown(parsed.reason)).then(
          () => {
            process.exit(0)
          },
          (error: unknown) => {
            channel.log('error', `shutdown failed: ${String(error)}`)
            process.exit(1)
          },
        )
      })
      port.start()

      channel.send({ type: 'ready', worker: options.name, pid: process.pid })
      resolve(channel)
    })
  })
}
