import { app } from 'electron'

/**
 * WhatsApp Web gates on browser version. The Electron token in the default UA is the giveaway,
 * so it is removed and the Chrome version is reduced to the frozen MAJOR.0.0.0 form real Chrome
 * sends.
 *
 * Deliberately NOT done: forging the Sec-CH-UA brand list or the OS. Overriding the UA does not
 * change client hints, so a faked OS is contradicted by Sec-CH-UA-Platform in the same request —
 * and forging brands is active fingerprint evasion, which does not belong in a read-only tool
 * and would raise exactly the account risk this project is trying to keep small.
 */
export function chromeUserAgent(defaultUserAgent: string): string {
  return defaultUserAgent
    .replace(/\sElectron\/\S+/, '')
    .replace(new RegExp(`\\s${app.getName()}\\/\\S+`, 'i'), '')
    .replace(/Chrome\/(\d+)\.\d+\.\d+\.\d+/, 'Chrome/$1.0.0.0')
    .trim()
}

export function applyUserAgent(): string {
  const ua = chromeUserAgent(app.userAgentFallback)
  app.userAgentFallback = ua
  return ua
}
