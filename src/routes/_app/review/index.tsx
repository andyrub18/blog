import { createFileRoute, Link } from '@tanstack/solid-router'
import { For, Show } from 'solid-js'
import { fetchReviewQueue } from '../../../lib/membership/review-actions'
import { m } from '../../../paraglide/messages'
import { getLocale } from '../../../paraglide/runtime'

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
    <main class="flex-1 bg-neutral-50 px-4 py-12">
      <div class="mx-auto w-full max-w-5xl">
        <h1 class="font-serif text-4xl font-bold">{m.review_title()}</h1>

        {/* Said where the reviewer works, because it is true and it is the
            point: an applicant can be told who opened their file, and when
            (lib/membership/dossier.ts). */}
        <p class="mt-6 flex gap-3 rounded-xl border border-accent-line bg-accent-soft p-4 text-[15px] leading-relaxed">
          <svg
            aria-hidden="true"
            width="22"
            height="22"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            class="mt-0.5 shrink-0 text-accent"
          >
            <rect x="4" y="11" width="16" height="10" rx="2" />
            <path d="M8 11V7a4 4 0 0 1 8 0v4" />
          </svg>
          {m.review_accessLogged()}
        </p>

        <div class="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <Area
            to="/review/articles"
            title={m.deliberation_title()}
            text={m.deliberation_subtitle()}
          />
          <Area
            to="/review/probation"
            title={m.probation_title()}
            text={m.probation_subtitle()}
          />
          <Area
            to="/review/promotions"
            title={m.promotions_title()}
            text={m.promotions_subtitle()}
          />
          <Area
            to="/review/members"
            title={m.roster_title()}
            text={m.roster_subtitle()}
          />
          <Area
            to="/review/invitations"
            title={m.invitations_title()}
            text={m.invitations_subtitle()}
          />
        </div>

        <h2 class="mt-10 mb-4 font-serif text-2xl font-bold">{m.review_subtitle()}</h2>

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
                      {new Date(item.submittedAt).toLocaleDateString(getLocale())} ·{' '}
                      {m.review_status()}: {item.status}
                    </p>
                  </div>
                  <Link
                    to="/review/$applicationId"
                    params={{ applicationId: item.applicationId }}
                    class="inline-flex min-h-11 shrink-0 items-center rounded-lg bg-accent px-4 font-semibold text-on-accent hover:bg-accent-hover"
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

function Area(props: {
  to:
    | '/review/articles'
    | '/review/probation'
    | '/review/promotions'
    | '/review/members'
    | '/review/invitations'
  title: string
  text: string
}) {
  return (
    <Link
      to={props.to}
      class="flex flex-col gap-2 rounded-xl border border-line bg-raised p-5 hover:border-accent-line"
    >
      <span class="font-bold text-ink">{props.title} →</span>
      <span class="text-sm leading-relaxed text-ink-soft">{props.text}</span>
    </Link>
  )
}
