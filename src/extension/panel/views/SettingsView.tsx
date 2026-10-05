import { useEffect, useRef, useState } from 'react'
import type { Settings, SettingsPatch } from '@shared/settings'
import { version } from '../api'
import {
  backupAsZip,
  backupState,
  backupToFolder,
  chooseFolder,
  folderBackupSupported,
  savedFolder,
  type BackupProgress,
  type BackupState,
} from '../backup'
import type { PanelStatus } from '../hooks'
import {
  currentMessages,
  restore,
  sourceFromFolder,
  sourceFromZips,
  type RestoreProgress,
  type RestoreSource,
} from '../restore'
import { bytes, count, when } from '../format'
import { DownloadIcon } from '../icons'
import { t } from '../strings'
import { Button, Card, Segmented, SettingRow, Spinner, Toggle } from '../ui'
import { TranscriptionSettings } from './TranscriptionSettings'

/**
 * Settings, grouped by what somebody is trying to do rather than by where the code lives. Each card
 * says in one sentence why it exists; switches that only mean something on the desktop (tray,
 * autostart, global shortcut, updates) are not here at all instead of being greyed out.
 */

const VIDEO_LIMITS = [0, 5, 16, 50] as const

export function SettingsView({
  settings,
  patch,
  status,
}: {
  settings: Settings
  patch: (next: SettingsPatch) => void
  status: PanelStatus
}): React.JSX.Element {
  return (
    <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-6 pt-1">
      <div className="mx-auto max-w-5xl gap-3 space-y-3 min-[860px]:columns-2 min-[860px]:space-y-0 [&>*]:mb-3 [&>*]:break-inside-avoid">
        <ArchiveCard settings={settings} patch={patch} status={status} />

        <Card title={t('settings.media')} hint={t('settings.media.hint')} help="medien">
          <SettingRow
            label={t('settings.media.images')}
            control={
              <Toggle
                label={t('settings.media.images')}
                checked={settings.archiveImages}
                onChange={(archiveImages) => {
                  patch({ archiveImages })
                }}
              />
            }
          />
          <SettingRow
            label={t('settings.media.documents')}
            control={
              <Toggle
                label={t('settings.media.documents')}
                checked={settings.archiveDocuments}
                onChange={(archiveDocuments) => {
                  patch({ archiveDocuments })
                }}
              />
            }
          />
          <SettingRow
            label={t('settings.media.voice')}
            hint={t('settings.media.voice.hint')}
            control={
              <Toggle
                label={t('settings.media.voice')}
                checked={settings.archiveVoice}
                onChange={(archiveVoice) => {
                  patch({ archiveVoice })
                }}
              />
            }
          />
          <SettingRow
            label={t('settings.media.videos')}
            control={
              <select
                aria-label={t('settings.media.videos')}
                value={settings.archiveVideoMaxMb}
                onChange={(event) => {
                  patch({ archiveVideoMaxMb: Number(event.target.value) })
                }}
                className="rounded-lg bg-wa-raised px-2 py-1 text-[13px]"
              >
                {VIDEO_LIMITS.map((mb) => (
                  <option key={mb} value={mb}>
                    {mb === 0 ? t('settings.media.videos.off') : `${String(mb)} MB`}
                  </option>
                ))}
              </select>
            }
          />
        </Card>

        <Card title={t('settings.index')} help="texterkennung">
          <SettingRow
            label={t('settings.index.ocr')}
            hint={t('settings.index.ocr.hint')}
            control={
              <Toggle
                label={t('settings.index.ocr')}
                checked={!settings.indexPaused}
                onChange={(on) => {
                  patch({ indexPaused: !on })
                }}
              />
            }
          />
          <TranscriptionSettings settings={settings} patch={patch} />
        </Card>

        <Card title={t('settings.notifications')}>
          <SettingRow
            label={t('settings.notifications.enabled')}
            control={
              <Toggle
                label={t('settings.notifications.enabled')}
                checked={settings.notifications}
                onChange={(notifications) => {
                  patch({ notifications })
                }}
              />
            }
          />
          <SettingRow
            label={t('settings.notifications.visible')}
            control={
              <Toggle
                label={t('settings.notifications.visible')}
                checked={settings.suppressWhenVisible}
                onChange={(suppressWhenVisible) => {
                  patch({ suppressWhenVisible })
                }}
              />
            }
          />
          <SettingRow
            label={t('settings.notifications.coalesce')}
            control={
              <select
                aria-label={t('settings.notifications.coalesce')}
                value={settings.coalesceWindowMs}
                onChange={(event) => {
                  patch({ coalesceWindowMs: Number(event.target.value) })
                }}
                className="rounded-lg bg-wa-raised px-2 py-1 text-[13px]"
              >
                {[0, 3000, 10000, 30000].map((ms) => (
                  <option key={ms} value={ms}>
                    {ms === 0 ? '–' : `${String(ms / 1000)} s`}
                  </option>
                ))}
              </select>
            }
          />
          <SettingRow
            label={t('settings.notifications.dnd')}
            control={
              <div className="flex items-center gap-1.5">
                <input
                  type="time"
                  aria-label={`${t('settings.notifications.dnd')} von`}
                  value={settings.dndFrom}
                  disabled={!settings.dndEnabled}
                  onChange={(event) => {
                    patch({ dndFrom: event.target.value })
                  }}
                  className="rounded-lg bg-wa-raised px-1.5 py-1 text-[13px] disabled:opacity-50"
                />
                <span className="text-wa-muted">–</span>
                <input
                  type="time"
                  aria-label={`${t('settings.notifications.dnd')} bis`}
                  value={settings.dndTo}
                  disabled={!settings.dndEnabled}
                  onChange={(event) => {
                    patch({ dndTo: event.target.value })
                  }}
                  className="rounded-lg bg-wa-raised px-1.5 py-1 text-[13px] disabled:opacity-50"
                />
                <Toggle
                  label={t('settings.notifications.dnd')}
                  checked={settings.dndEnabled}
                  onChange={(dndEnabled) => {
                    patch({ dndEnabled })
                  }}
                />
              </div>
            }
          />
        </Card>

        <Card title={t('settings.whatsapp')}>
          <SettingRow
            label={t('settings.whatsapp.compact')}
            control={
              <Toggle
                label={t('settings.whatsapp.compact')}
                checked={settings.compactMode}
                onChange={(compactMode) => {
                  patch({ compactMode })
                }}
              />
            }
          />
          <SettingRow
            label={t('settings.whatsapp.font')}
            control={
              <input
                type="range"
                min={0.8}
                max={1.4}
                step={0.05}
                value={settings.fontScale}
                aria-label={t('settings.whatsapp.font')}
                onChange={(event) => {
                  patch({ fontScale: Number(event.target.value) })
                }}
                className="w-28 accent-[var(--wa-accent)]"
              />
            }
          />
          <SettingRow
            label={t('settings.whatsapp.channels')}
            control={
              <Toggle
                label={t('settings.whatsapp.channels')}
                checked={settings.hideChannels}
                onChange={(hideChannels) => {
                  patch({ hideChannels })
                }}
              />
            }
          />
          <SettingRow
            label={t('settings.whatsapp.status')}
            control={
              <Toggle
                label={t('settings.whatsapp.status')}
                checked={settings.hideStatus}
                onChange={(hideStatus) => {
                  patch({ hideStatus })
                }}
              />
            }
          />
          <SettingRow
            label={t('settings.whatsapp.metaAi')}
            control={
              <Toggle
                label={t('settings.whatsapp.metaAi')}
                checked={settings.hideMetaAi}
                onChange={(hideMetaAi) => {
                  patch({ hideMetaAi })
                }}
              />
            }
          />
          <SettingRow
            label={t('settings.whatsapp.enter')}
            control={
              <Toggle
                label={t('settings.whatsapp.enter')}
                checked={settings.enterInsertsNewline}
                onChange={(enterInsertsNewline) => {
                  patch({ enterInsertsNewline })
                }}
              />
            }
          />
        </Card>

        <Card title={t('settings.panel')}>
          <div className="pt-0.5">
            <Segmented
              label={t('settings.panel')}
              value={settings.theme}
              options={[
                { value: 'system', label: t('settings.theme.system') },
                { value: 'light', label: t('settings.theme.light') },
                { value: 'dark', label: t('settings.theme.dark') },
              ]}
              onChange={(theme) => {
                patch({ theme })
              }}
            />
          </div>
        </Card>

        <Card title={t('settings.about')} help="datenschutz">
          <div className="space-y-2 text-xs leading-relaxed text-wa-muted">
            <p>{t('settings.about.local')}</p>
            <p>{t('settings.about.notOfficial')}</p>
            <p>
              {t('settings.about.version', { version })} ·{' '}
              <a
                className="text-wa-accent hover:underline"
                href="https://github.com/phish3144/watis"
                target="_blank"
                rel="noopener noreferrer"
              >
                GitHub
              </a>
            </p>
          </div>
        </Card>
      </div>
    </div>
  )
}

