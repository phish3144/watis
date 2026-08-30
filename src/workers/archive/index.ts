import { connectToHost } from '../shared/host-channel'

/**
 * The archive worker: SQLite (WAL), FTS5, the blob store and export.
 *
 * Phase 0 only proves the process model — it starts, answers health pings and shuts down
 * cleanly. The database opens in phase 3. It is opened HERE and nowhere else: the main process
 * must never hold a Database handle (see the supervisor's comment for why).
 */
async function main(): Promise<void> {
  const host = await connectToHost({
    name: 'archive',
    onShutdown: (reason) => {
      host.log('info', `shutting down: ${reason}`)
      // Phase 3: checkpoint the WAL and close the database here, before the process exits.
    },
  })
  host.log('info', 'archive worker started (no database yet — phase 3)')
}

void main()
