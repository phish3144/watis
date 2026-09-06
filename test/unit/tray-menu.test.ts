import { beforeEach, describe, expect, it, vi } from 'vitest'

interface MenuItem {
  label?: string
  type?: string
  checked?: boolean
  accelerator?: string
  click?: (item: { checked: boolean }) => void
}

let template: MenuItem[] = []

vi.mock('electron', () => ({
  Menu: {
    buildFromTemplate: (items: MenuItem[]) => {
      template = items
      return { items }
    },
  },
  Tray: class {
    setToolTip = vi.fn()
    setContextMenu = vi.fn()
    setImage = vi.fn()
    on = vi.fn()
    destroy = vi.fn()
  },
  app: { getVersion: () => '0.1.0' },
  nativeImage: { createEmpty: () => ({ isEmpty: () => true }) },
}))
vi.mock('../../src/main/config/store', () => ({
  settings: () => ({ dndEnabled: false, indexPaused: false, autostart: false }),
  updateSettings: vi.fn(),
}))
vi.mock('../../src/main/logging', () => ({
  log: { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))
vi.mock('@platform/current', () => ({
  platform: () => ({ trayIcon: () => ({ isEmpty: () => true }), setUnreadBadge: vi.fn() }),
}))

const { TrayController } = await import('../../src/main/tray')

describe('the tray menu', () => {
  let toggled: number
  let shown: number

  beforeEach(() => {
    template = []
    toggled = 0
    shown = 0
    const controller = new TrayController({
      window: () => undefined,
      showWindow: () => {
        shown++
      },
      togglePanel: () => {
        toggled++
      },
      isPaused: () => false,
      setPaused: vi.fn(),
      quit: vi.fn(),
    })
    ;(controller as unknown as { tray: unknown }).tray = { setContextMenu: vi.fn() }
    controller.rebuildMenu()
  })

  it('offers a way to the panel', () => {
    // Without this entry the panel — and with it every feature this application adds — was
    // reachable only through a keyboard shortcut that nothing documented.
    const entry = template.find((item) => item.label === 'Archiv und Einstellungen')
    expect(entry).toBeDefined()
    expect(entry?.accelerator).toBe('CommandOrControl+,')
  })

  it('shows the window before toggling, so the panel is not opened out of sight', () => {
    template.find((item) => item.label === 'Archiv und Einstellungen')?.click?.({ checked: false })
    expect(shown).toBe(1)
    expect(toggled).toBe(1)
  })

  it('keeps the panel entry near the top, above the switches', () => {
    // A menu people open to reach one thing should not make them read past four checkboxes first.
    const panel = template.findIndex((item) => item.label === 'Archiv und Einstellungen')
    const firstCheckbox = template.findIndex((item) => item.type === 'checkbox')
    expect(panel).toBeGreaterThan(-1)
    expect(panel).toBeLessThan(firstCheckbox)
  })
})