function ArchiveCard({
  settings,
  patch,
  status,
}: {
  settings: Settings
  patch: (next: SettingsPatch) => void
  status: PanelStatus
}): React.JSX.Element {
  const [usage, setUsage] = useState<number | undefined>(undefined)

  useEffect(() => {
    void navigator.storage.estimate().then((estimate) => {
      setUsage(estimate.usage)
    })
  }, [status.stats?.messages])

  const stats = status.stats
  return (
    <Card title={t('settings.archive')} hint={t('settings.archive.hint')} help="sicherung">
      {stats && (
        <div className="grid grid-cols-3 gap-2 pb-3 text-center">
          {[
            [count(stats.messages), 'Nachrichten'],
            [count(stats.chats), 'Chats'],
            [count(stats.media), 'Medien'],
          ].map(([value, label]) => (
            <div key={label} className="rounded-xl bg-wa-raised/70 py-2">
              <div className="text-base font-semibold tabular-nums">{value}</div>
              <div className="text-[11px] text-wa-muted">{label}</div>
            </div>
          ))}
        </div>
      )}
      <SettingRow
        label={t('settings.quota')}
        hint={
          usage !== undefined
            ? t('settings.storage', {
                used: bytes(usage),
                limit: `${String(settings.blobQuotaGb)} GB`,
              })
            : undefined
        }
        control={
          <select
            aria-label={t('settings.quota')}
            value={settings.blobQuotaGb}
            onChange={(event) => {
              patch({ blobQuotaGb: Number(event.target.value) })
            }}
            className="rounded-lg bg-wa-raised px-2 py-1 text-[13px]"
          >
            {[5, 10, 20, 50, 100].map((gb) => (
              <option key={gb} value={gb}>{`${String(gb)} GB`}</option>
            ))}
          </select>
        }
      />
      <BackupRows />
      <RestoreRows />
    </Card>
  )
}

