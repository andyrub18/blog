import { createFileRoute, Link } from '@tanstack/solid-router'
import { createSignal, onSettled, Show } from 'solid-js'
import LanguageSwitcher from '../../../components/LanguageSwitcher'
import { authClient } from '../../../lib/auth-client'
import { m } from '../../../paraglide/messages'

type Status = 'pending' | 'success' | 'failure'

export const Route = createFileRoute('/$lang/auth/verify')({
  validateSearch: (search: Record<string, unknown>) => ({
    token: typeof search.token === 'string' ? search.token : undefined,
  }),
  component: VerifyPage,
})

function VerifyPage() {
  const params = Route.useParams()
  const search = Route.useSearch()
  const [status, setStatus] = createSignal<Status>('pending')

  onSettled(() => {
    void (async () => {
      const token = search().token
      if (!token) {
        setStatus('failure')
        return
      }
      try {
        const result = await authClient.verifyEmail({ query: { token } })
        setStatus(result.error ? 'failure' : 'success')
      } catch {
        setStatus('failure')
      }
    })()
  })

  return (
    <main class="min-h-screen flex items-center justify-center bg-linear-to-br from-neutral-50 via-white to-neutral-100 px-4 py-12">
      <div class="w-full max-w-md">
        <div class="flex justify-end mb-4">
          <LanguageSwitcher />
        </div>
        <div class="bg-white border border-neutral-200 rounded-xl shadow-sm p-6 sm:p-8 flex flex-col items-center gap-4 text-center">
          <h1 class="text-2xl font-bold text-neutral-900">{m.auth_verify_title()}</h1>
          <Show when={status() === 'pending'}>
            <p class="text-sm text-neutral-600">{m.auth_verify_pending()}</p>
          </Show>
          <Show when={status() === 'success'}>
            <p class="text-sm text-neutral-700">{m.auth_verify_success()}</p>
            <Link
              to="/$lang/auth/login"
              params={{ lang: params().lang }}
              class="inline-flex h-11 items-center justify-center rounded-md bg-[#00209F] text-white text-sm font-semibold hover:opacity-95 px-4"
            >
              {m.auth_verify_goLogin()}
            </Link>
          </Show>
          <Show when={status() === 'failure'}>
            <p class="text-sm text-[#D21034]">{m.auth_verify_failure()}</p>
            <Link
              to="/$lang/auth/login"
              params={{ lang: params().lang }}
              class="font-medium text-[#00209F] hover:underline text-sm"
            >
              {m.auth_verify_goLogin()}
            </Link>
          </Show>
        </div>
      </div>
    </main>
  )
}
