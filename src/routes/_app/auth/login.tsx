import { createFileRoute, Link } from '@tanstack/solid-router'
import { createServerFn } from '@tanstack/solid-start'
import LoginForm from '../../../components/auth/LoginForm'
import { m } from '../../../paraglide/messages'

const ensureGuest = createServerFn({ method: 'GET' }).handler(async () => {
  const { redirectIfAuthenticated } = await import('../../../lib/auth/session.server')

  await redirectIfAuthenticated()
})

export const Route = createFileRoute('/_app/auth/login')({
  beforeLoad: () => ensureGuest(),
  component: LoginPage,
})

function LoginPage() {
  return (
    <main class="flex flex-1 justify-center bg-surface px-4 py-12">
      <div class="w-full max-w-md">
        <div class="rounded-2xl border border-line bg-raised p-6 sm:p-8">
          <div class="mb-6 flex flex-col items-center gap-3 text-center">
            {/* Decorative: the header names the movement. */}
            <img
              src="/emblem.png"
              alt=""
              width="80"
              height="120"
              class="h-[120px] w-20"
            />
            <h1 class="font-serif text-3xl font-bold">{m.auth_login_title()}</h1>
            <p class="max-w-xs text-[15px] text-ink-soft">{m.auth_login_subtitle()}</p>
          </div>
          <LoginForm />
          <p class="mt-6 border-t border-line pt-5 text-center text-[15px] text-ink-soft">
            {m.auth_login_noAccount()}{' '}
            <Link to="/auth/register" class="font-semibold text-accent hover:underline">
              {m.auth_login_register()}
            </Link>
          </p>
        </div>
        <p class="mt-5 text-center text-sm text-muted">
          {m.common_readingIsFree()}{' '}
          <Link to="/articles" class="font-semibold text-accent hover:underline">
            {m.common_browseArticles()}
          </Link>
        </p>
      </div>
    </main>
  )
}