/**
 * Getting the archive out of the browser profile (ADR 0011): into a folder of the user's choosing
 * where the browser allows it, as ZIP downloads everywhere.
 */
function BackupRows(): React.JSX.Element {
  const folderSupported = folderBackupSupported()
  const [state, setState] = useState<BackupState>({})
  const [folderName, setFolderName] = useState<string | undefined>(undefined)
  const [progress, setProgress] = useState<BackupProgress | undefined>(undefined)
  const [result, setResult] = useState<string | undefined>(undefined)
  const busy = progress !== undefined

  const refresh = (): void => {
    void backupState().then(setState)
    void savedFolder().then((handle) => {
      setFolderName(handle?.name)
    })
  }
  useEffect(refresh, [])

  const run = (job: () => Promise<string | undefined>): void => {
    setResult(undefined)
    setProgress({ files: 0, bytes: 0 })
    job()
      .then(setResult)
      .catch((e: unknown) => {
        // Closing the folder picker is not an error worth a red line.
        if (e instanceof DOMException && e.name === 'AbortError') return
        setResult(t('common.error', { error: e instanceof Error ? e.message : String(e) }))
      })
      .finally(() => {
        setProgress(undefined)
        refresh()
      })
  }

  const choose = (): void => {
    run(async () => {
      setFolderName(await chooseFolder())
      return undefined
    })
  }
  const toFolder = (): void => {
    run(async () => {
      const done = await backupToFolder(setProgress)
      return t('backup.done.folder', { copied: count(done.copied), kept: count(done.kept) })
    })
  }
  const asZip = (full: boolean): void => {
    run(async () => {
      const done = await backupAsZip(setProgress, { full })
      return t('backup.done.zip', {
        parts: done.parts.map((part) => part.split('/').pop()).join(', '),
        copied: count(done.copied),
      })
    })
  }

  const last = (at: number): string => when(Math.floor(at / 1000))
  return (
    <>
      {folderSupported && (
        <SettingRow
          label={t('backup.folder')}
          hint={
            folderName
              ? state.folder?.name === folderName
                ? t('backup.folder.last', { name: folderName, when: last(state.folder.at) })
                : t('backup.folder.never', { name: folderName })
              : t('backup.folder.none')
          }
          control={
            <Button variant="ghost" onClick={choose} disabled={busy}>
              {folderName ? t('backup.folder.change') : t('backup.folder.choose')}
            </Button>
          }
        />
      )}
      <div className="space-y-2 pt-3">
        <div className="flex flex-wrap items-center gap-2">
          {folderSupported && (
            <Button variant="primary" onClick={toFolder} disabled={busy || !folderName}>
              {busy ? <Spinner /> : <DownloadIcon className="h-4 w-4" />}
              {t('backup.now')}
            </Button>
          )}
          <Button
            variant={folderSupported ? 'secondary' : 'primary'}
            onClick={() => {
              asZip(false)
            }}
            disabled={busy}
          >
            {!folderSupported && busy ? <Spinner /> : null}
            {t('backup.zip')}
          </Button>
        </div>
        <p className="text-xs leading-snug text-wa-muted">
          {progress
            ? t('backup.running', { files: count(progress.files), bytes: bytes(progress.bytes) })
            : (result ??
              (state.zip
                ? t('backup.zip.since', { when: last(state.zip.at) })
                : t('backup.zip.first')))}
          {!progress && !result && state.zip && (
            <>
              {' '}
              <button
                type="button"
                className="text-wa-accent hover:underline"
                onClick={() => {
                  asZip(true)
                }}
              >
                {t('backup.zip.full')}
              </button>
            </>
          )}
        </p>
      </div>
    </>
  )
}

