import { z } from 'zod'

/**
 * The typed channel between the main process and the two utilityProcess workers.
 *
 * Phase 0 carries only the control plane: readiness, health, structured logging and orderly
 * shutdown. The data plane (archive batches, search queries, index jobs) arrives with phase 3
 * and gets its own schemas — deliberately separate, because the control plane is validated on
 * every message while the data plane will not be able to afford that at 500-row batches.
 *
 * Invalid messages are dropped and logged, never thrown into the peer.
 */

export const WORKER_NAMES = ['archive', 'contentIndex'] as const
export type WorkerName = (typeof WORKER_NAMES)[number]

export const hostToWorkerSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('ping'), nonce: z.number().int().nonnegative() }),
  z.object({ type: z.literal('shutdown'), reason: z.string().max(200) }),
  // The data-plane envelope. `payload` stays unknown here on purpose: validating an import batch of
  // 500 rows against the control-plane schema on every message is exactly the overhead §3.1 forbids.
  // The worker validates it once, at its own boundary, with the schema that actually describes it.
  z.object({
    type: z.literal('request'),
    id: z.number().int().nonnegative(),
    payload: z.unknown(),
  }),
])

export const workerToHostSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('ready'), worker: z.enum(WORKER_NAMES), pid: z.number().int() }),
  z.object({ type: z.literal('pong'), nonce: z.number().int().nonnegative() }),
  z.object({
    type: z.literal('log'),
    level: z.enum(['debug', 'info', 'warn', 'error']),
    message: z.string().max(4000),
  }),
  z.object({ type: z.literal('fatal'), message: z.string().max(4000) }),
  z.object({
    type: z.literal('response'),
    id: z.number().int().nonnegative(),
    ok: z.boolean(),
    result: z.unknown().optional(),
    error: z.string().max(4000).optional(),
  }),
])

export type HostToWorker = z.infer<typeof hostToWorkerSchema>
export type WorkerToHost = z.infer<typeof workerToHostSchema>

/** Parse without throwing. Returns undefined for anything that does not match. */
export function parseWorkerMessage(raw: unknown): WorkerToHost | undefined {
  const result = workerToHostSchema.safeParse(raw)
  return result.success ? result.data : undefined
}

export function parseHostMessage(raw: unknown): HostToWorker | undefined {
  const result = hostToWorkerSchema.safeParse(raw)
  return result.success ? result.data : undefined
}
