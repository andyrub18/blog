import { createFileRoute, Link } from '@tanstack/solid-router'
import { createSignal, For, Show } from 'solid-js'
import LanguageSwitcher from '../../../components/LanguageSwitcher'
import {
  fetchNominations,
  voteOnNomination,
  withdrawNomination,
} from '../../../lib/governance-actions'
import { GOVERNANCE_ERROR_MESSAGE } from '../../../lib/governance-messages'
import { m } from '../../../paraglide/messages'

export const Route = createFileRoute('/_app/review/promotions')({
  loader: () => fetchNominations(),
  component: Promotions,
})

type Settled = { outcome: 'open' | 'approved' | 'rejected' } | { outcome: 'withdrawn' }

function Promotions() {
  const nominations = Route.useLoaderData()
  const [rationales, setRationales] = createSignal<Record<string, string>>({})
  const [busy, setBusy] = createSignal<string | null>(null)
  const [errors, setErrors] = createSignal<Record<string, string>>({})
  const [settled, setSettled] = createSignal<Record<string, Settled>>({})

  async function vote(promotionId: string, choice: 'approve' | 'reject') {
    setBusy(promotionId)
    setErrors((prev) => ({ ...prev, [promotionId]: '' }))
    try {
      const result = await voteOnNomination({
        data: {
          promotionId,
          vote: choice,
          rationale: rationales()[promotionId] ?? '',
        },
      })
      if (!result.ok) {
        setErrors((prev) => ({
          ...prev,
          [promotionId]: GOVERNANCE_ERROR_MESSAGE[result.code](),
        }))
        return
      }
      setSettled((prev) => ({ ...prev, [promotionId]: { outcome: result.outcome } }))
    } catch {
      setErrors((prev) => ({ ...prev, [promotionId]: m.review_errors_unexpected() }))
    } finally {
      setBusy(null)
    }
  }

  async function withdrawOne(promotionId: string) {
    setBusy(promotionId)
    try {
      const result = await withdrawNomination({ data: { promotionId } })
      if (!result.ok) {
        setErrors((prev) => ({
          ...prev,
          [promotionId]: GOVERNANCE_ERROR_MESSAGE[result.code](),
        }))
        return
      }
      setSettled((prev) => ({ ...prev, [promotionId]: { outcome: 'withdrawn' } }))
    } finally {
      setBusy(null)
    }
  }

  return (
    <main class="min-h-screen bg-neutral-50 px-4 py-12">
      <div class="mx-auto w-full max-w-3xl">
        <div class="mb-4 flex items-center justify-between gap-4">
          <h1 class="text-2xl font-bold text-neutral-900">{m.promotions_title()}</h1>
          <LanguageSwitcher />
        </div>
        <p class="mb-2 text-sm text-neutral-600">{m.promotions_subtitle()}</p>
        <p class="mb-4 text-sm font-medium text-neutral-800">
          {m.promotions_threshold()}
        </p>
        <Link
          to="/review/members"
          class="mb-6 inline-block text-sm text-[#00209F] hover:underline"
        >
          {m.roster_title()} →
        </Link>

        <Show
          when={nominations().length > 0}
          fallback={
            <p class="rounded-lg border border-neutral-200 bg-white p-6 text-sm text-neutral-600">
              {m.promotions_empty()}
            </p>
          }
        >
          <ul class="flex flex-col gap-4">
            <For each={nominations()}>
              {(item) => (
                <li class="rounded-lg border border-neutral-200 bg-white p-6">
                  <p class="font-medium text-neutral-900">{item.subjectName}</p>
                  <p class="text-sm text-neutral-600">{item.subjectEmail}</p>
                  <p class="mt-1 text-xs text-neutral-500">
                    {m.promotions_openedBy()} ·{' '}
                    {new Date(item.openedAt).toLocaleDateString()}
                  </p>
                  <p class="mt-3 whitespace-pre-wrap text-sm text-neutral-700">
                    {item.rationale}
                  </p>
                  <p class="mt-3 text-sm font-medium text-neutral-800">
                    {m.promotions_tally({
                      approvals: item.tally.approvals,
                      rejections: item.tally.rejections,
                      electorate: item.tally.electorate,
                    })}
                  </p>

                  <Show
                    when={!settled()[item.promotionId]}
                    fallback={
                      <p class="mt-4 rounded-md border border-green-200 bg-green-50 p-3 text-sm text-green-900">
                        {settled()[item.promotionId]?.outcome === 'approved' &&
                          m.promotions_outcomeApproved()}
                        {settled()[item.promotionId]?.outcome === 'rejected' &&
                          m.promotions_outcomeRejected()}
                        {settled()[item.promotionId]?.outcome === 'open' &&
                          m.promotions_outcomeOpen()}
                        {settled()[item.promotionId]?.outcome === 'withdrawn' &&
                          m.promotions_withdraw()}
                      </p>
                    }
                  >
                    <Show
                      when={!item.myVote}
                      fallback={
                        <p class="mt-4 text-sm text-neutral-700">
                          {item.myVote === 'approve'
                            ? m.promotions_yourVoteApprove()
                            : m.promotions_yourVoteReject()}
                        </p>
                      }
                    >
                      <label class="mt-4 flex flex-col gap-1 text-sm">
                        <span class="font-medium text-neutral-800">
                          {m.promotions_rationaleLabel()}
                        </span>
                        <span class="text-xs text-neutral-500">
                          {m.promotions_rationaleHint()}
                        </span>
                        {/*
                         * No `value` binding, deliberately. Solid's SSR writes a textarea's value
                         * as a child text node while the client template has none, so the two sides
                         * end up one node apart and hydration detaches everything after it in the
                         * tree — rendered, visible and completely inert. The field is uncontrolled
                         * and read through `onInput`. See CLAUDE.md.
                         */}
                        <textarea
                          rows="3"
                          name={`rationale-${item.promotionId}`}
                          onInput={(e) =>
                            setRationales((prev) => ({
                              ...prev,
                              [item.promotionId]: e.currentTarget.value,
                            }))
                          }
                          class="rounded-md border border-neutral-300 px-3 py-2 outline-none focus:border-[#00209F] focus:ring-2 focus:ring-[#00209F]/20"
                        />
                      </label>

                      <div class="mt-3 flex flex-wrap gap-2">
                        <button
                          type="button"
                          disabled={busy() === item.promotionId}
                          onClick={() => void vote(item.promotionId, 'approve')}
                          class="h-10 rounded-md bg-[#1F6B45] px-4 text-sm font-semibold text-white hover:opacity-95 disabled:opacity-60"
                        >
                          {busy() === item.promotionId
                            ? m.promotions_voting()
                            : m.promotions_approve()}
                        </button>
                        <button
                          type="button"
                          disabled={busy() === item.promotionId}
                          onClick={() => void vote(item.promotionId, 'reject')}
                          class="h-10 rounded-md bg-[#A3261F] px-4 text-sm font-semibold text-white hover:opacity-95 disabled:opacity-60"
                        >
                          {m.promotions_reject()}
                        </button>
                        <button
                          type="button"
                          disabled={busy() === item.promotionId}
                          onClick={() => void withdrawOne(item.promotionId)}
                          class="h-10 rounded-md border border-neutral-300 px-4 text-sm font-semibold text-neutral-800 hover:bg-neutral-50 disabled:opacity-60"
                        >
                          {m.promotions_withdraw()}
                        </button>
                      </div>
                    </Show>

                    <div aria-live="polite" class="mt-3 min-h-5 text-sm">
                      <Show when={errors()[item.promotionId]}>
                        {(message) => <p class="text-[#A3261F]">{message()}</p>}
                      </Show>
                    </div>
                  </Show>
                </li>
              )}
            </For>
          </ul>
        </Show>
      </div>
    </main>
  )
}