/**
 * Putting a backup back (restore.ts): pick it, see what it is and what it replaces, then confirm.
 * Nothing is touched before the confirmation.
 */
function RestoreRows(): React.JSX.Element {
  const folderSupported = folderBackupSupported()
  const input = useRef<HTMLInputElement>(null)
  const [source, setSource] = useState<RestoreSource | undefined>(undefined)
  const [current, setCurrent] = useState<number | undefined>(undefined)
  const [reading, setReading] = useState(false)
  const [progress, setProgress] = useState<RestoreProgress | undefined>(undefined)
  const [message, setMessage] = useState<string | undefined>(undefined)
  const busy = reading || progress !== undefined

  const fail = (e: unknown): void => {
    // Closing the folder picker is not an error worth a red line.
    if (e instanceof DOMException && e.name === 'AbortError') return
    setMessage(t('common.error', { error: e instanceof Error ? e.message : String(e) }))
  }

  const pick = (open: () => Promise<RestoreSource>): void => {
    setMessage(undefined)
    setSource(undefined)
    setReading(true)
    open()
      .then(async (found) => {
        setCurrent(await currentMessages())
        setSource(found)
      })
      .catch(fail)
      .finally(() => {
        setReading(false)
        if (input.current) input.current.value = ''
      })
  }

  const run = (): void => {
    if (!source) return
    setMessage(undefined)
    setProgress({ files: 0, bytes: 0 })
    restore(source, setProgress)
      .then((done) => {
        setMessage(
          t('restore.done', {
            messages: count(done.messages),
            chats: count(done.chats),
            copied: count(done.copied),
          }),
        )
      })
      .catch(fail)
      .finally(() => {
        setProgress(undefined)
        setSource(undefined)
      })
  }

  const whenMade = source ? when(Math.floor(source.createdAt.getTime() / 1000)) : ''
  return (
    <div className="mt-4 space-y-2 border-t border-wa-hairline pt-3">
      <SettingRow label={t('restore.title')} hint={t('restore.hint')} control={null} />
      <div className="flex flex-wrap items-center gap-2">
        {folderSupported && (
          <Button
            variant="ghost"
            disabled={busy}
            onClick={() => {
              pick(sourceFromFolder)
            }}
          >
            {t('restore.folder')}
          </Button>
        )}
        <input
          ref={input}
          type="file"
          multiple
          accept=".zip,application/zip"
          aria-label={t('restore.zip')}
          className="hidden"
          onChange={(event) => {
            const files = [...(event.target.files ?? [])]
            if (files.length > 0) {
              pick(() => sourceFromZips(files))
            }
          }}
        />
        <Button
          variant="ghost"
          disabled={busy}
          onClick={() => {
            input.current?.click()
          }}
        >
          {t('restore.zip')}
        </Button>
      </div>

      {source && !progress && (
        <div className="space-y-2 rounded-xl bg-wa-accent-soft px-3 py-2 text-xs leading-snug">
          <p>
            {current
              ? t('restore.confirm', {
                  when: whenMade,
                  media: count(source.media.length),
                  current: count(current),
                })
              : t('restore.confirm.empty', { when: whenMade, media: count(source.media.length) })}
          </p>
          <div className="flex flex-wrap gap-2">
            <Button variant="primary" onClick={run}>
              {t('restore.go')}
            </Button>
            <Button
              variant="ghost"
              onClick={() => {
                setSource(undefined)
              }}
            >
              {t('restore.cancel')}
            </Button>
          </div>
        </div>
      )}

      {(busy || message) && (
        <p className="text-xs leading-snug text-wa-muted">
          {reading ? (
            t('restore.reading')
          ) : progress ? (
            <>
              <Spinner />{' '}
              {t('restore.running', { files: count(progress.files), bytes: bytes(progress.bytes) })}
            </>
          ) : (
            message
          )}
        </p>
      )}
    </div>
  )
}
