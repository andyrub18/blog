import { createFileRoute, Link } from '@tanstack/solid-router'
import { Show } from 'solid-js'
import LogoutButton from '../../components/auth/LogoutButton'
import LanguageSwitcher from '../../components/LanguageSwitcher'
import { m } from '../../paraglide/messages'

export const Route = createFileRoute('/_app/')({
  component: Home,
})

function Home() {
  // Loaded server-side in the /_app layout, so it is correct on first paint.
  const context = Route.useRouteContext()

  return (
    <div class="p-8">
      <div class="mb-6 flex items-center justify-between gap-4">
        <h1 class="text-4xl font-bold">{m.common_appName()}</h1>
        <div class="flex items-center gap-3">
          <LanguageSwitcher />
          <Show when={context().user}>
            <LogoutButton />
          </Show>
        </div>
      </div>
      <p class="text-lg text-neutral-700">{m.auth_login_subtitle()}</p>
      <Show when={context().user}>
        {(user) => (
          <>
            <p class="mt-4 text-sm text-neutral-600">
              {user().email} · {user().role}
            </p>
            {/* The promotion path: read and take part first, then apply. */}
            <Show when={user().role === 'reader'}>
              <Link
                to="/apply"
                class="mt-4 inline-flex h-10 items-center justify-center rounded-md bg-[#00209F] px-4 text-sm font-semibold text-white hover:opacity-95"
              >
                {m.apply_cta()}
              </Link>
            </Show>
          </>
        )}
      </Show>
    </div>
  )
}
