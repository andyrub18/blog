import { createFileRoute, Link } from '@tanstack/solid-router'
import { For, Show } from 'solid-js'
import LanguageSwitcher from '../../../../components/LanguageSwitcher'
import { LOCALE_LABELS } from '../../../../i18n'
import { fetchSubmissionQueue } from '../../../../lib/article-review-actions'
import { MIN_REVIEWERS } from '../../../../lib/deliberation'
import { SUBMISSION_STATUS_MESSAGE } from '../../../../lib/deliberation-messages'
import { m } from '../../../../paraglide/messages'

/**
 * Articles awaiting the circle.
 *
 * The loader's server function re-checks the role itself, which is the check
 * that actually matters. The card carries the panel's size and whether it has a
 * contradictor, because that is what a senior member decides on before opening
 * the article at all.
 */
export const Route = createFileRoute('/_app/review/articles/')({
  loader: () => fetchSubmissionQueue(),
  component: SubmissionQueue,
})

function languageName(code: string): string {
  return LOCALE_LABELS[code as keyof typeof LOCALE_LABELS] ?? code
}

function SubmissionQueue() {
  const queue = Route.useLoaderData()

  return (
    <main class="min-h-screen bg-neutral-50 px-4 py-12">
      <div class="mx-auto w-full max-w-3xl">
        <div class="mb-4 flex items-center justify-between gap-4">
          <h1 class="text-2xl font-bold text-neutral-900">{m.deliberation_title()}</h1>
          <LanguageSwitcher />
        </div>
        <p class="mb-2 text-sm text-neutral-600">{m.deliberation_subtitle()}</p>
        <Link
          to="/review"
          class="mb-6 inline-block text-sm text-[#00209F] hover:underline"
        >
          {m.review_title()} →
        </Link>

        <Show
          when={queue().length > 0}
          fallback={
            <p class="rounded-lg border border-neutral-200 bg-white p-6 text-sm text-neutral-600">
              {m.deliberation_empty()}
            </p>
          }
        >
          <ul class="flex flex-col gap-3">
            <For each={queue()}>
              {(card) => (
                <li class="rounded-lg border border-neutral-200 bg-white p-4">
                  <div class="flex items-start justify-between gap-4">
                    <div class="min-w-0">
                      <p class="truncate font-medium text-neutral-900">{card.title}</p>
                      <p class="mt-1 text-xs text-neutral-500">
                        {m.deliberation_by()} {card.authorName} ·{' '}
                        {m.deliberation_round({ round: card.round })} ·{' '}
                        {SUBMISSION_STATUS_MESSAGE[card.status]?.() ?? card.status}
                      </p>
                      <p class="mt-1 text-xs text-neutral-500">
                        {m.deliberation_languages()}:{' '}
                        {card.langs.map(languageName).join(', ')}
                      </p>
                      {/*
                       * The quorum, on the card. A panel that is short of
                       * reviewers, or has nobody assigned to argue against, is
                       * the thing to fix before anyone spends an evening
                       * reading the article.
                       */}
                      <p
                        class={
                          card.reviewers >= MIN_REVIEWERS && card.contradictors > 0
                            ? 'mt-1 text-xs text-[#1F6B45]'
                            : 'mt-1 text-xs text-amber-700'
                        }
                      >
                        {m.deliberation_quorum({
                          reviewers: card.reviewers,
                          contradictors: card.contradictors,
                        })}
                      </p>
                    </div>
                    <Link
                      to="/review/articles/$submissionId"
                      params={{ submissionId: card.submissionId }}
                      class="shrink-0 rounded-md bg-[#00209F] px-4 py-2 text-sm font-semibold text-white hover:opacity-95"
                    >
                      {m.deliberation_open()}
                    </Link>
                  </div>
                </li>
              )}
            </For>
          </ul>
        </Show>
      </div>
    </main>
  )
}
