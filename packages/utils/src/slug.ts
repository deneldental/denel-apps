/**
 * The one rule for a lookup row's `name` (its slug) across every app.
 *
 * Settings-domain-audit D4: the portal's settings sections carried four
 * different slug generators, so the same display name became a different
 * `name` depending on which section created it. Lookups use snake_case;
 * document tags keep the kebab-case their schema documents (`consent-form`).
 *
 * Any run of characters outside `[a-z0-9]` becomes one separator, and the
 * result never starts or ends with one. Existing rows are never rewritten by
 * this — it only decides new slugs.
 */
export interface LookupSlugOptions {
  /** `'_'` (default, lookups) or `'-'` (document tags). */
  separator?: '_' | '-'
}

export function toLookupSlug(text: string, options: LookupSlugOptions = {}): string {
  const separator = options.separator ?? '_'
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, separator)
    .replace(new RegExp(`^\\${separator}+|\\${separator}+$`, 'g'), '')
}
