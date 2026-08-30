import log from 'electron-log/main'
import { appPaths } from './paths'

/**
 * Local logging only. No crash upload, no telemetry, no remote transport — see CLAUDE.md,
 * "Datenschutz und Netz".
 */
export function configureLogging(): void {
  const { logs } = appPaths()

  log.transports.file.resolvePathFn = (_vars, message) =>
    `${logs}/${message?.level === 'error' ? 'error' : 'main'}.log`
  log.transports.file.maxSize = 5 * 1024 * 1024
  log.transports.file.format = '[{y}-{m}-{d} {h}:{i}:{s}.{ms}] [{level}] {text}'
  log.transports.console.level = process.env.NODE_ENV === 'production' ? false : 'debug'

  log.errorHandler.startCatching({ showDialog: false })
  log.initialize()
}

export { log }
