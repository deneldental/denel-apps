/**
 * Rich text keeps images stored privately: the request layer turns their links
 * into `private-file://` references before the route sanitises the HTML.
 */
import { describe, expect, it } from 'vitest'
import { sanitizeMemoHtml } from '../../src/lib/html-sanitize'

const REF = 'private-file://r2/memos/diagram.png#0123456789abcdef'

describe('sanitizeMemoHtml and private files', () => {
  it('keeps a private image, video and link', () => {
    const html = `<img src="${REF}"><video src="${REF}"></video><a href="${REF}">file</a>`

    const clean = sanitizeMemoHtml(html)

    expect(clean).toContain(`<img src="${REF}"`)
    expect(clean).toContain(`<video src="${REF}"`)
    expect(clean).toContain(`href="${REF}"`)
  })

  it('still strips javascript: links', () => {
    expect(sanitizeMemoHtml('<a href="javascript:alert(1)">x</a>')).not.toContain('javascript:')
  })
})
