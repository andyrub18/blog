import { useLocation, useRouter } from '@tanstack/solid-router'
import { For } from 'solid-js'
import { LOCALE_LABELS, LOCALES, type Locale } from '../i18n'
import { m } from '../paraglide/messages'
import { deLocalizeHref, getLocale, localizeHref, setLocale } from '../paraglide/runtime'

export default function LanguageSwitcher() {
  const router = useRouter()
  const location = useLocation()

  function handleChange(next: Locale) {
    if (next === getLocale()) return
    // Persist the choice without a full document reload; the navigation below
    // is what actually re-renders the page in the new language.
    setLocale(next, { reload: false })
    // Strip the current prefix before adding the new one, or `/fr/x` would
    // become `/ht/fr/x`.
    router.history.push(
      localizeHref(deLocalizeHref(location().pathname), { locale: next }),
    )
  }

  return (
    <fieldset
      class="inline-flex items-center gap-1 rounded-md border border-neutral-200 bg-white p-0.5 text-xs"
      aria-label={m.common_switchLanguage()}
    >
      <For each={LOCALES}>
        {(code) => (
          <button
            type="button"
            onClick={() => handleChange(code)}
            class={
              code === getLocale()
                ? 'rounded bg-neutral-900 px-2 py-1 font-semibold text-white'
                : 'rounded px-2 py-1 text-neutral-700 hover:bg-neutral-100'
            }
            aria-current={code === getLocale() ? 'true' : undefined}
          >
            {LOCALE_LABELS[code]}
          </button>
        )}
      </For>
    </fieldset>
  )
}
