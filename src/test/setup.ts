import '@testing-library/jest-dom/vitest'
import { cleanup } from '@solidjs/testing-library'
import { afterEach, beforeEach } from 'vitest'
import { DEFAULT_LOCALE } from '../i18n'
import { setLocale } from '../paraglide/runtime'

/**
 * Component tests run in French, and are told so rather than left to guess.
 *
 * Paraglide's strategy is `url` first, then cookie, then the browser's
 * preferred language. A component rendered by `@solidjs/testing-library` has no
 * URL and no cookie, so resolution fell through to `preferredLanguage` — which
 * in jsdom is `navigator.language`, `en-US`. That resolved to nothing while the
 * site spoke only French and Creole, and the base locale won by default.
 *
 * Adding `en` in phase 6 turned that accident into a failure: every assertion
 * matching a French string broke at once, in tests that had nothing to do with
 * the change. Pinning the locale here is what makes those tests about the
 * component again. A test that cares about a particular language should call
 * `setLocale` itself.
 */
beforeEach(() => {
  setLocale(DEFAULT_LOCALE, { reload: false })
})

afterEach(() => {
  cleanup()
})
