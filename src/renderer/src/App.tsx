import { useEffect, useState } from 'react'
import { t } from './i18n'

interface Versions {
  app: string
  electron: string
  chrome: string
  node: string
}

interface WorkerHealth {
  archive: boolean
  contentIndex: boolean
}

declare global {
  interface Window {
    watis: {
      getVersions(): Promise<Versions>
      getWorkerHealth(): Promise<WorkerHealth>
      getPaths(): Promise<Record<string, string>>
    }
  }
}

function HealthDot({ ok }: { ok: boolean }): React.JSX.Element {
  return (
    <span
      className={`inline-block h-2 w-2 rounded-full ${ok ? 'bg-wa-accent' : 'bg-red-500'}`}
      aria-hidden="true"
    />
  )
}

export function App(): React.JSX.Element {
  const [versions, setVersions] = useState<Versions | undefined>(undefined)
  const [health, setHealth] = useState<WorkerHealth | undefined>(undefined)
  const [paths, setPaths] = useState<Record<string, string> | undefined>(undefined)

  useEffect(() => {
    void window.watis.getVersions().then(setVersions)
    void window.watis.getPaths().then(setPaths)
    const poll = (): void => {
      void window.watis.getWorkerHealth().then(setHealth)
    }
    poll()
    const timer = setInterval(poll, 2000)
    return () => {
      clearInterval(timer)
    }
  }, [])

  return (
    <div className="min-h-screen bg-wa-panel p-5 text-sm text-slate-200">
      <h1 className="mb-4 text-base font-semibold">{t('app.title')}</h1>

      <p className="mb-5 rounded bg-wa-surface p-3 text-xs leading-relaxed text-slate-400">
        {t('phase.notice')}
      </p>

      <section className="mb-5">
        <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">
          {t('status.heading')}
        </h2>
        <ul className="space-y-1">
          <li className="flex items-center gap-2">
            <HealthDot ok={health?.archive ?? false} />
            {t('status.worker.archive')}
            <span className="text-slate-500">
              {health?.archive ? t('status.worker.running') : t('status.worker.down')}
            </span>
          </li>
          <li className="flex items-center gap-2">
            <HealthDot ok={health?.contentIndex ?? false} />
            {t('status.worker.contentIndex')}
            <span className="text-slate-500">
              {health?.contentIndex ? t('status.worker.running') : t('status.worker.down')}
            </span>
          </li>
        </ul>
      </section>

      {versions && (
        <section className="mb-5">
          <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">
            {t('status.versions')}
          </h2>
          <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs text-slate-400">
            {Object.entries(versions).map(([key, value]) => (
              <div key={key} className="contents">
                <dt>{key}</dt>
                <dd className="font-mono text-slate-300">{value}</dd>
              </div>
            ))}
          </dl>
        </section>
      )}

      {paths && (
        <section>
          <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">
            {t('status.paths')}
          </h2>
          <dl className="space-y-1 text-xs text-slate-400">
            {Object.entries(paths).map(([key, value]) => (
              <div key={key}>
                <dt>{key}</dt>
                <dd className="truncate font-mono text-slate-300" title={value}>
                  {value}
                </dd>
              </div>
            ))}
          </dl>
        </section>
      )}
    </div>
  )
}
