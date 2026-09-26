import { createFileRoute, redirect } from '@tanstack/solid-router'
import { createServerFn } from '@tanstack/solid-start'
import { Show } from 'solid-js'
import ApplicationFiled from '../../components/auth/ApplicationFiled'
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
const readApplicationState = createServerFn({ method: 'GET' }).handler(async () => {
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
  if (eligibility.eligible) return { applied: false }

  /**
   * An open application is a state this page can show, not a reason to leave.
   *
   * It used to redirect home, and that quietly cost every applicant their
   * confirmation: `ApplyForm` calls `router.invalidate()` the moment the
   * dossier lands, this check re-ran, found the application it had just
   * created, and redirected over the panel saying it arrived — measured at
   * about 75ms on an idle machine, and often no frame at all under load.
   * Someone who has just uploaded three PDFs and two essays on a metered
   * connection reads a silent bounce to the home page as failure, and files
   * again.
   */
  if (eligibility.reason === 'APPLICATION_OPEN') return { applied: true }

  // The other two refusals have nothing to show here. A member has nothing to
  // apply for, and an unverified address has to be dealt with first — neither
  // is a dossier under review, so neither gets a page that says one is.
  throw redirect({ to: '/' })
})

export const Route = createFileRoute('/_app/apply')({
  loader: () => readApplicationState(),
  component: ApplyPage,
})

function ApplyPage() {
  const state = Route.useLoaderData()

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
          {/* The subtitle invites someone to file. Once they have, it would be
              asking for a dossier we are already holding. */}
          <Show when={!state().applied}>
            <p class="max-w-md text-center text-sm text-neutral-600">
              {m.apply_subtitle()}
            </p>
          </Show>
        </div>
        <div class="rounded-xl border border-neutral-200 bg-white p-6 shadow-sm sm:p-8">
          <Show when={!state().applied} fallback={<ApplicationFiled />}>
            <ApplyForm />
          </Show>
        </div>
      </div>
    </main>
  )
}
