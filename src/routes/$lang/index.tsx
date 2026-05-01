import { createFileRoute } from '@tanstack/solid-router'
import { Show } from 'solid-js'
import LanguageSwitcher from '../../components/LanguageSwitcher'
import LogoutButton from '../../components/auth/LogoutButton'
import { authClient } from '../../lib/auth-client'
import { useI18n } from '../../i18n/context'

export const Route = createFileRoute('/$lang/')({
  component: Home,
})

function Home() {
  const { tx: t } = useI18n()
  const session = authClient.useSession()
  return (
    <div class="p-8">
      <div class="mb-6 flex items-center justify-between gap-4">
        <h1 class="text-4xl font-bold">{t('common.appName')}</h1>
        <div class="flex items-center gap-3">
          <LanguageSwitcher />
          <Show when={session().data?.user}>
            <LogoutButton />
          </Show>
        </div>
      </div>
      <p class="text-lg text-neutral-700">{t('auth.login.subtitle')}</p>
      <Show when={session().data?.user}>
        {(user) => (
          <p class="mt-4 text-sm text-neutral-600">
            {user().email} · {String((user() as { role?: string }).role ?? 'reader')}
          </p>
        )}
      </Show>
    </div>
  )
}

