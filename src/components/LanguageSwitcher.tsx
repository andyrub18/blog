import { useLocation, useRouter } from '@tanstack/solid-router'
import { For } from 'solid-js'
import { LOCALE_LABELS, LOCALES, type Locale } from '../i18n'
import { useLocale } from '../i18n/context'
import { setLocaleCookie } from '../i18n/detect'
import { m } from '../paraglide/messages'

export default function LanguageSwitcher() {
  const locale = useLocale()
  const router = useRouter()
  const location = useLocation()

  function pathWithoutLocale() {
    const segments = location().pathname.split('/').filter(Boolean)
    return `/${segments.slice(1).join('/')}`
  }

  async function handleChange(next: Locale) {
    if (next === locale()) return
    await setLocaleCookie({ data: { locale: next } })
    const tail = pathWithoutLocale()
    const href = `/${next}${tail === '/' ? '' : tail}`
    router.history.push(href)
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
            onClick={() => void handleChange(code)}
            class={
              code === locale()
                ? 'rounded px-2 py-1 font-semibold bg-neutral-900 text-white'
                : 'rounded px-2 py-1 text-neutral-700 hover:bg-neutral-100'
            }
            aria-current={code === locale() ? 'true' : undefined}
          >
            {LOCALE_LABELS[code]}
          </button>
        )}
      </For>
    </fieldset>
  )
}
