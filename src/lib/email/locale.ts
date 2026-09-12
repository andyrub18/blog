import { DEFAULT_LOCALE, type Locale } from '../../i18n'
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
