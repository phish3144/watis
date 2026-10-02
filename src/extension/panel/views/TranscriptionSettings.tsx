import { t } from '../strings'
import { SettingRow } from '../ui'

/** Placeholder until the Whisper engine is wired in (see engines and ADR 0012). */
export function TranscriptionSettings(): React.JSX.Element {
  return (
    <SettingRow
      label={t('settings.index.transcription')}
      hint={t('settings.index.transcription.hint')}
      control={null}
    />
  )
}
