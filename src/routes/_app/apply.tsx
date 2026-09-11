import { createFileRoute, redirect } from '@tanstack/solid-router'
import { createServerFn } from '@tanstack/solid-start'
import ApplyForm from '../../components/auth/ApplyForm'
import LanguageSwitcher from '../../components/LanguageSwitcher'
import { m } from '../../paraglide/messages'

/**
 * Membership application for an account that already exists.
 *
 * Deliberately NOT under `/auth/register`: those routes run
 * `redirectIfAuthenticated`, which bounces a signed-in reader straight back out.
 * The promotion path needs the opposite guard — you must be signed in to use it.
 */
const requireEligibleReader = createServerFn({ method: 'GET' }).handler(async () => {
  const { getSession } = await import('../../lib/session.server')
  const session = await getSession()
  if (!session?.user) {
    throw redirect({ to: '/auth/login' })
  }
  const { checkEligibility } = await import('../../lib/enrollment')
  const eligibility = await checkEligibility({
    id: session.user.id,
    role: session.user.role,
    emailVerified: session.user.emailVerified,
  })
  // Someone who cannot apply is sent home rather than shown a form that will
  // certainly fail.
  if (!eligibility.eligible) {
    throw redirect({ to: '/' })
  }
})

export const Route = createFileRoute('/_app/apply')({
  beforeLoad: () => requireEligibleReader(),
  component: ApplyPage,
})

function ApplyPage() {
  return (
    <main class="flex min-h-screen items-center justify-center bg-linear-to-br from-neutral-50 via-white to-neutral-100 px-4 py-12">
      <div class="w-full max-w-xl">
        <div class="mb-4 flex justify-end">
          <LanguageSwitcher />
        </div>
        <div class="mb-8 flex flex-col items-center gap-3">
          <h1 class="text-center text-2xl font-bold text-neutral-900">
            {m.apply_title()}
          </h1>
          <p class="max-w-md text-center text-sm text-neutral-600">
            {m.apply_subtitle()}
          </p>
        </div>
        <div class="rounded-xl border border-neutral-200 bg-white p-6 shadow-sm sm:p-8">
          <ApplyForm />
        </div>
      </div>
    </main>
  )
}
