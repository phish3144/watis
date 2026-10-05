import { useEffect, useRef, useState } from 'react'
import { TRANSCRIPTION_LANGUAGES, type Settings, type SettingsPatch } from '@shared/settings'
import { bytes } from '../format'
import { t, type StringKey } from '../strings'
import {
  deleteModel,
  downloadModel,
  importModel,
  installedModels,
  MODELS,
  transcriptionNeedsTab,
  transcriptionSupported,
  type ModelKey,
} from '../transcribe'
import { HelpLink } from '../helpui'
import { Button, SettingRow, Spinner } from '../ui'

/**
 * The speech models: which are here, and getting or removing one. A model is a few dozen to a few
 * hundred megabytes, so nothing happens without a click, and the size is said before it.
 */

const KEYS = Object.keys(MODELS) as ModelKey[]

export function TranscriptionSettings({
  settings,
  patch,
}: {
  settings: Settings
  patch: (next: SettingsPatch) => void
}): React.JSX.Element {
  const [installed, setInstalled] = useState<ModelKey[] | undefined>(undefined)
  const [progress, setProgress] = useState<Partial<Record<ModelKey, number>>>({})
  const [checking, setChecking] = useState(false)
  const [message, setMessage] = useState<string | undefined>(undefined)
  const input = useRef<HTMLInputElement>(null)
  const supported = transcriptionSupported()

  const refresh = (): Promise<void> => installedModels().then(setInstalled)
  useEffect(() => {
    void refresh()
  }, [])

  const fail = (e: unknown): void => {
    setMessage(t('common.error', { error: e instanceof Error ? e.message : String(e) }))
  }

  const download = (key: ModelKey): void => {
    setMessage(undefined)
    setProgress((p) => ({ ...p, [key]: 0 }))
    downloadModel(key, (fraction) => {
      setProgress((p) => ({ ...p, [key]: fraction }))
    })
      .catch(fail)
      .finally(() => {
        setProgress((p) => ({ ...p, [key]: undefined }))
        void refresh()
      })
  }

  const remove = (key: ModelKey): void => {
    void deleteModel(key).then(refresh)
  }

  const pick = (file: File | undefined): void => {
    if (!file) return
    setMessage(undefined)
    setChecking(true)
    importModel(file)
      .then(() => {
        setMessage(t('transcription.imported'))
      })
      .catch(fail)
      .finally(() => {
        setChecking(false)
        if (input.current) input.current.value = ''
        void refresh()
      })
  }

  return (
    <>
      <SettingRow
        label={t('settings.index.transcription')}
        hint={
          <>
            {!supported
              ? t('transcription.unsupported')
              : transcriptionNeedsTab()
                ? `${t('settings.index.transcription.hint')} ${t('transcription.firefox')}`
                : t('settings.index.transcription.hint')}{' '}
            <HelpLink topic="sprachnachrichten" />
          </>
        }
        control={null}
      />
      {supported &&
        KEYS.map((key) => {
          const fraction = progress[key]
          const here = installed?.includes(key) ?? false
          return (
            <SettingRow
              key={key}
              label={t(`transcription.model.${key}` as StringKey)}
              hint={t(`transcription.model.${key}.hint` as StringKey, {
                size: bytes(MODELS[key].bytes),
              })}
              control={
                fraction !== undefined ? (
                  <span className="inline-flex items-center gap-2 text-xs tabular-nums text-wa-muted">
                    <Spinner />
                    {`${String(Math.round(fraction * 100))} %`}
                  </span>
                ) : here ? (
                  <span className="inline-flex items-center gap-2">
                    <span className="text-xs text-wa-accent">{t('transcription.ready')}</span>
                    <Button
                      variant="ghost"
                      onClick={() => {
                        remove(key)
                      }}
                    >
                      {t('transcription.remove')}
                    </Button>
                  </span>
                ) : (
                  <Button
                    onClick={() => {
                      download(key)
                    }}
                    disabled={installed === undefined}
                  >
                    {t('transcription.download')}
                  </Button>
                )
              }
            />
          )
        })}
      {supported && (
        <SettingRow
          label={t('transcription.language')}
          hint={
            settings.transcriptionLanguage === 'auto'
              ? t('transcription.language.auto.hint')
              : undefined
          }
          control={
            <select
              aria-label={t('transcription.language')}
              value={settings.transcriptionLanguage}
              onChange={(event) => {
                patch({
                  transcriptionLanguage: event.target.value as Settings['transcriptionLanguage'],
                })
              }}
              className="rounded-lg bg-wa-raised px-2 py-1 text-[13px]"
            >
              {TRANSCRIPTION_LANGUAGES.map((code) => (
                <option key={code} value={code}>
                  {t(`transcription.language.${code}` as StringKey)}
                </option>
              ))}
            </select>
          }
        />
      )}
      {supported && (
        <SettingRow
          label={t('transcription.fromFile')}
          hint={message ?? t('transcription.fromFile.hint')}
          control={
            <>
              <input
                ref={input}
                type="file"
                accept=".bin"
                aria-label={t('transcription.fromFile')}
                className="hidden"
                onChange={(event) => {
                  pick(event.target.files?.[0])
                }}
              />
              <Button
                variant="ghost"
                disabled={checking}
                onClick={() => {
                  input.current?.click()
                }}
              >
                {checking ? <Spinner /> : null}
                {checking ? t('transcription.checking') : t('transcription.fromFile.pick')}
              </Button>
            </>
          }
        />
      )}
    </>
  )
}
