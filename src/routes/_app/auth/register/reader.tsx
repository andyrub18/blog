import { createFileRoute, Link } from '@tanstack/solid-router'
import { createServerFn } from '@tanstack/solid-start'
import RegisterReaderForm from '../../../../components/auth/RegisterReaderForm'
import { m } from '../../../../paraglide/messages'

const ensureGuest = createServerFn({ method: 'GET' }).handler(async () => {
  const { redirectIfAuthenticated } = await import('../../../../lib/auth/session.server')

  await redirectIfAuthenticated()
})

export const Route = createFileRoute('/_app/auth/register/reader')({
  beforeLoad: () => ensureGuest(),
  component: RegisterReaderPage,
})

function RegisterReaderPage() {
  return (
    <main class="flex-1 flex items-center justify-center bg-surface px-4 py-12">
      <div class="w-full max-w-md">
        <div class="flex flex-col items-center gap-2 mb-6 text-center">
          <h1 class="font-serif text-3xl font-bold text-neutral-900">
            {m.auth_register_reader_title()}
          </h1>
          <p class="text-sm text-neutral-600 max-w-xs">
            {m.auth_register_reader_subtitle()}
          </p>
        </div>
        <div class="bg-white border border-neutral-200 rounded-xl shadow-sm p-6 sm:p-8">
          <RegisterReaderForm />
        </div>
        <p class="mt-6 text-center text-sm text-neutral-600">
          {m.auth_register_common_haveAccount()}{' '}
          <Link to="/auth/login" class="font-medium text-accent hover:underline">
            {m.auth_register_common_signIn()}
          </Link>
        </p>
      </div>
    </main>
  )
}
