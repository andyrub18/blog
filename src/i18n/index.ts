/**
 * Locale registry.
 *
 * Two lists, deliberately, because "language" means two different things here.
 *
 * `LOCALES` is what the *interface* speaks: the chrome, the forms, the emails,
 * the URL prefix. `CONTENT_LANGS` is what the *movement* writes and deliberates
 * in. Until phase 6 these were one list with two jobs, which worked only
 * because the two answers happened to be identical.
 *
 * They are not identical any more. English and Spanish are for the diaspora —
 * Haitians in Miami, Boston, Montréal, Santo Domingo who follow KLE and read
 * more comfortably in them. Adding them to a single list would also have added
 * them to the author's language checklist, to the DOCX importer's picker, and
 * to what the review circle is asked to decide, and that last one is not a
 * cosmetic mistake: `deliberation.ts` publishes a language only once a
 * contradictor has argued *in that language*. Offering `es` as a content
 * language asks a circle that deliberates in Creole and French to hold a
 * Spanish adversarial review it has no one to staff.
 *
 * So: the interface speaks four languages, the movement publishes in two, and a
 * Spanish-reading visitor gets a Spanish interface around French and Creole
 * articles with an honest note saying so. See `docs/phases/05-LOCALES.md`.
 *
 * Adding a UI language is: add the code here, add `messages/<code>.json`, add
 * it to `project.inlang/settings.json`, and add a `urlPatterns` entry in
 * `paraglide-options.ts`. Paraglide compiles each message to its own function,
 * so the client bundle does not grow with the number of locales — only the
 * messages a route actually uses are shipped.
 *
 * Promoting one to a content language is a decision for KLE, not a code change
 * somebody makes because the list looked asymmetrical.
 */
export const LOCALES = ['fr', 'ht', 'en', 'es'] as const
export type Locale = (typeof LOCALES)[number]

export const DEFAULT_LOCALE: Locale = 'fr'

/**
 * The languages an article can be written, reviewed and published in.
 *
 * A subset of `LOCALES`, and the order is the order an author sees. The column
 * behind this is plain `text` and not constrained to these — a translation may
 * exist in a language the movement has since stopped offering, and it should
 * keep rendering rather than break a published URL.
 */
export const CONTENT_LANGS = ['fr', 'ht'] as const
export type ContentLang = (typeof CONTENT_LANGS)[number]

/**
 * What an unspecified content language means.
 *
 * Separate from `DEFAULT_LOCALE` even though both are `fr` today, because they
 * answer different questions: one is where an unprefixed URL sends a visitor,
 * the other is what language an author is writing in when they have not said.
 * Collapsing them would make a change to either silently change the other.
 */
export const DEFAULT_CONTENT_LANG: ContentLang = 'fr'

/** Human-readable names, shown in their own language. */
export const LOCALE_LABELS: Record<Locale, string> = {
  fr: 'Français',
  ht: 'Kreyòl',
  en: 'English',
  es: 'Español',
}

export function isLocale(value: unknown): value is Locale {
  return typeof value === 'string' && (LOCALES as readonly string[]).includes(value)
}

export function isContentLang(value: unknown): value is ContentLang {
  return typeof value === 'string' && (CONTENT_LANGS as readonly string[]).includes(value)
}
