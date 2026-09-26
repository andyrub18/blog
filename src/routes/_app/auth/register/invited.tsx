import { createFileRoute, Link } from '@tanstack/solid-router'
import { Show } from 'solid-js'
import RegisterInvitedForm from '../../../../components/auth/RegisterInvitedForm'
import LanguageSwitcher from '../../../../components/LanguageSwitcher'
import { inspectInvitation } from '../../../../lib/governance-actions'
import { m } from '../../../../paraglide/messages'

/**
 * Registration from a cooptation invitation.
 *
 * The token is checked on the server before anything is drawn, so a spent or
 * expired link says so instead of showing a form that will refuse at the end.
 * The email address is not asked for: it comes from the invitation, because an
 * address taken from the form would turn one invitation into an account in any
 * name at all.
 */
export const Route = createFileRoute('/_app/auth/register/invited')({
  validateSearch: (search: Record<string, unknown>) => ({
    token: typeof search.token === 'string' ? search.token : '',
  }),
  loaderDeps: ({ search }) => ({ token: search.token }),
  loader: ({ deps }) => inspectInvitation({ data: { token: deps.token } }),
  component: RegisterInvitedPage,
})

function RegisterInvitedPage() {
  const invitation = Route.useLoaderData()
  const search = Route.useSearch()
  const alreadyUsed = () => {
    const result = invitation()
    return !result.ok && result.code === 'ALREADY_USED'
  }

  return (
    <main class="flex min-h-screen items-center justify-center bg-linear-to-br from-neutral-50 via-white to-neutral-100 px-4 py-12">
      <div class="w-full max-w-md">
        <div class="mb-4 flex justify-end">
          <LanguageSwitcher />
        </div>

        <Show
          when={invitation().ok && invitation()}
          fallback={
            <div class="rounded-xl border border-neutral-200 bg-white p-6 text-center shadow-sm">
              {/*
               * A spent token is told apart from a broken one.
               *
               * `inspectInvitation` has always returned the reason; the page
               * showed one panel for all of them, so the commonest case by far —
               * a new member reloading the page they just registered on, or
               * opening the link again from their mail — read as "invitation
               * unusable, ask for another one". That sends someone who already
               * has an account back to their sponsor. The answer is on the
               * server already; it only had to be said.
               */}
              <h1 class="text-xl font-bold text-neutral-900">
                {alreadyUsed()
                  ? m.auth_register_invited_usedTitle()
                  : m.auth_register_invited_invalidTitle()}
              </h1>
              <p class="mt-2 text-sm text-neutral-600">
                {alreadyUsed()
                  ? m.auth_register_invited_usedBody()
                  : m.auth_register_invited_invalidBody()}
              </p>
            </div>
          }
        >
          {(loaded) => {
            const invite = () =>
              loaded() as { ok: true; email: string; sponsor: string | null }
            return (
              <>
                <div class="mb-6 flex flex-col items-center gap-2 text-center">
                  <h1 class="text-2xl font-bold text-neutral-900">
                    {m.auth_register_invited_title()}
                  </h1>
                  <p class="max-w-xs text-sm text-neutral-600">
                    {m.auth_register_invited_subtitle()}
                  </p>
                </div>
                <div class="rounded-xl border border-neutral-200 bg-white p-6 shadow-sm sm:p-8">
                  <RegisterInvitedForm
                    token={search().token}
                    email={invite().email}
                    sponsor={invite().sponsor}
                  />
                </div>
              </>
            )
          }}
        </Show>

        <p class="mt-6 text-center text-sm text-neutral-600">
          {m.auth_register_common_haveAccount()}{' '}
          <Link to="/auth/login" class="font-medium text-[#00209F] hover:underline">
            {m.auth_register_common_signIn()}
          </Link>
        </p>
      </div>
    </main>
  )
}
