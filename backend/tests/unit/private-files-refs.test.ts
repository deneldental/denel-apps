/**
 * Private file references: what private uploads store instead of a link.
 * The tag proves the backend issued a reference; nothing else may mint one.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'

const testEnv = vi.hoisted(() => {
  const initial = {
    BETTER_AUTH_SECRET: 'test-secret-that-is-at-least-32-characters-!!',
    PRIVATE_FILE_REF_SECRET: 'test-file-ref-secret-at-least-32-characters',
  }
  return { initial, current: { ...initial } as Record<string, string | undefined> }
})

vi.mock('../../src/config/env', () => ({
  env: new Proxy({}, { get: (_t, prop: string) => testEnv.current[prop] }),
}))

afterEach(() => {
  testEnv.current = { ...testEnv.initial }
})

import {
  findPrivateRefs,
  makePrivateRef,
  parsePrivateRef,
  replacePrivateRefs,
} from '../../src/lib/private-files'

const TRICKY_KEY = "patients/p 1/Ama's x-ray (1) ü.jpg"

describe('private file references', () => {
  it('round-trips a key with spaces, apostrophes, brackets and accents', () => {
    const ref = makePrivateRef('r2', TRICKY_KEY)

    expect(findPrivateRefs(ref)).toEqual([
      { raw: ref, ref: { provider: 'r2', key: TRICKY_KEY }, tagValid: true },
    ])
  })

  it('contains no quote, bracket or space, so it is safe inside HTML and JSON', () => {
    expect(makePrivateRef('r2', TRICKY_KEY)).toMatch(
      /^private-file:\/\/r2\/[A-Za-z0-9._~%/-]+#[0-9a-f]{16}$/
    )
  })

  it('marks a reference whose key was altered as untrusted', () => {
    const tampered = makePrivateRef('r2', 'patients/a/scan.jpg').replace('scan', 'scam')

    expect(findPrivateRefs(tampered)[0].tagValid).toBe(false)
  })

  it('does not let a tag move between providers', () => {
    const moved = makePrivateRef('r2', 'a/b.jpg').replace('://r2/', '://do_spaces/')

    expect(findPrivateRefs(moved)[0].tagValid).toBe(false)
  })

  it('finds references inside JSON-encoded HTML', () => {
    const ref = makePrivateRef('r2', 'memos/2026/diagram.png')
    const json = JSON.stringify({ html: `<p>See</p><img src="${ref}">` })

    expect(findPrivateRefs(json).map((f) => f.ref.key)).toEqual(['memos/2026/diagram.png'])
  })

  it('parses a stored value only when it is exactly one reference', () => {
    const ref = makePrivateRef('do_spaces', 'staff/cv.pdf')

    expect(parsePrivateRef(ref)).toEqual({ provider: 'do_spaces', key: 'staff/cv.pdf' })
    expect(parsePrivateRef(`see ${ref}`)).toBeNull()
    expect(parsePrivateRef('https://pub-test.r2.dev/SYS/branding/logo.png')).toBeNull()
  })

  it('does not parse a reference whose tag does not verify', () => {
    const forged = makePrivateRef('r2', 'staff/other/cv.pdf').replace('other', 'victim')

    expect(parsePrivateRef(forged)).toBeNull()
  })

  it('signs tags with PRIVATE_FILE_REF_SECRET, so rotating the sign-in secret keeps files', () => {
    const ref = makePrivateRef('r2', 'patients/a/scan.jpg')

    testEnv.current.BETTER_AUTH_SECRET = 'a-rotated-sign-in-secret-of-32-or-more-chars'
    expect(findPrivateRefs(ref)[0].tagValid).toBe(true)

    testEnv.current.PRIVATE_FILE_REF_SECRET = 'a-different-file-ref-secret-of-32-chars-plus'
    expect(findPrivateRefs(ref)[0].tagValid).toBe(false)
  })

  it('refuses to make or check references without PRIVATE_FILE_REF_SECRET', () => {
    const ref = makePrivateRef('r2', 'a/b.jpg')
    testEnv.current.PRIVATE_FILE_REF_SECRET = undefined

    expect(() => makePrivateRef('r2', 'a/b.jpg')).toThrow('PRIVATE_FILE_REF_SECRET is not set')
    expect(() => findPrivateRefs(ref)).toThrow('PRIVATE_FILE_REF_SECRET is not set')
  })

  it('replaces every occurrence of a reference', () => {
    const ref = makePrivateRef('r2', 'a/b.jpg')
    const text = `${ref} and again ${ref}`

    expect(replacePrivateRefs(text, new Map([[ref, 'LINK']]))).toBe('LINK and again LINK')
  })
})
