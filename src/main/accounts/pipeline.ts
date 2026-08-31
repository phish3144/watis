import type { WebContentsView } from 'electron'
import { BridgeHost } from '../bridge/host'
import { Importer, type ImporterStats } from '../archive/importer'
import { BackfillController } from '../backfill/controller'
import { MediaFetcher } from '../archive/media-fetcher'
import type { BridgeReady } from '../../bridge/protocol'
import type { BackfillSnapshot } from '../backfill/state-machine'
import { log } from '../logging'

/**
 * Everything that mirrors one account into one archive (PLAN.md Phase 8).
 *
 * Before accounts existed these four objects were loose variables in the entry point, which worked
 * because there was exactly one of each. Grouping them is what makes a second account possible —
 * and it is also what keeps a second account from being a half-feature: a background account whose
 * bridge is not attached does not archive, and an unread badge over an archive that stopped
 * growing is worse than having no second account at all.
 */

export interface AccountPipelineOptions {
  accountId: string
  view: WebContentsView
  archive: (request: unknown) => Promise<unknown>
  onBridge: (accountId: string, report: BridgeReady) => void
  onBackfill: (accountId: string, snapshot: BackfillSnapshot) => void
}

export class AccountPipeline {
  readonly accountId: string
  readonly bridge: BridgeHost
  readonly importer: Importer
  readonly backfill: BackfillController
  readonly mediaFetcher: MediaFetcher

  constructor(options: AccountPipelineOptions) {
    this.accountId = options.accountId

    // The importer keeps the main process out of the per-message path: events land in its ring
    // buffer and leave in batches (§3.1).
    this.importer = new Importer(options.archive)
    this.importer.start()

    this.bridge = new BridgeHost({
      onEvents: (events) => {
        for (const event of events) this.importer.push(event)
      },
      onHealth: (report) => {
        options.onBridge(options.accountId, report)
      },
      onSnapshotDone: () => {
        log.info(`${options.accountId}: bridge finished its initial snapshot`)
      },
    })
    this.bridge.attach(options.view.webContents)

    this.backfill = new BackfillController({
      bridge: this.bridge,
      archive: options.archive,
      onChange: (snapshot) => {
        options.onBackfill(options.accountId, snapshot)
      },
    })

    this.mediaFetcher = new MediaFetcher({ bridge: this.bridge, archive: options.archive })
    this.mediaFetcher.start()
  }

  stats(): ImporterStats {
    return this.importer.stats()
  }

  async dispose(): Promise<void> {
    this.backfill.stop()
    this.mediaFetcher.stop()
    this.bridge.dispose()
    await this.importer.stop()
  }
}
