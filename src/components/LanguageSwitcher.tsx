import { useLocation } from '@tanstack/solid-router'
import { For } from 'solid-js'
import { LOCALE_LABELS, LOCALES, type Locale } from '../i18n'
import { m } from '../paraglide/messages'
import { deLocalizeHref, getLocale, localizeHref, setLocale } from '../paraglide/runtime'

/**
 * The same page in another language — a link, and a full page load.
 *
 * It used to change the address without reloading, and nothing on the page
 * changed with it: every message is computed once, when its component renders,
 * so the URL said `/ht/` over a page still in French. A real navigation is the
 * one way every part of the page follows — the components, the header, the
 * `lang` on `<html>`, and the pages the server writes as HTML in one language
 * (`front-page.ts`, the reading view). It also works before the bundle arrives.
 *
 * The click still records the choice in Paraglide's cookie, which is what an
 * address with no language in it — the bare domain — goes by next time. The
 * query string travels with the page: an invitation's token must survive the
 * invited person reading the form in their own language.
 */
export default function LanguageSwitcher() {
  const location = useLocation()

  // Strip the current prefix before adding the new one, or `/fr/x` would
  // become `/ht/fr/x`.
  const hrefIn = (code: Locale) =>
    localizeHref(deLocalizeHref(location().pathname) + location().searchStr, {
      locale: code,
    })

  function choose(event: MouseEvent, code: Locale) {
    // The language already on screen: there is nothing to load.
    if (code === getLocale()) return event.preventDefault()
    setLocale(code, { reload: false })
  }

  return (
    /* A column, because it lives in the header's language menu. Each language
       is named in itself, and carries its own `lang`, so a screen reader says
       "Kreyòl" in Creole rather than spelling it out in French. */
    <nav class="flex flex-col" aria-label={m.common_switchLanguage()}>
      <For each={LOCALES}>
        {(code) => (
          <a
            href={hrefIn(code)}
            lang={code}
            hreflang={code}
            onClick={(event) => choose(event, code)}
            class={
              code === getLocale()
                ? 'flex min-h-11 w-full items-center rounded-lg px-3 text-[15px] font-bold text-accent'
                : 'flex min-h-11 w-full items-center rounded-lg px-3 text-[15px] text-ink hover:bg-neutral-100 hover:text-accent'
            }
            aria-current={code === getLocale() ? 'true' : undefined}
          >
            {LOCALE_LABELS[code]}
          </a>
        )}
      </For>
    </nav>
  )
}
