/**
 * Resolving WhatsApp Web's internal modules (PLAN.md §5.5).
 *
 * WA Web no longer uses webpack. It uses Meta's own loader, whose IIFE is called with the global
 * object and assigns `require`, `requireLazy` and `__d` onto it — so `window.require` is a real page
 * global and the old webpackChunk push trick is neither needed nor available.
 *
 * Verified against the live bundle; the module names and their shapes are recorded in
 * `docs/bridge-map.md` together with the WA Web version they were checked on.
 */

export interface PageGlobals {
  require?: (name: string) => unknown
  __d?: unknown
}

/** What a module must look like for us to accept it. Missing a field means the bundle moved. */
export interface ModuleSignature {
  readonly module: string
  /** Property path inside the module's export; empty means the export itself. */
  readonly path?: readonly string[]
  /** Names that must exist and be callable. */
  readonly functions?: readonly string[]
  /** Names that must merely exist. */
  readonly fields?: readonly string[]
}

export interface ResolvedModule {
  signature: ModuleSignature
  value: unknown
}

export interface ResolveFailure {
  signature: ModuleSignature
  reason: 'no-require' | 'not-registered' | 'threw' | 'missing-members'
  detail?: string | undefined
}

export interface HealthReport {
  ok: boolean
  /** The WA Web build, so a failure can be attributed to a version rather than to chance. */
  version?: string | undefined
  resolved: ResolvedModule[]
  failures: ResolveFailure[]
}

/**
 * `require` throws synchronously for a module that is not registered — it does not lazily load and
 * it does not return undefined. Calling it blind would therefore throw inside a WhatsApp stack
 * frame, so every lookup is wrapped and the debug map is consulted first where available.
 */
export function resolveModule(
  globals: PageGlobals,
  signature: ModuleSignature,
): ResolvedModule | ResolveFailure {
  const req = globals.require
  if (typeof req !== 'function') return { signature, reason: 'no-require' }

  let value: unknown
  try {
    value = req(signature.module)
  } catch (error) {
    const message = String(error)
    return {
      signature,
      reason: /unknown module/i.test(message) ? 'not-registered' : 'threw',
      detail: message,
    }
  }

  for (const key of signature.path ?? []) {
    if (value === null || typeof value !== 'object' || !(key in value)) {
      return { signature, reason: 'missing-members', detail: `path stopped at ${key}` }
    }
    value = (value as Record<string, unknown>)[key]
  }

  const missing = membersMissingFrom(value, signature)
  if (missing.length > 0) {
    return { signature, reason: 'missing-members', detail: missing.join(', ') }
  }

  return { signature, value }
}

function membersMissingFrom(value: unknown, signature: ModuleSignature): string[] {
  const missing: string[] = []
  const target = value as Record<string, unknown> | null | undefined
  if (target === null || target === undefined) {
    return [...(signature.functions ?? []), ...(signature.fields ?? [])]
  }
  for (const fn of signature.functions ?? []) {
    if (typeof target[fn] !== 'function') missing.push(`${fn}()`)
  }
  for (const field of signature.fields ?? []) {
    if (!(field in target)) missing.push(field)
  }
  return missing
}

export function isFailure(result: ResolvedModule | ResolveFailure): result is ResolveFailure {
  return 'reason' in result
}

/**
 * Resolves every signature and reports what worked. A partial failure is not fatal: the features
 * that depend on the missing module are switched off and the rest keeps running (§5.5).
 */
export function healthcheck(
  globals: PageGlobals,
  signatures: readonly ModuleSignature[],
  version?: string,
): HealthReport {
  const resolved: ResolvedModule[] = []
  const failures: ResolveFailure[] = []

  for (const signature of signatures) {
    const result = resolveModule(globals, signature)
    if (isFailure(result)) failures.push(result)
    else resolved.push(result)
  }

  return { ok: failures.length === 0, version, resolved, failures }
}

/** Which of the named modules resolved, so a caller can gate a feature on exactly what it needs. */
export function availability(report: HealthReport): Set<string> {
  return new Set(report.resolved.map((r) => r.signature.module))
}
