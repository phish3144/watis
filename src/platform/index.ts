import type { BaseWindow, NativeImage } from 'electron'

/**
 * Everything OS-specific goes through here. Feature code must never call a Windows or macOS API
 * directly — see CLAUDE.md, "Plattformabstraktion". Every Windows implementation ships with a
 * macOS implementation or a documented stub in the same commit.
 */
export interface Platform {
  readonly id: 'win32' | 'darwin' | 'linux' | 'unsupported'

  /** Unread count in the taskbar/dock. Windows has no app.setBadgeCount — it is a silent no-op
   *  there — so this branches internally rather than at the call site. The window is required
   *  because Windows paints the count as a taskbar overlay icon on a specific window. */
  setUnreadBadge(count: number, window: BaseWindow): void

  /** Launch at login, optionally minimised to tray. */
  setAutostart(options: { enabled: boolean; minimised: boolean }): void
  isAutostartEnabled(): boolean

  /** Reveal a file in Explorer / Finder. */
  showItemInFolder(absolutePath: string): void

  /** Absolute path of a bundled sidecar binary, in dev and when packaged. */
  sidecarPath(binaryName: string): string

  /** Register as handler for whatsapp:// and wa.me links. Per-user only, never HKLM. */
  registerProtocolHandler(scheme: string): boolean

  /** True when the machine is on mains power — the content index only runs on AC. */
  isOnAcPower(): Promise<boolean>

  /** Tray icon for this platform: .ico on Windows, template PNG on macOS, PNG on Linux. */
  trayIcon(): NativeImage

  /**
   * Whether a tray icon will actually be visible to the user.
   *
   * Windows and macOS: always. Linux: not necessarily. GNOME removed support for legacy tray
   * icons, and Electron's Tray becomes a StatusNotifierItem that simply has nobody listening —
   * the constructor succeeds, the icon is not empty, and nothing appears. The existing
   * `icon.isEmpty()` guard cannot see that.
   *
   * It matters because of close-to-tray: hiding the window into a tray that does not exist
   * takes the application away with no way back. Anything that would strand the user behind an
   * invisible tray asks here first.
   */
  trayIsReliable(): boolean
}

export type { BaseWindow, NativeImage }
