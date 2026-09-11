import { createFileRoute, Link } from '@tanstack/solid-router'
import { For, Show } from 'solid-js'
import LanguageSwitcher from '../../../components/LanguageSwitcher'
import { fetchReviewQueue } from '../../../lib/review-actions'
import { m } from '../../../paraglide/messages'

export const Route = createFileRoute('/_app/review/')({
  // The loader's server function re-checks the role itself, which is the check
  // that actually matters; a non-reviewer simply gets an error rather than a
  // page they cannot use.
  loader: () => fetchReviewQueue(),
  component: ReviewQueue,
})

function ReviewQueue() {
  const queue = Route.useLoaderData()

  return (
    <main class="min-h-screen bg-neutral-50 px-4 py-12">
      <div class="mx-auto w-full max-w-3xl">
        <div class="mb-4 flex items-center justify-between gap-4">
          <h1 class="text-2xl font-bold text-neutral-900">{m.review_title()}</h1>
          <LanguageSwitcher />
        </div>
        <p class="mb-6 text-sm text-neutral-600">{m.review_subtitle()}</p>

        <Show
          when={queue().length > 0}
          fallback={
            <p class="rounded-lg border border-neutral-200 bg-white p-6 text-sm text-neutral-600">
              {m.review_empty()}
            </p>
          }
        >
          <ul class="flex flex-col gap-2">
            <For each={queue()}>
              {(item) => (
                <li class="flex items-center justify-between gap-4 rounded-lg border border-neutral-200 bg-white p-4">
                  <div class="min-w-0">
                    <p class="truncate font-medium text-neutral-900">
                      {item.applicantName}
                    </p>
                    <p class="truncate text-sm text-neutral-600">{item.applicantEmail}</p>
                    <p class="mt-1 text-xs text-neutral-500">
                      {m.review_submittedOn()}{' '}
                      {new Date(item.submittedAt).toLocaleDateString()} ·{' '}
                      {m.review_status()}: {item.status}
                    </p>
                  </div>
                  <Link
                    to="/review/$applicationId"
                    params={{ applicationId: item.applicationId }}
                    class="shrink-0 rounded-md bg-[#00209F] px-4 py-2 text-sm font-semibold text-white hover:opacity-95"
                  >
                    {m.review_open()}
                  </Link>
                </li>
              )}
            </For>
          </ul>
        </Show>
      </div>
    </main>
  )
}
