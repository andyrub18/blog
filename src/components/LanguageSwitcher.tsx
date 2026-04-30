import { For } from 'solid-js'
import { useLocation, useRouter } from '@tanstack/solid-router'
import { LOCALES, type Locale } from '../i18n'
import { useI18n } from '../i18n/context'
import { setLocaleCookie } from '../i18n/detect'

export default function LanguageSwitcher() {
  const { locale, t } = useI18n()
  const router = useRouter()
  const location = useLocation()

  function pathWithoutLocale() {
    const segments = location().pathname.split('/').filter(Boolean)
    return '/' + segments.slice(1).join('/')
  }

  async function handleChange(next: Locale) {
    if (next === locale()) return
    await setLocaleCookie({ data: { locale: next } })
    const tail = pathWithoutLocale()
    const href = `/${next}${tail === '/' ? '' : tail}`
    router.history.push(href)
  }

  return (
    <div
      class="inline-flex items-center gap-1 rounded-md border border-neutral-200 bg-white p-0.5 text-xs"
      role="group"
      aria-label={t('common.switchLanguage')}
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
            {t(`common.languages.${code}` as 'common.languages.fr')}
          </button>
        )}
      </For>
    </div>
  )
}
