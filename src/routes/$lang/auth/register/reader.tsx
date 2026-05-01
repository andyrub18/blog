import { createFileRoute, Link } from '@tanstack/solid-router'
import { createServerFn } from '@tanstack/solid-start'
import RegisterReaderForm from '../../../../components/auth/RegisterReaderForm'
import LanguageSwitcher from '../../../../components/LanguageSwitcher'
import { useI18n } from '../../../../i18n/context'

const ensureGuest = createServerFn({ method: 'GET' })
  .inputValidator((data: { lang: string }) => data)
  .handler(async ({ data }) => {
    const { redirectIfAuthenticated } = await import('../../../../lib/session')
    await redirectIfAuthenticated(data.lang)
  })

export const Route = createFileRoute('/$lang/auth/register/reader')({
  beforeLoad: ({ params }) => ensureGuest({ data: { lang: params.lang } }),
  component: RegisterReaderPage,
})

function RegisterReaderPage() {
  const { tx: t } = useI18n()
  const params = Route.useParams()
  return (
    <main class="min-h-screen flex items-center justify-center bg-linear-to-br from-neutral-50 via-white to-neutral-100 px-4 py-12">
      <div class="w-full max-w-md">
        <div class="flex justify-end mb-4">
          <LanguageSwitcher />
        </div>
        <div class="flex flex-col items-center gap-2 mb-6 text-center">
          <h1 class="text-2xl font-bold text-neutral-900">
            {t('auth.register.reader.title')}
          </h1>
          <p class="text-sm text-neutral-600 max-w-xs">
            {t('auth.register.reader.subtitle')}
          </p>
        </div>
        <div class="bg-white border border-neutral-200 rounded-xl shadow-sm p-6 sm:p-8">
          <RegisterReaderForm />
        </div>
        <p class="mt-6 text-center text-sm text-neutral-600">
          {t('auth.register.common.haveAccount')}{' '}
          <Link
            to="/$lang/auth/login"
            params={{ lang: params().lang }}
            class="font-medium text-[#00209F] hover:underline"
          >
            {t('auth.register.common.signIn')}
          </Link>
        </p>
      </div>
    </main>
  )
}
