import { useEffect, useState } from 'react'
import { t } from '../i18n'

/**
 * Picks the output device for voice messages and videos (PLAN.md Phase 1).
 *
 * The device list has to be read in a renderer — `enumerateDevices` is a web API and the main
 * process has no equivalent. Before permission is granted the browser returns entries with empty
 * labels; rather than showing a list of blanks, this asks for microphone permission once, which is
 * what makes the labels appear. Declining leaves the system default, which is a working outcome.
 */
export function AudioOutputPicker({
  value,
  onChange,
}: {
  value: string
  onChange: (deviceId: string) => void
}): React.JSX.Element {
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([])
  const [needsPermission, setNeedsPermission] = useState(false)

  const load = (): void => {
    void navigator.mediaDevices
      .enumerateDevices()
      .then((all) => {
        const outputs = all.filter((d) => d.kind === 'audiooutput')
        setDevices(outputs)
        setNeedsPermission(outputs.length > 0 && outputs.every((d) => d.label === ''))
      })
      .catch(() => {
        setDevices([])
      })
  }

  useEffect(load, [])

  if (needsPermission) {
    return (
      <button
        type="button"
        onClick={() => {
          void navigator.mediaDevices
            .getUserMedia({ audio: true })
            .then((stream) => {
              // The stream was only ever needed to unlock the labels.
              for (const track of stream.getTracks()) track.stop()
              load()
            })
            .catch(() => {
              setNeedsPermission(false)
            })
        }}
        className="rounded-md border border-wa-hairline px-2 py-1 text-xs"
      >
        Geräte anzeigen
      </button>
    )
  }

  return (
    <select
      aria-label={t('media.audioOut')}
      value={value}
      onChange={(e) => {
        onChange(e.target.value)
      }}
      className="w-52 rounded-md border border-wa-hairline bg-transparent px-2 py-1 text-xs"
    >
      <option value="">{t('media.audioOut.default')}</option>
      {devices
        .filter((d) => d.deviceId !== 'default' && d.deviceId !== '')
        .map((d) => (
          <option key={d.deviceId} value={d.deviceId}>
            {d.label || d.deviceId.slice(0, 12)}
          </option>
        ))}
    </select>
  )
}
