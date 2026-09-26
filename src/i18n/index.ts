/**
 * Locale registry.
 *
 * One list. `LOCALES` is what the interface speaks *and* what an article may be
 * written, reviewed and published in — those are the same set, deliberately.
 *
 * Phase 6 briefly split them, on the reasoning that the review circle
 * deliberates in Creole and French and could not staff a Spanish contradictor.
 * That was a restriction nobody asked for: nothing in the manifesto bans an
 * article in English or Spanish, and the constraint that worried us enforces
 * itself — `deliberation.ts` publishes a language only once a contradictor has
 * argued in it, so a translation nobody reviews simply never goes live. There
 * was no need for a second gate, and the gate took a choice away from KLEA.
 *
 * English and Spanish are here for the diaspora — Haitians in Miami, Boston,
 * Montréal, Santo Domingo. Most articles will be written in Creole and French
 * because that is who writes them, not because the platform says so.
 *
 * Adding a language is: add the code here and to `LOCALE_LABELS`, add
 * `messages/<code>.json`, add it to `project.inlang/settings.json`, and add a
 * `urlPatterns` entry in `paraglide-options.ts`. Paraglide compiles each
 * message to its own function, so an unused message costs nothing — but every
 * message a page *does* use carries all four strings, so measure
 * (`docs/phases/05-LOCALES.md`).
 */
export const LOCALES = ['fr', 'ht', 'en', 'es'] as const
export type Locale = (typeof LOCALES)[number]

export const DEFAULT_LOCALE: Locale = 'fr'

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
