import DOMPurify from 'dompurify'

const purify = DOMPurify(window)

/**
 * Sanitize HTML before injecting via dangerouslySetInnerHTML.
 * Backend already runs sanitize-html on write; this is a second layer of
 * defence against DB-level injection or future content paths.
 */
export function sanitizeHtml(html: string): string {
  return purify.sanitize(html, {
    USE_PROFILES: { html: true },
    // Allow iframe only for video embeds (YouTube/Vimeo) that the block editor inserts.
    ADD_TAGS: ['iframe'],
    ADD_ATTR: [
      'allow',
      'allowfullscreen',
      'frameborder',
      'scrolling',
      'src',
      'title',
      'width',
      'height',
    ],
  })
}
