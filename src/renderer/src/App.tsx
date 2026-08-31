import { useCallback, useEffect, useState } from 'react'
import type { Settings, SettingsPatch } from '@shared/settings'
import { api, type UnreadCounts, type Versions, type WorkerHealth } from './api'
import { t } from './i18n'
import { NumberField, Row, Section, TextField, TimeField, Toggle } from './components/Controls'
import { ArchivePanel } from './archive/ArchivePanel'
import { HealthBanner } from './components/HealthBanner'
import { MirrorStatus } from './components/MirrorStatus'
import { StoragePanel } from './components/StoragePanel'
import type { HealthState } from '@shared/health/degraded'

function HealthDot({ ok }: { ok: boolean }): React.JSX.Element {
  return (
    <span
      className={`inline-block h-2 w-2 shrink-0 rounded-full ${ok ? 'bg-wa-accent' : 'bg-red-500'}`}
      aria-hidden="true"
    />
  )
}

type Tab = 'archive' | 'settings'

export function App(): React.JSX.Element {
  const [tab, setTab] = useState<Tab>('archive')
  const [settings, setSettings] = useState<Settings | undefined>(undefined)
  const [versions, setVersions] = useState<Versions | undefined>(undefined)
  const [health, setHealth] = useState<WorkerHealth | undefined>(undefined)
  const [paths, setPaths] = useState<Record<string, string> | undefined>(undefined)
  const [unread, setUnread] = useState<UnreadCounts>({ unread: 0, mutedUnread: 0 })
  const [degraded, setDegraded] = useState<HealthState | undefined>(undefined)

  useEffect(() => {
    void api().getSettings().then(setSettings)
    void api().getVersions().then(setVersions)
    void api().getPaths().then(setPaths)
    void api().getHealth().then(setDegraded)

    const offSettings = api().onSettings(setSettings)
    const offUnread = api().onUnread(setUnread)
    const offHealth = api().onHealth(setDegraded)

    const poll = (): void => {
      void api().getWorkerHealth().then(setHealth)
    }
    poll()
    const timer = setInterval(poll, 3000)
    return () => {
      clearInterval(timer)
      offSettings()
      offUnread()
      offHealth()
    }
  }, [])

  const patch = useCallback((next: SettingsPatch) => {
    // Optimistic, then corrected by whatever main actually stored — main is the authority,
    // because it validates the patch against the schema and may reject it.
    setSettings((current) => {
      if (!current) return current
      // Only defined keys are merged: with exactOptionalPropertyTypes a spread of a partial
      // could otherwise write an explicit `undefined` over a required field.
      const defined = Object.fromEntries(
        Object.entries(next).filter(([, value]) => value !== undefined),
      ) as Partial<Settings>
      return { ...current, ...defined }
    })
    void api().updateSettings(next).then(setSettings)
  }, [])

  if (!settings) {
    return <div className="p-5 text-sm text-slate-500">Lade Einstellungen …</div>
  }

  const downloadScheme = settings.sortDownloadsByChat
    ? `${settings.downloadDir}/<Chat>/2026-08-30_Angebot.pdf`
    : `${settings.downloadDir}/2026-08-30_Angebot.pdf`

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-wa-panel px-5 py-4 text-sm text-slate-200">
      <header className="mb-4 flex items-baseline justify-between gap-4">
        <div>
          <h1 className="text-base font-semibold">{t('app.title')}</h1>
          <p className="text-xs text-slate-500">{t('app.subtitle')}</p>
        </div>
        <nav className="flex gap-1" aria-label="Ansicht">
          {(['archive', 'settings'] as const).map((value) => (
            <button
              key={value}
              type="button"
              aria-current={tab === value ? 'page' : undefined}
              onClick={() => {
                setTab(value)
              }}
              className={`rounded-md px-3 py-1 text-xs ${
                tab === value ? 'bg-wa-surface font-medium' : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              {value === 'archive' ? 'Archiv' : 'Einstellungen'}
            </button>
          ))}
        </nav>
      </header>

      <HealthBanner state={degraded} />

      {tab === 'archive' ? (
        <div className="flex min-h-0 flex-1 flex-col gap-3">
          <MirrorStatus />
          <div className="min-h-0 flex-1">
            <ArchivePanel />
          </div>
        </div>
      ) : (
        <div className="min-h-0 flex-1 overflow-y-auto">
          <div className="mb-5 flex items-center gap-3 rounded-lg bg-wa-surface px-3 py-2">
            <span className="text-2xl font-semibold tabular-nums text-wa-accent">
              {unread.unread}
            </span>
            <div className="text-xs leading-tight text-slate-400">
              <div>{t('status.unread')}</div>
              {unread.mutedUnread > 0 && (
                <div className="text-slate-500">
                  {unread.mutedUnread} {t('status.muted')}
                </div>
              )}
            </div>
          </div>

          <Section title={t('section.window')}>
            <Row
              label={t('window.closeToTray')}
              hint={t('window.closeToTray.hint')}
              control={
                <Toggle
                  label={t('window.closeToTray')}
                  checked={settings.closeToTray}
                  onChange={(closeToTray) => {
                    patch({ closeToTray })
                  }}
                />
              }
            />
            <Row
              label={t('window.startMinimised')}
              control={
                <Toggle
                  label={t('window.startMinimised')}
                  checked={settings.startMinimised}
                  onChange={(startMinimised) => {
                    patch({ startMinimised })
                  }}
                />
              }
            />
            <Row
              label={t('window.autostart')}
              hint={navigator.userAgent.includes('Mac') ? t('window.autostart.hintMac') : undefined}
              control={
                <Toggle
                  label={t('window.autostart')}
                  checked={settings.autostart}
                  onChange={(autostart) => {
                    patch({ autostart })
                  }}
                />
              }
            />
            <Row
              label={t('window.shortcut')}
              hint={t('window.shortcut.hint')}
              control={
                <TextField
                  label={t('window.shortcut')}
                  value={settings.globalShortcut}
                  onChange={(globalShortcut) => {
                    patch({ globalShortcut })
                  }}
                />
              }
            />
          </Section>

          <Section title={t('section.notifications')}>
            <Row
              label={t('notify.enabled')}
              control={
                <Toggle
                  label={t('notify.enabled')}
                  checked={settings.notifications}
                  onChange={(notifications) => {
                    patch({ notifications })
                  }}
                />
              }
            />
            <Row
              label={t('notify.suppressWhenVisible')}
              hint={t('notify.suppressWhenVisible.hint')}
              control={
                <Toggle
                  label={t('notify.suppressWhenVisible')}
                  checked={settings.suppressWhenVisible}
                  onChange={(suppressWhenVisible) => {
                    patch({ suppressWhenVisible })
                  }}
                />
              }
            />
            <Row
              label={t('notify.coalesce')}
              hint={t('notify.coalesce.hint')}
              control={
                <NumberField
                  label={t('notify.coalesce')}
                  value={settings.coalesceWindowMs}
                  min={0}
                  max={15000}
                  step={500}
                  suffix=" ms"
                  onChange={(coalesceWindowMs) => {
                    patch({ coalesceWindowMs })
                  }}
                />
              }
            />
            <Row
              label={t('notify.muted')}
              control={
                <Toggle
                  label={t('notify.muted')}
                  checked={settings.mutedChatsNotify}
                  onChange={(mutedChatsNotify) => {
                    patch({ mutedChatsNotify })
                  }}
                />
              }
            />
            <Row
              label={t('notify.dnd')}
              control={
                <div className="flex items-center gap-2">
                  <Toggle
                    label={t('notify.dnd')}
                    checked={settings.dndEnabled}
                    onChange={(dndEnabled) => {
                      patch({ dndEnabled })
                    }}
                  />
                </div>
              }
            />
            {settings.dndEnabled && (
              <div className="flex items-center justify-end gap-2 pb-1 text-xs text-slate-400">
                <span>{t('notify.dnd.from')}</span>
                <TimeField
                  label={t('notify.dnd.from')}
                  value={settings.dndFrom}
                  onChange={(dndFrom) => {
                    patch({ dndFrom })
                  }}
                />
                <span>{t('notify.dnd.to')}</span>
                <TimeField
                  label={t('notify.dnd.to')}
                  value={settings.dndTo}
                  onChange={(dndTo) => {
                    patch({ dndTo })
                  }}
                />
              </div>
            )}
          </Section>

          <Section title={t('section.appearance')}>
            <Row
              label={t('appearance.compact')}
              hint={t('appearance.compact.hint')}
              control={
                <Toggle
                  label={t('appearance.compact')}
                  checked={settings.compactMode}
                  onChange={(compactMode) => {
                    patch({ compactMode })
                  }}
                />
              }
            />
            <Row
              label={t('appearance.fontScale')}
              control={
                <NumberField
                  label={t('appearance.fontScale')}
                  value={settings.fontScale}
                  min={0.8}
                  max={1.6}
                  step={0.05}
                  suffix="×"
                  onChange={(fontScale) => {
                    patch({ fontScale })
                  }}
                />
              }
            />
            <Row
              label={t('appearance.customCss')}
              hint={t('appearance.customCss.hint')}
              control={
                <Toggle
                  label={t('appearance.customCss')}
                  checked={settings.customCssEnabled}
                  onChange={(customCssEnabled) => {
                    patch({ customCssEnabled })
                  }}
                />
              }
            />
          </Section>

          <Section title={t('section.declutter')}>
            <Row
              label={t('declutter.channels')}
              control={
                <Toggle
                  label={t('declutter.channels')}
                  checked={settings.hideChannels}
                  onChange={(hideChannels) => {
                    patch({ hideChannels })
                  }}
                />
              }
            />
            <Row
              label={t('declutter.status')}
              control={
                <Toggle
                  label={t('declutter.status')}
                  checked={settings.hideStatus}
                  onChange={(hideStatus) => {
                    patch({ hideStatus })
                  }}
                />
              }
            />
            <Row
              label={t('declutter.metaAi')}
              hint={t('declutter.hint')}
              control={
                <Toggle
                  label={t('declutter.metaAi')}
                  checked={settings.hideMetaAi}
                  onChange={(hideMetaAi) => {
                    patch({ hideMetaAi })
                  }}
                />
              }
            />
          </Section>

          <Section title={t('section.input')}>
            <Row
              label={t('input.enterNewline')}
              hint={t('input.enterNewline.hint')}
              control={
                <Toggle
                  label={t('input.enterNewline')}
                  checked={settings.enterInsertsNewline}
                  onChange={(enterInsertsNewline) => {
                    patch({ enterInsertsNewline })
                  }}
                />
              }
            />
          </Section>

          <Section title={t('section.files')}>
            <Row
              label={t('files.downloadDir')}
              control={
                <TextField
                  label={t('files.downloadDir')}
                  value={settings.downloadDir}
                  width="w-52"
                  onChange={(downloadDir) => {
                    patch({ downloadDir })
                  }}
                />
              }
            />
            <Row
              label={t('files.sortByChat')}
              control={
                <Toggle
                  label={t('files.sortByChat')}
                  checked={settings.sortDownloadsByChat}
                  onChange={(sortDownloadsByChat) => {
                    patch({ sortDownloadsByChat })
                  }}
                />
              }
            />
            <Row
              label={t('files.notify')}
              control={
                <Toggle
                  label={t('files.notify')}
                  checked={settings.notifyOnDownload}
                  onChange={(notifyOnDownload) => {
                    patch({ notifyOnDownload })
                  }}
                />
              }
            />
            <div className="pt-1 text-[11px] text-slate-500">
              {t('files.scheme')}:{' '}
              <span className="break-all font-mono text-slate-400">{downloadScheme}</span>
            </div>
          </Section>

          <Section title={t('section.index')}>
            <Row
              label={t('index.paused')}
              hint={t('index.paused.hint')}
              control={
                <Toggle
                  label={t('index.paused')}
                  checked={settings.indexPaused}
                  onChange={(indexPaused) => {
                    patch({ indexPaused })
                  }}
                />
              }
            />
            <Row
              label={t('index.idle')}
              hint={t('index.idle.hint')}
              control={
                <NumberField
                  label={t('index.idle')}
                  value={settings.indexIdleThresholdSeconds}
                  min={5}
                  max={3600}
                  step={5}
                  onChange={(indexIdleThresholdSeconds) => {
                    patch({ indexIdleThresholdSeconds })
                  }}
                />
              }
            />
            <Row
              label={t('index.battery')}
              hint={t('index.battery.hint')}
              control={
                <Toggle
                  label={t('index.battery')}
                  checked={settings.indexOnBattery}
                  onChange={(indexOnBattery) => {
                    patch({ indexOnBattery })
                  }}
                />
              }
            />
            <Row
              label={t('index.concurrency')}
              control={
                <NumberField
                  label={t('index.concurrency')}
                  value={settings.indexConcurrency}
                  min={1}
                  max={4}
                  step={1}
                  onChange={(indexConcurrency) => {
                    patch({ indexConcurrency })
                  }}
                />
              }
            />
          </Section>

          <Section title={t('section.backup')}>
            <Row
              label={t('backup.enabled')}
              hint={t('backup.enabled.hint')}
              control={
                <Toggle
                  label={t('backup.enabled')}
                  checked={settings.scheduledExportEnabled}
                  onChange={(scheduledExportEnabled) => {
                    patch({ scheduledExportEnabled })
                  }}
                />
              }
            />
            <Row
              label={t('backup.dir')}
              control={
                <TextField
                  label={t('backup.dir')}
                  value={settings.scheduledExportDir}
                  width="w-52"
                  onChange={(scheduledExportDir) => {
                    patch({ scheduledExportDir })
                  }}
                />
              }
            />
            <Row
              label={t('backup.every')}
              control={
                <NumberField
                  label={t('backup.every')}
                  value={settings.scheduledExportEveryHours}
                  min={1}
                  max={336}
                  step={1}
                  onChange={(scheduledExportEveryHours) => {
                    patch({ scheduledExportEveryHours })
                  }}
                />
              }
            />
            <p className="pt-1 text-[11px] text-slate-500">{t('backup.restore.hint')}</p>
          </Section>

          <Section title={t('section.storage')}>
            <StoragePanel />
          </Section>

          <Section title={t('section.status')}>
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <HealthDot ok={health?.archive ?? false} />
                <span>{t('status.archive')}</span>
                <span className="text-slate-500">
                  {health?.archive ? t('status.running') : t('status.down')}
                </span>
              </div>
              <div className="flex items-center gap-2">
                <HealthDot ok={health?.contentIndex ?? false} />
                <span>{t('status.index')}</span>
                <span className="text-slate-500">
                  {health?.contentIndex ? t('status.running') : t('status.down')}
                </span>
              </div>
            </div>

            {versions && (
              <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-[11px] text-slate-500">
                {Object.entries(versions).map(([key, value]) => (
                  <div key={key} className="contents">
                    <dt>{key}</dt>
                    <dd className="font-mono text-slate-400">{value}</dd>
                  </div>
                ))}
              </dl>
            )}

            {paths && (
              <div className="mt-3 space-y-0.5 text-[11px] text-slate-500">
                {Object.entries(paths).map(([key, value]) => (
                  <div key={key}>
                    <div>{key}</div>
                    <div className="truncate font-mono text-slate-400" title={value}>
                      {value}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Section>

          <p className="pb-4 text-[11px] leading-relaxed text-slate-500">{t('phase.notice')}</p>
        </div>
      )}
    </div>
  )
}
