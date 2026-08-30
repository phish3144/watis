import { describe, expect, it } from 'vitest'
import {
  parseHostMessage,
  parseWorkerMessage,
  WORKER_NAMES,
} from '../../src/shared/ipc/worker-protocol'

describe('worker protocol', () => {
  it('accepts a well-formed ready message', () => {
    expect(parseWorkerMessage({ type: 'ready', worker: 'archive', pid: 42 })).toEqual({
      type: 'ready',
      worker: 'archive',
      pid: 42,
    })
  })

  it('accepts every declared worker name', () => {
    for (const worker of WORKER_NAMES) {
      expect(parseWorkerMessage({ type: 'ready', worker, pid: 1 })).toBeDefined()
    }
  })

  it('drops rather than throws on an unknown worker', () => {
    expect(parseWorkerMessage({ type: 'ready', worker: 'nope', pid: 1 })).toBeUndefined()
  })

  it('drops rather than throws on a malformed message', () => {
    for (const bad of [null, undefined, 42, 'ready', {}, { type: 'nope' }, { type: 'pong' }]) {
      expect(parseWorkerMessage(bad)).toBeUndefined()
    }
  })

  it('rejects a negative ping nonce', () => {
    expect(parseHostMessage({ type: 'ping', nonce: -1 })).toBeUndefined()
    expect(parseHostMessage({ type: 'ping', nonce: 0 })).toBeDefined()
  })

  it('caps log message length so a runaway worker cannot flood the host', () => {
    const long = { type: 'log', level: 'info', message: 'x'.repeat(4001) }
    expect(parseWorkerMessage(long)).toBeUndefined()
  })
})
