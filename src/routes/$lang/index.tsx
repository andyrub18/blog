import { createFileRoute } from '@tanstack/solid-router'
import LanguageSwitcher from '../../components/LanguageSwitcher'
import { useI18n } from '../../i18n/context'

export const Route = createFileRoute('/$lang/')({
  component: Home,
})

function Home() {
  const { t } = useI18n()
  return (
    <div class="p-8">
      <div class="mb-6 flex items-center justify-between">
        <h1 class="text-4xl font-bold">{t('common.appName')}</h1>
        <LanguageSwitcher />
      </div>
      <p class="text-lg text-neutral-700">{t('auth.login.subtitle')}</p>
    </div>
  )
}
