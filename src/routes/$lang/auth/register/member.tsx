import { createFileRoute, Link } from '@tanstack/solid-router'
import { createServerFn } from '@tanstack/solid-start'
import RegisterMemberForm from '../../../../components/auth/RegisterMemberForm'
import LanguageSwitcher from '../../../../components/LanguageSwitcher'
import { m } from '../../../../paraglide/messages'

const ensureGuest = createServerFn({ method: 'GET' })
  .inputValidator((data: { lang: string }) => data)
  .handler(async ({ data }) => {
    const { redirectIfAuthenticated } = await import('../../../../lib/session.server')
    await redirectIfAuthenticated(data.lang)
  })

export const Route = createFileRoute('/$lang/auth/register/member')({
  beforeLoad: ({ params }) => ensureGuest({ data: { lang: params.lang } }),
  component: RegisterMemberPage,
})

function RegisterMemberPage() {
  const params = Route.useParams()
  return (
    <main class="min-h-screen flex items-center justify-center bg-linear-to-br from-neutral-50 via-white to-neutral-100 px-4 py-12">
      <div class="w-full max-w-xl">
        <div class="flex justify-end mb-4">
          <LanguageSwitcher />
        </div>
        <div class="flex flex-col items-center gap-2 mb-6 text-center">
          <h1 class="text-2xl font-bold text-neutral-900">
            {m.auth_register_member_title()}
          </h1>
          <p class="text-sm text-neutral-600 max-w-md">
            {m.auth_register_member_subtitle()}
          </p>
        </div>
        <div class="bg-white border border-neutral-200 rounded-xl shadow-sm p-6 sm:p-8">
          <RegisterMemberForm />
        </div>
        <p class="mt-6 text-center text-sm text-neutral-600">
          {m.auth_register_common_haveAccount()}{' '}
          <Link
            to="/$lang/auth/login"
            params={{ lang: params().lang }}
            class="font-medium text-[#00209F] hover:underline"
          >
            {m.auth_register_common_signIn()}
          </Link>
        </p>
      </div>
    </main>
  )
}
