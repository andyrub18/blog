import { createSignal, Show } from 'solid-js'
import { useRouter } from '@tanstack/solid-router'
import { signOut } from '../../lib/auth-actions'
import { useI18n } from '../../i18n/context'

export default function LogoutButton(props: { class?: string }) {
  const router = useRouter()
  const { tx: t, locale } = useI18n()
  const [loading, setLoading] = createSignal(false)

  async function onClick() {
    setLoading(true)
    try {
      await signOut()
    } finally {
      setLoading(false)
      await router.navigate({ to: '/$lang/auth/login', params: { lang: locale() } })
      router.invalidate()
    }
  }

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={loading()}
      class={
        props.class ??
        'h-9 px-4 text-sm font-medium border border-neutral-300 rounded-md hover:bg-neutral-50 disabled:opacity-60'
      }
    >
      <Show when={loading()} fallback={t('common.logout')}>
        {t('auth.login.submitting')}
      </Show>
    </button>
  )
}
