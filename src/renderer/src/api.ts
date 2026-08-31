import type { Settings, SettingsPatch } from '@shared/settings'

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
  getSettings(): Promise<Settings>
  updateSettings(patch: SettingsPatch): Promise<Settings>
  onSettings(listener: (settings: Settings) => void): () => void
  onUnread(listener: (counts: UnreadCounts) => void): () => void
}

declare global {
  interface Window {
    watis: WatIsApi
  }
}

export const api = (): WatIsApi => window.watis
