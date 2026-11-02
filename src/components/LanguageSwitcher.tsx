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
    /* A column, because it lives in the header's language menu. Each language
       is named in itself, and carries its own `lang`, so a screen reader says
       "Kreyòl" in Creole rather than spelling it out in French. */
    <fieldset class="flex flex-col" aria-label={m.common_switchLanguage()}>
      <For each={LOCALES}>
        {(code) => (
          <button
            type="button"
            lang={code}
            onClick={() => handleChange(code)}
            class={
              code === getLocale()
                ? 'flex min-h-11 w-full items-center rounded-lg px-3 text-left text-[15px] font-bold text-accent'
                : 'flex min-h-11 w-full items-center rounded-lg px-3 text-left text-[15px] text-ink hover:bg-neutral-100 hover:text-accent'
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
