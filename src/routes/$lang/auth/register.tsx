import { createFileRoute, Link } from '@tanstack/solid-router'
import { createServerFn } from '@tanstack/solid-start'
import LanguageSwitcher from '../../../components/LanguageSwitcher'
import { useI18n } from '../../../i18n/context'

const ensureGuest = createServerFn({ method: 'GET' })
  .inputValidator((data: { lang: string }) => data)
  .handler(async ({ data }) => {
    const { redirectIfAuthenticated } = await import('../../../lib/session')
    await redirectIfAuthenticated(data.lang)
  })

export const Route = createFileRoute('/$lang/auth/register')({
  beforeLoad: ({ params }) => ensureGuest({ data: { lang: params.lang } }),
  component: RegisterChooser,
})

function RegisterChooser() {
  const { tx: t } = useI18n()
  const params = Route.useParams()
  return (
    <main class="min-h-screen flex items-center justify-center bg-linear-to-br from-neutral-50 via-white to-neutral-100 px-4 py-12">
      <div class="w-full max-w-2xl">
        <div class="flex justify-end mb-4">
          <LanguageSwitcher />
        </div>
        <div class="flex flex-col items-center gap-3 mb-8">
          <h1 class="text-2xl font-bold text-neutral-900 text-center">
            {t('auth.register.chooserTitle')}
          </h1>
          <p class="text-sm text-neutral-600 text-center max-w-md">
            {t('auth.register.chooserSubtitle')}
          </p>
        </div>
        <div class="grid gap-4 sm:grid-cols-2">
          <Card
            title={t('auth.register.readerTitle')}
            description={t('auth.register.readerDescription')}
            cta={t('auth.register.readerCta')}
            to="/$lang/auth/register/reader"
            lang={params().lang}
          />
          <Card
            title={t('auth.register.memberTitle')}
            description={t('auth.register.memberDescription')}
            cta={t('auth.register.memberCta')}
            to="/$lang/auth/register/member"
            lang={params().lang}
          />
        </div>
        <p class="mt-8 text-center text-sm text-neutral-600">
          <Link
            to="/$lang/auth/login"
            params={{ lang: params().lang }}
            class="font-medium text-[#00209F] hover:underline"
          >
            {t('auth.register.backToLogin')}
          </Link>
        </p>
      </div>
    </main>
  )
}

function Card(props: {
  title: string
  description: string
  cta: string
  to: '/$lang/auth/register/reader' | '/$lang/auth/register/member'
  lang: string
}) {
  return (
    <div class="bg-white border border-neutral-200 rounded-xl shadow-sm p-6 flex flex-col gap-3">
      <h2 class="text-lg font-semibold text-neutral-900">{props.title}</h2>
      <p class="text-sm text-neutral-600 flex-1">{props.description}</p>
      <Link
        to={props.to}
        params={{ lang: props.lang }}
        class="inline-flex h-10 items-center justify-center rounded-md bg-[#00209F] text-white text-sm font-semibold hover:opacity-95 px-4"
      >
        {props.cta}
      </Link>
    </div>
  )
}
