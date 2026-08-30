import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { APP_ID, APP_SLUG, DISPLAY_NAME, PRODUCT_NAME } from '../../src/shared/app-identity'

const PATH_HOSTILE = /[<>:"/\\|?*]/

describe('application identity', () => {
  it('keeps the question mark out of every path-bound name', () => {
    // `?` is illegal in Windows paths, registry keys and artefact names. Only the display name
    // may carry it.
    expect(APP_SLUG).not.toMatch(PATH_HOSTILE)
    expect(PRODUCT_NAME).not.toMatch(PATH_HOSTILE)
    expect(APP_ID).not.toMatch(PATH_HOSTILE)
    expect(DISPLAY_NAME).toContain('?')
  })

  it('matches the appId and productName the installer will use', () => {
    // A mismatch between these makes Windows toasts fail silently and never reproduces in dev,
    // so it is asserted rather than trusted.
    const builder = readFileSync('electron-builder.yml', 'utf8')
    expect(builder).toContain(`appId: ${APP_ID}`)
    expect(builder).toContain(`productName: ${PRODUCT_NAME}`)
  })

  it('matches the package name', () => {
    const pkg = JSON.parse(readFileSync('package.json', 'utf8')) as { name: string }
    expect(pkg.name).toBe(APP_SLUG)
  })
})
