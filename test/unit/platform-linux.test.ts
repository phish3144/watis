import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({
  app: { setBadgeCount: vi.fn(), setAsDefaultProtocolClient: vi.fn(() => true) },
  nativeImage: { createFromPath: vi.fn(() => ({ isEmpty: () => false })) },
  shell: { showItemInFolder: vi.fn() },
}))
vi.mock('../../src/main/logging', () => ({
  log: { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))
vi.mock('../../src/main/resources', () => ({
  resourcePath: (...parts: string[]) => `/res/${parts.join('/')}`,
}))

const { desktopEntry, trayIsReliableHere, executablePath } =
  await import('../../src/platform/linux')

describe('the desktop entry', () => {
  it('points at the AppImage, not at the binary inside it', () => {
    // process.execPath inside an AppImage is an unpacked file in a temporary mount that is gone
    // by the next login. An autostart entry written against it launches nothing.
    const before = process.env.APPIMAGE
    process.env.APPIMAGE = '/home/someone/Applications/WatIs-x86_64.AppImage'
    try {
      expect(executablePath()).toBe('/home/someone/Applications/WatIs-x86_64.AppImage')
      expect(desktopEntry({ minimised: false, forAutostart: true })).toContain(
        'Exec="/home/someone/Applications/WatIs-x86_64.AppImage"',
      )
    } finally {
      if (before === undefined) delete process.env.APPIMAGE
      else process.env.APPIMAGE = before
    }
  })

  it('carries the minimised flag through to autostart', () => {
    expect(desktopEntry({ minimised: true, forAutostart: true })).toMatch(/Exec=.* --minimised/)
    expect(desktopEntry({ minimised: false, forAutostart: true })).not.toContain('--minimised')
  })

  it('marks only the autostart copy as an autostart entry', () => {
    expect(desktopEntry({ minimised: false, forAutostart: true })).toContain(
      'X-GNOME-Autostart-enabled=true',
    )
    expect(desktopEntry({ minimised: false, forAutostart: false })).not.toContain('Autostart')
  })

  it('never puts the question mark in the name', () => {
    // CLAUDE.md: the display name carries a `?`, and a desktop entry is the Linux counterpart of
    // the Start Menu entry, which uses the path-safe product name.
    const entry = desktopEntry({ minimised: false, forAutostart: false })
    expect(entry).toContain('Name=WatIs\n')
    expect(entry).not.toContain('WatIs?')
  })

  it('declares the window class the launcher needs to match', () => {
    // Without it the desktop cannot link the running window to the entry, and the dock shows a
    // generic icon beside a correctly installed launcher.
    expect(desktopEntry({ minimised: false, forAutostart: false })).toContain(
      'StartupWMClass=watis',
    )
  })
})

describe('whether a tray icon will be seen', () => {
  /**
   * GNOME has not shown legacy tray icons since 3.26. Electron's Tray still constructs
   * successfully with nobody listening, so the icon is not empty and the tray controller's
   * `icon.isEmpty()` guard sees nothing wrong — and close-to-tray then hides the window into
   * something invisible, with no way back.
   */
  it('assumes no tray under GNOME', () => {
    expect(trayIsReliableHere({ XDG_CURRENT_DESKTOP: 'GNOME' })).toBe(false)
    expect(trayIsReliableHere({ XDG_CURRENT_DESKTOP: 'ubuntu:GNOME' })).toBe(false)
    expect(trayIsReliableHere({ DESKTOP_SESSION: 'gnome' })).toBe(false)
    expect(trayIsReliableHere({ XDG_CURRENT_DESKTOP: 'Unity' })).toBe(false)
  })

  it('trusts the desktops that kept a tray', () => {
    expect(trayIsReliableHere({ XDG_CURRENT_DESKTOP: 'KDE' })).toBe(true)
    expect(trayIsReliableHere({ XDG_CURRENT_DESKTOP: 'XFCE' })).toBe(true)
    expect(trayIsReliableHere({ XDG_CURRENT_DESKTOP: 'MATE' })).toBe(true)
    expect(trayIsReliableHere({ XDG_CURRENT_DESKTOP: 'Cinnamon' })).toBe(true)
  })

  it('can be overridden by somebody who installed the extension', () => {
    expect(trayIsReliableHere({ XDG_CURRENT_DESKTOP: 'GNOME', WATIS_FORCE_TRAY: '1' })).toBe(true)
  })

  it('fails towards no tray when it cannot tell', () => {
    // Being wrong here costs a checkbox; being wrong the other way costs the window.
    expect(trayIsReliableHere({})).toBe(false)
  })
})
