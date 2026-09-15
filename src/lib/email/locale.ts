import {
  type ContentLang,
  DEFAULT_CONTENT_LANG,
  DEFAULT_LOCALE,
  isContentLang,
  type Locale,
} from '../../i18n'
import { getLocale, isLocale } from '../../paraglide/runtime'

/**
 * The locale of the request currently being handled.
 *
 * Paraglide's request middleware (`src/start.ts`) puts the locale in
 * AsyncLocalStorage, so this resolves to whatever language the person was
 * actually using when they signed up — a Creole reader should not receive a
 * French verification email.
 *
 * If the scope is missing for any reason, fall back to the base locale rather
 * than failing: an email in the wrong language is recoverable, an unsent one is
 * not.
 */
export function resolveRequestLocale(): Locale {
  try {
    const locale = getLocale()
    return isLocale(locale) ? (locale as Locale) : DEFAULT_LOCALE
  } catch {
    return DEFAULT_LOCALE
  }
}

/**
 * The content language implied by the current request.
 *
 * The interface speaks four languages; the movement publishes in two. Every
 * write path that has to name a language without being told one ends up here,
 * because the obvious version — take the request's locale — quietly files an
 * English-reading author's French article under `en`, where no reviewer is
 * assigned and `decide()` can never publish it.
 *
 * Lives beside `resolveRequestLocale` rather than in `i18n/` because it needs
 * the request scope, which is what this module is for.
 */
export function resolveRequestContentLang(): ContentLang {
  const locale = resolveRequestLocale()
  return isContentLang(locale) ? locale : DEFAULT_CONTENT_LANG
}
