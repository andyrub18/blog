import { createFileRoute, Link } from '@tanstack/solid-router'
import { createServerFn } from '@tanstack/solid-start'
import LoginForm from '../../../components/auth/LoginForm'
import LanguageSwitcher from '../../../components/LanguageSwitcher'
import { useI18n } from '../../../i18n/context'

const ensureGuest = createServerFn({ method: 'GET' })
  .inputValidator((data: { lang: string }) => data)
  .handler(async ({ data }) => {
    const { redirectIfAuthenticated } = await import('../../../lib/session')
    await redirectIfAuthenticated(data.lang)
  })

export const Route = createFileRoute('/$lang/auth/login')({
  beforeLoad: ({ params }) => ensureGuest({ data: { lang: params.lang } }),
  component: LoginPage,
})

function LoginPage() {
  const { t } = useI18n()
  const params = Route.useParams()
  return (
    <main class="min-h-screen flex items-center justify-center bg-linear-to-br from-neutral-50 via-white to-neutral-100 px-4 py-12">
      <div class="w-full max-w-md">
        <div class="flex justify-end mb-4">
          <LanguageSwitcher />
        </div>

        <div class="flex flex-col items-center gap-3 mb-8">
          <img
            src="/kleLogo.jpeg"
            alt={t('common.appName')}
            class="h-20 w-20 rounded-full object-cover ring-4 ring-white shadow-md"
          />
          <h1 class="text-2xl font-bold text-neutral-900 text-center">
            {t('auth.login.title')}
          </h1>
          <p class="text-sm text-neutral-600 text-center max-w-xs">
            {t('auth.login.subtitle')}
          </p>
        </div>

        <div class="bg-white border border-neutral-200 rounded-xl shadow-sm p-6 sm:p-8">
          <LoginForm />
        </div>

        <p class="mt-6 text-center text-sm text-neutral-600">
          {t('auth.login.noAccount')}{' '}
          <Link
            to="/$lang/auth/register"
            params={{ lang: params().lang }}
            class="font-medium text-[#00209F] hover:underline"
          >
            {t('auth.login.register')}
          </Link>
        </p>

        <div class="mt-8 flex items-center justify-center gap-1.5">
          <span class="block h-1 w-6 rounded-full bg-[#00209F]" />
          <span class="block h-1 w-6 rounded-full bg-[#D21034]" />
        </div>
      </div>
    </main>
  )
}
