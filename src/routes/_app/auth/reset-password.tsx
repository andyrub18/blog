import { createFileRoute, useLocation } from '@tanstack/solid-router'
import { Show } from 'solid-js'
import NewPasswordForm from '../../../components/auth/NewPasswordForm'
import RequestResetForm, { BackToSignIn } from '../../../components/auth/RequestResetForm'

/**
 * Password recovery, both halves on one page.
 *
 * Without a token it asks for an address; the emailed link comes back here
 * through `/api/auth/reset-password/<token>`, which checks the token and adds
 * it to this URL — or adds `error=INVALID_TOKEN` when it has expired or been
 * used. One route rather than two because every route is a stub in the bundle
 * every page loads, and the reading view has no room for a second.
 *
 * The query is read with `useLocation`, which the header's language switcher
 * already ships to every page, and not with `useSearch`, a loader or a
 * `validateSearch`. Each of those is new to the client or stays in the route's
 * stub, and measured, the first version of this page cost the reading view
 * 1.1 KB. No guard either: somebody signed in may still want a new password.
 */
export const Route = createFileRoute('/_app/auth/reset-password')({
  component: ResetPasswordPage,
})

function ResetPasswordPage() {
  const location = useLocation()
  const query = () => {
    const search = location().search as { token?: unknown; error?: unknown }
    return {
      token: typeof search.token === 'string' && search.token ? search.token : null,
      expired: search.error === 'INVALID_TOKEN',
    }
  }

  return (
    <main class="flex flex-1 justify-center bg-surface px-4 py-12">
      <div class="w-full max-w-md">
        <div class="rounded-2xl border border-line bg-raised p-6 sm:p-8">
          <Show
            when={query().token}
            keyed
            fallback={<RequestResetForm expired={query().expired} />}
          >
            {(token) => <NewPasswordForm token={token} />}
          </Show>
          <BackToSignIn />
        </div>
      </div>
    </main>
  )
}
