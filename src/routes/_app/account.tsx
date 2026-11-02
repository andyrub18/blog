import { createFileRoute, Link, useRouteContext } from '@tanstack/solid-router'
import { Show } from 'solid-js'
import TwoFactorSettings from '../../components/account/TwoFactorSettings'
import { m } from '../../paraglide/messages'

/**
 * The account's security settings: for now, codes at sign-in (D40).
 *
 * No loader. Whether codes are on is part of the session, which the layout
 * already reads for every page, and a route's loader ships in the bundle every
 * page loads (D39). The context is read through the layout's route id rather
 * than `Route`: a component that imports its own `Route` pulls the route's
 * definition out of the entry into a chunk of its own, 0.4 KB on every page.
 * The server functions behind the buttons check the caller themselves; this
 * page only decides what to show.
 */
export const Route = createFileRoute('/_app/account')({
  component: AccountPage,
})

function AccountPage() {
  const context = useRouteContext({ from: '/_app' })

  return (
    <main class="flex flex-1 justify-center bg-surface px-4 py-12">
      <div class="w-full max-w-2xl">
        <h1 class="mb-6 font-serif text-3xl font-bold">{m.account_security_nav()}</h1>
        <Show
          when={context().user}
          fallback={
            <p class="text-[15px]">
              {m.account_signInFirst()}{' '}
              <Link to="/auth/login" class="font-semibold text-accent hover:underline">
                {m.auth_login_submit()}
              </Link>
            </p>
          }
        >
          {(user) => <TwoFactorSettings enabled={user().twoFactorEnabled === true} />}
        </Show>
      </div>
    </main>
  )
}
