import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto'
import { readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { appPaths } from '../paths'
import { log } from '../logging'

/**
 * The app lock (PLAN.md Phase 8): a PIN in front of the window, and a blur when it loses focus.
 *
 * What this is and is not, stated plainly, because getting it wrong would be worse than not having
 * it at all: **this is a screen, not encryption.** The archive stays on disk exactly as before,
 * readable by anything running as this user. It guards against the person walking past the desk —
 * the actual threat in an office — and against nothing else. Real protection is the operating
 * system's disk encryption, which the README already says to turn on.
 *
 * The PIN is nevertheless stored as a scrypt hash rather than in the clear. Not because the stored
 * form protects the archive — it does not — but because people reuse PINs, and leaving somebody's
 * banking PIN in a JSON file next to their messages would be its own small harm.
 */

const KEY_BYTES = 32
/**
 * Deliberately slow: a four-digit PIN has ten thousand possibilities, so the work factor is the
 * only guard there is. N = 2^15 with the default r = 8 needs 32 MiB, which is exactly Node's
 * default ceiling — hence the explicit `maxmem`. One definition, used by both hashing paths, so
 * they cannot drift apart and leave a stored hash nothing can reproduce.
 */
const SCRYPT = { N: 2 ** 15, maxmem: 64 * 1024 * 1024 } as const

interface LockFile {
  salt: string
  hash: string
  /** Lock again after this many idle seconds. 0 means: only at start. */
  idleSeconds: number
}

export interface LockState {
  configured: boolean
  locked: boolean
  idleSeconds: number
}

function lockFile(): string {
  return join(appPaths().root, 'lock.json')
}

export class AppLock {
  #file: LockFile | undefined
  #locked = false

  async load(): Promise<void> {
    try {
      const parsed = JSON.parse(await readFile(lockFile(), 'utf8')) as LockFile
      if (typeof parsed?.hash !== 'string' || typeof parsed.salt !== 'string') {
        throw new Error('lock file is not usable')
      }
      this.#file = parsed
      // A configured lock starts locked. Anything else would be a lock that works only when the
      // machine happened to have been idle.
      this.#locked = true
    } catch {
      this.#file = undefined
      this.#locked = false
    }
  }

  state(): LockState {
    return {
      configured: this.#file !== undefined,
      locked: this.#locked,
      idleSeconds: this.#file?.idleSeconds ?? 0,
    }
  }

  get isLocked(): boolean {
    return this.#file !== undefined && this.#locked
  }

  /** Sets or clears the PIN. An empty PIN removes the lock. */
  async configure(pin: string, idleSeconds: number): Promise<LockState> {
    if (pin === '') {
      this.#file = undefined
      this.#locked = false
      await rm(lockFile(), { force: true })
      log.info('app lock removed')
      return this.state()
    }

    const salt = randomBytes(16)
    const hash = scryptSync(pin, salt, KEY_BYTES, SCRYPT)
    this.#file = {
      salt: salt.toString('hex'),
      hash: hash.toString('hex'),
      idleSeconds: Math.max(0, Math.min(idleSeconds, 24 * 3600)),
    }
    this.#locked = false
    await writeFile(lockFile(), JSON.stringify(this.#file), 'utf8')
    log.info('app lock set')
    return this.state()
  }

  /** Compared in constant time, so a wrong PIN takes exactly as long as a right one. */
  unlock(pin: string): boolean {
    const file = this.#file
    if (!file) return true
    const attempt = scryptSync(pin, Buffer.from(file.salt, 'hex'), KEY_BYTES, SCRYPT)
    const stored = Buffer.from(file.hash, 'hex')
    const ok = attempt.length === stored.length && timingSafeEqual(attempt, stored)
    if (ok) this.#locked = false
    else log.warn('app lock: wrong PIN')
    return ok
  }

  lock(): void {
    if (this.#file) this.#locked = true
  }

  /** Called by the idle poll in main. True when this call is what locked it. */
  lockIfIdle(idleSeconds: number): boolean {
    const limit = this.#file?.idleSeconds ?? 0
    if (!this.#file || limit === 0 || this.#locked) return false
    if (idleSeconds < limit) return false
    this.#locked = true
    log.info('app lock: locked after idle')
    return true
  }
}
