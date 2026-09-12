/**
 * Locale registry.
 *
 * Adding a language is: add the code here, add `messages/<code>.json`, and add
 * the code to `project.inlang/settings.json`. Paraglide compiles each message
 * to its own function, so the client bundle does not grow with the number of
 * locales — only the messages a route actually uses are shipped.
 *
 * Planned: 'en' and 'es' for the diaspora (see docs/STACK-REVIEW.md, phase 6).
 */
export const LOCALES = ['fr', 'ht'] as const
export type Locale = (typeof LOCALES)[number]

export const DEFAULT_LOCALE: Locale = 'fr'

/** Human-readable names, shown in their own language. */
export const LOCALE_LABELS: Record<Locale, string> = {
  fr: 'Français',
  ht: 'Kreyòl',
}

export function isLocale(value: unknown): value is Locale {
  return typeof value === 'string' && (LOCALES as readonly string[]).includes(value)
}
