import type { Settings, SettingsPatch } from '@shared/settings'
import type { HealthState } from '@shared/health/degraded'
import type { BridgeReady } from '../../bridge/protocol'
import type { ImporterStats } from '../../main/archive/importer'
import type { BackfillSnapshot } from '../../main/backfill/state-machine'
import type { StorageOverview } from '@shared/extras/storage-overview'
import type { LockState } from '../../main/lock'
import type { Account } from '@shared/accounts'
import type { AccountList } from '../../preload/app'

export type { Account, AccountList }

export type { LockState }
import type { ExportScheduleState } from '../../preload/app'

export type { ExportScheduleState }

export type BackfillState = BackfillSnapshot & {
  pauseReason?: 'bridge' | 'in-use' | undefined
}

export interface Versions {
  app: string
  electron: string
  chrome: string
  node: string
}

export interface WorkerHealth {
  archive: boolean
  contentIndex: boolean
}

export interface UnreadCounts {
  unread: number
  mutedUnread: number
  /** Per account, so a tab can show its own number. Absent on older messages. */
  byAccount?: Record<string, { unread: number; mutedUnread: number }>
}

export interface ArchiveHit {
  msgId: string | null
  mediaId: string | null
  chatId: string | null
  ts: number | null
  source: string
  score: number
}

export interface ArchiveMessage {
  id: string
  chatId: string
  senderJid?: string | null
  ts: number
  body?: string | null
  mediaId?: string | null
  edited?: boolean
  revoked?: boolean
  fromMe?: boolean
}

export interface ArchiveChat {
  id: string
  name?: string | null
  kind?: string | null
  lastMsgTs?: number | null
}

export interface WatIsApi {
  archive(request: unknown): Promise<unknown>
  getVersions(): Promise<Versions>
  getWorkerHealth(): Promise<WorkerHealth>
  getPaths(): Promise<Record<string, string>>
  getHealth(): Promise<HealthState>
  getImportStats(): Promise<ImporterStats | null>
  getStorage(): Promise<StorageOverview>
  accounts: {
    list(): Promise<AccountList>
    add(label: string): Promise<AccountList>
    rename(id: string, label: string): Promise<AccountList>
    remove(id: string): Promise<{ accounts: Account[]; dataDir: string; activeId: string }>
    activate(id: string): Promise<AccountList>
  }
  onAccounts(listener: (list: AccountList) => void): () => void
  lock: {
    state(): Promise<LockState>
    configure(pin: string, idleSeconds: number): Promise<LockState>
    unlock(pin: string): Promise<boolean>
    now(): Promise<LockState>
  }
  onLock(listener: (state: LockState) => void): () => void
  getSpellcheckLanguages(): Promise<string[]>
  openNumber(input: string): Promise<{ ok: boolean; number?: string; reason?: string }>
  files: {
    blobPath(mediaId: string): Promise<string | null>
    open(path: string): Promise<string>
    reveal(path: string): Promise<boolean>
    saveMany(mediaIds: string[]): Promise<{ saved: number; missing?: number; cancelled?: boolean }>
    hitImage(mediaId: string, page?: number): Promise<{ dataUrl: string } | null>
    startDrag(path: string): void
  }
  clearCaches(): Promise<StorageOverview>
  moveBlobs(targetDir: string): Promise<{ moved: number; bytes: number; to: string }>
  getIndexStatus(): Promise<unknown>
  reindex(kind: string): Promise<unknown>
  exportSchedule: {
    state(): Promise<ExportScheduleState | null>
    runNow(): Promise<boolean>
  }
  backup(targetDir: string, includeBlobs?: boolean): Promise<unknown>
  bridge: {
    snapshot(): Promise<unknown>
    openChat(chatId: string, msgId?: string): Promise<unknown>
    loadOlder(chatId: string): Promise<unknown>
  }
  backfill: {
    state(): Promise<BackfillState>
    start(chatIds: string[]): Promise<BackfillSnapshot>
    stop(): Promise<boolean>
  }
  getSettings(): Promise<Settings>
  updateSettings(patch: SettingsPatch): Promise<Settings>
  onSettings(listener: (settings: Settings) => void): () => void
  onHealth(listener: (state: HealthState) => void): () => void
  onBridge(listener: (report: BridgeReady) => void): () => void
  onBackfill(listener: (snapshot: BackfillSnapshot) => void): () => void
  onUnread(listener: (counts: UnreadCounts) => void): () => void
}

declare global {
  interface Window {
    watis: WatIsApi
  }
}

export const api = (): WatIsApi => window.watis
