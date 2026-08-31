import { Menu, Tray, app, nativeImage } from 'electron'
import type { BaseWindow, NativeImage } from 'electron'
import { DISPLAY_NAME } from '@shared/app-identity'
import { settings, updateSettings } from '../config/store'
import { platform } from '@platform/current'
import { resourcePath } from '../resources'
import { log } from '../logging'

/**
 * Tray icon, unread badge and the menu that lets the app be driven while its window is hidden.
 *
 * Close-to-tray is what makes this usable as a day client: the window closes, the process keeps
 * running, notifications keep arriving.
 */

export interface TrayHost {
  window(): BaseWindow | undefined
  showWindow(): void
  togglePanel(): void
  isPaused(): boolean
  setPaused(paused: boolean): void
  quit(): void
}

export class TrayController {
  private tray: Tray | undefined
  private unread = 0
  private mutedUnread = 0

  constructor(private readonly host: TrayHost) {}

  start(): void {
    const icon = this.trayIcon()
    if (icon.isEmpty()) {
      log.warn('tray icon missing; tray disabled')
      return
    }
    this.tray = new Tray(icon)
    this.tray.setToolTip(DISPLAY_NAME)
    this.tray.on('click', () => {
      this.host.showWindow()
    })
    this.tray.on('double-click', () => {
      this.host.showWindow()
    })
    this.rebuildMenu()
  }

  private trayIcon(): NativeImage {
    if (process.platform === 'darwin') {
      const image = nativeImage.createFromPath(resourcePath('tray', 'trayTemplate.png'))
      image.setTemplateImage(true)
      return image
    }
    if (process.platform === 'win32') {
      return nativeImage.createFromPath(resourcePath('tray', 'tray.ico'))
    }
    return nativeImage.createFromPath(resourcePath('tray', 'tray-32.png'))
  }

  setUnread(unread: number, mutedUnread: number): void {
    if (unread === this.unread && mutedUnread === this.mutedUnread) return
    this.unread = unread
    this.mutedUnread = mutedUnread

    const total = unread + mutedUnread
    const tooltip =
      total === 0
        ? DISPLAY_NAME
        : mutedUnread > 0
          ? `${DISPLAY_NAME} – ${unread} ungelesen (${mutedUnread} stumm)`
          : `${DISPLAY_NAME} – ${unread} ungelesen`
    this.tray?.setToolTip(tooltip)

    const window = this.host.window()
    if (window) platform().setUnreadBadge(unread, window)
    this.rebuildMenu()
  }

  rebuildMenu(): void {
    if (!this.tray) return
    const config = settings()
    const paused = this.host.isPaused()

    this.tray.setContextMenu(
      Menu.buildFromTemplate([
        {
          label:
            this.unread > 0 ? `${this.unread} ungelesene Nachrichten` : 'Keine neuen Nachrichten',
          enabled: false,
        },
        { type: 'separator' },
        {
          label: `${DISPLAY_NAME} öffnen`,
          click: () => {
            this.host.showWindow()
          },
        },
        {
          label: 'Benachrichtigungen pausieren',
          type: 'checkbox',
          checked: paused,
          click: (item) => {
            this.host.setPaused(item.checked)
            this.rebuildMenu()
          },
        },
        {
          label: 'Inhaltsindex pausieren',
          type: 'checkbox',
          checked: config.indexPaused,
          click: (item) => {
            updateSettings({ indexPaused: item.checked })
            this.rebuildMenu()
          },
        },
        {
          label: 'Ruhezeit aktiv',
          type: 'checkbox',
          checked: config.dndEnabled,
          click: (item) => {
            updateSettings({ dndEnabled: item.checked })
            this.rebuildMenu()
          },
        },
        { type: 'separator' },
        {
          label: 'Beim Anmelden starten',
          type: 'checkbox',
          checked: config.autostart,
          click: (item) => {
            updateSettings({ autostart: item.checked })
            platform().setAutostart({ enabled: item.checked, minimised: settings().startMinimised })
            this.rebuildMenu()
          },
        },
        { type: 'separator' },
        { label: `Version ${app.getVersion()}`, enabled: false },
        {
          label: 'Beenden',
          click: () => {
            this.host.quit()
          },
        },
      ]),
    )
  }

  dispose(): void {
    this.tray?.destroy()
    this.tray = undefined
  }
}
