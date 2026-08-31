import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test, expect, _electron as electron, type ElectronApplication } from '@playwright/test'

/**
 * The performance profile (PLAN.md Phase 9): what the application costs at rest and under load.
 *
 * The absolute numbers depend on the machine and are not the point. What this pins down is the
 * shape: an idle client must cost almost nothing, because it runs all day beside everything else,
 * and importing must not make the main process grow — the archive lives in a worker precisely so
 * that it does not.
 *
 * The measurements are written to performance-profile.json so a release note can point at a run.
 */

let app: ElectronApplication
let dataDir: string

interface ProcessMetric {
  type: string
  memoryWorkingSetKb: number
  cpuPercent: number
}

async function metrics(): Promise<ProcessMetric[]> {
  return app.evaluate(({ app: electronApp }) =>
    electronApp.getAppMetrics().map((m) => ({
      type: m.type,
      memoryWorkingSetKb: m.memory.workingSetSize,
      cpuPercent: m.cpu.percentCPUUsage,
    })),
  )
}

/**
 * Grouped by process type rather than summed.
 *
 * Summing working-set sizes across Chromium processes double-counts badly: every process maps the
 * same framework and the same shared libraries, and the working set counts those pages in each one.
 * A "total RSS" built that way is not a number anybody can act on, so the profile reports the parts
 * and the gates apply to the parts we actually control.
 */
function byType(all: ProcessMetric[]): Record<string, number> {
  const grouped: Record<string, number> = {}
  for (const m of all) {
    grouped[m.type] = (grouped[m.type] ?? 0) + m.memoryWorkingSetKb / 1024
  }
  for (const key of Object.keys(grouped)) grouped[key] = Number((grouped[key] ?? 0).toFixed(1))
  return grouped
}

async function archive<T>(request: unknown): Promise<T> {
  return app.evaluate(({ ipcMain }, payload) => {
    const handlers = (
      ipcMain as unknown as { _invokeHandlers: Map<string, (e: unknown, a: unknown) => unknown> }
    )._invokeHandlers
    const handler = handlers.get('archive:request')
    if (!handler) throw new Error('archive:request handler is not registered')
    return handler({}, payload)
  }, request) as Promise<T>
}

test.beforeAll(async () => {
  dataDir = mkdtempSync(join(tmpdir(), 'watis-e2e-perf-'))
  app = await electron.launch({
    args: ['.', '--no-sandbox'],
    env: { ...process.env, LOCALAPPDATA: dataDir, XDG_DATA_HOME: dataDir, NODE_ENV: 'test' },
  })
  const deadline = Date.now() + 20_000
  for (;;) {
    try {
      await archive({ op: 'stats' })
      break
    } catch (error) {
      if (Date.now() > deadline) throw error
      await new Promise((r) => setTimeout(r, 250))
    }
  }
})

test.afterAll(async () => {
  await app?.close()
  if (dataDir && existsSync(dataDir)) rmSync(dataDir, { recursive: true, force: true })
})

test('costs little at rest and does not grow the main process under load', async () => {
  test.setTimeout(180_000)

  // Settle: startup work is not idle cost, and measuring it as such would flatter nothing useful.
  await new Promise((r) => setTimeout(r, 3000))
  const idle = await metrics()
  const idleByType = byType(idle)
  const mainIdle = idle.find((m) => m.type === 'Browser')

  // --- load: 50 000 messages through the real channel, in the real batch size -----------------
  const BATCH = 500
  const ROUNDS = 100
  const started = Date.now()
  for (let round = 0; round < ROUNDS; round++) {
    const messages = Array.from({ length: BATCH }, (_, i) => {
      const n = round * BATCH + i
      return {
        id: `m${n}`,
        chatId: `c${n % 50}`,
        ts: 1_600_000_000 + n,
        body: `Rechnung ${String(n)} für München mit Grüßen`,
      }
    })
    await archive({ op: 'import', messages })
  }
  const importSeconds = (Date.now() - started) / 1000

  const busy = await metrics()
  const busyByType = byType(busy)
  const mainBusy = busy.find((m) => m.type === 'Browser')

  const stats = await archive<{ messages: number }>({ op: 'stats' })
  expect(stats.messages).toBe(BATCH * ROUNDS)

  const mainIdleMiB = (mainIdle?.memoryWorkingSetKb ?? 0) / 1024
  const mainBusyMiB = (mainBusy?.memoryWorkingSetKb ?? 0) / 1024

  const profile = {
    ranAt: new Date().toISOString(),
    platform: process.platform,
    note: 'Working sets per process type. They are NOT summed: every Chromium process maps the same framework, so a sum counts those pages several times over.',
    processes: idle.length,
    idle: { mainRssMiB: Number(mainIdleMiB.toFixed(1)), byTypeMiB: idleByType },
    underLoad: {
      mainRssMiB: Number(mainBusyMiB.toFixed(1)),
      byTypeMiB: busyByType,
      messagesImported: BATCH * ROUNDS,
      importSeconds: Number(importSeconds.toFixed(1)),
      rowsPerSecond: Math.round((BATCH * ROUNDS) / importSeconds),
    },
  }
  writeFileSync('performance-profile.json', JSON.stringify(profile, null, 2))
  console.log(JSON.stringify(profile, null, 2))

  // The one property worth gating: the main process holds no database handle and buffers nothing
  // per message, so importing fifty thousand rows must barely move it. The allowance is generous
  // because it only has to catch the failure that matters — main starting to accumulate.
  expect(mainBusyMiB - mainIdleMiB).toBeLessThan(80)

  // And main itself stays modest at rest. Not a total: see the note above.
  expect(mainIdleMiB).toBeLessThan(400)
})
