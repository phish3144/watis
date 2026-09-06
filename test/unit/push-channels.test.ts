import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * Every channel the main process PUSHES to the panel must also be readable on demand.
 *
 * This has now been the same bug twice. The health monitor learned about worker readiness only
 * from a poll, and the panel learned about the bridge only from an event that fires once, when it
 * resolves. A renderer that mounts its listener a moment too late — or remounts — never hears it
 * and sits on its initial guess forever. The visible result the first time was a status dot stuck
 * on red with "Mitschreiben startet …" beside it, over a bridge that was working perfectly, and a
 * disabled "Jetzt übernehmen" button that was the only way to fill the archive.
 *
 * A subscription reports CHANGES. It is not a way to learn the current state, and treating it as
 * one works right up until the timing shifts. So: every `ipcRenderer.on` gets a matching
 * `ipcRenderer.invoke` that answers "what is it right now", and this test is what makes adding a
 * push channel without one impossible to do by accident.
 */

const preload = readFileSync(join(__dirname, '..', '..', 'src', 'preload', 'app.ts'), 'utf8')
const main = readFileSync(join(__dirname, '..', '..', 'src', 'main', 'index.ts'), 'utf8')
const window = readFileSync(
  join(__dirname, '..', '..', 'src', 'main', 'window', 'main-window.ts'),
  'utf8',
)

/**
 * Push channel -> the invoke channel that reads the same state.
 *
 * Deliberately explicit rather than derived by a naming rule: the point is that somebody adding a
 * push channel has to stop and answer "and how does a late listener find this out?". A generated
 * mapping would let them skip that question, which is exactly how this got shipped twice.
 */
const READBACK: Record<string, string> = {
  'app:settings': 'app:settings',
  'app:accounts': 'app:accounts',
  'app:panel': 'app:panel-state',
  'app:update': 'app:update-state',
  'app:lock': 'app:lock-state',
  'app:backfill': 'backfill:state',
  'app:bridge': 'app:bridge-state',
  'app:health': 'app:health',
  'app:unread': 'app:unread-state',
}

function channels(source: string, kind: 'on' | 'invoke'): string[] {
  const pattern = new RegExp(`ipcRenderer\\.${kind}\\(\\s*'([^']+)'`, 'g')
  return [...source.matchAll(pattern)].flatMap((m) => (m[1] ? [m[1]] : [])).sort()
}

describe('every pushed state can also be asked for', () => {
  const pushed = channels(preload, 'on')

  it('finds the push channels it is meant to be checking', () => {
    // Guards the regexes themselves: if the preload is restructured so nothing matches, this test
    // would otherwise pass by examining an empty list.
    expect(pushed.length).toBeGreaterThanOrEqual(9)
  })

  it.each(pushed)('%s has an entry saying how to read it back', (channel) => {
    expect(
      READBACK[channel],
      `${channel} is pushed to the panel with no way to ask for its current value. A listener that ` +
        `mounts after the last push never learns it. Add an ipcMain.handle that returns the state ` +
        `now, expose it in the preload, and map it here.`,
    ).toBeDefined()
  })

  it.each(Object.entries(READBACK))('%s is readable through %s', (_channel, invoke) => {
    expect(channels(preload, 'invoke'), `the preload exposes no invoke for ${invoke}`).toContain(
      invoke,
    )
    expect(
      main.includes(`ipcMain.handle('${invoke}'`),
      `src/main/index.ts has no handler for ${invoke}`,
    ).toBe(true)
  })

  it('remembers the bridge report rather than only forwarding it', () => {
    // The specific regression: main used to send 'app:bridge' straight through from the pipeline
    // callback and keep nothing, so there was nothing for a handler to return.
    expect(main).toMatch(/bridgeReports\.set\(/)
    expect(main).toMatch(/ipcMain\.handle\('app:bridge-state'/)
  })

  it('pushes the panel state only after the panel can hear it, and can still be asked', () => {
    // Belt and braces: the send happens once loadOwnPanel resolves, which is earlier than the
    // renderer's effect runs. The getter is what actually closes that gap.
    expect(window).toMatch(/send\('app:panel'/)
    expect(main).toMatch(/ipcMain\.handle\('app:panel-state'/)
  })
})
