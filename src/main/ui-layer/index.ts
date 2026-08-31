import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { WebContents } from 'electron'
import type { Settings } from '@shared/settings'
import { appPaths } from '../paths'
import { log } from '../logging'
import { buildCss } from './css'

/**
 * Applies the CSS layer to the WhatsApp view.
 *
 * insertCSS survives WhatsApp's SPA route changes but NOT a document load, so this has to be
 * re-applied on every did-finish-load. Measured on Electron 44.
 *
 * cssOrigin stays at the default 'author': removeInsertedCSS does not remove a sheet inserted
 * with cssOrigin 'user', which would make the switches one-way.
 */
export class UiLayer {
  private key: string | undefined
  private userCssKey: string | undefined

  constructor(private readonly contents: () => WebContents | undefined) {}

  async apply(config: Settings): Promise<void> {
    const contents = this.contents()
    if (!contents || contents.isDestroyed()) return

    try {
      if (this.key) {
        await contents.removeInsertedCSS(this.key)
        this.key = undefined
      }
      const css = buildCss(config)
      if (css.trim()) this.key = await contents.insertCSS(css)
    } catch (error: unknown) {
      log.warn(`could not apply ui layer: ${String(error)}`)
    }

    await this.applyUserCss(config)
    contents.send('wa:set-enter-newline', config.enterInsertsNewline)
    contents.send('wa:set-audio-sink', config.audioOutputDeviceId)
  }

  /** %LOCALAPPDATA%\watis\user.css — the user's own escape hatch. */
  private async applyUserCss(config: Settings): Promise<void> {
    const contents = this.contents()
    if (!contents || contents.isDestroyed()) return
    try {
      if (this.userCssKey) {
        await contents.removeInsertedCSS(this.userCssKey)
        this.userCssKey = undefined
      }
      if (!config.customCssEnabled) return
      const css = await readFile(join(appPaths().root, 'user.css'), 'utf8')
      if (css.trim()) this.userCssKey = await contents.insertCSS(css)
    } catch (error: unknown) {
      // A missing user.css is the normal case, not an error worth shouting about.
      log.debug(`no user css applied: ${String(error)}`)
    }
  }
}
