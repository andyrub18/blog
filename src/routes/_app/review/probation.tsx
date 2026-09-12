import { createFileRoute, Link } from '@tanstack/solid-router'
import { createSignal, For, Show } from 'solid-js'
import LanguageSwitcher from '../../../components/LanguageSwitcher'
import { decideProbation, fetchProbationDue } from '../../../lib/review-actions'
import { REVIEW_ERROR_MESSAGE } from '../../../lib/review-messages'
import { m } from '../../../paraglide/messages'

export const Route = createFileRoute('/_app/review/probation')({
  // As with the queue, the loader's server function re-checks the role itself.
  loader: () => fetchProbationDue(),
  component: ProbationQueue,
})

function ProbationQueue() {
  const due = Route.useLoaderData()
  const [rationales, setRationales] = createSignal<Record<string, string>>({})
  const [busy, setBusy] = createSignal<string | null>(null)
  const [errors, setErrors] = createSignal<Record<string, string>>({})
  const [settled, setSettled] = createSignal<Record<string, 'confirm' | 'revert'>>({})

  async function decide(userId: string, decision: 'confirm' | 'revert') {
    setBusy(userId)
    setErrors((prev) => ({ ...prev, [userId]: '' }))
    try {
      const result = await decideProbation({
        data: { userId, decision, rationale: rationales()[userId] ?? '' },
      })
      if (!result.ok) {
        setErrors((prev) => ({ ...prev, [userId]: REVIEW_ERROR_MESSAGE[result.code]() }))
        return
      }
      setSettled((prev) => ({ ...prev, [userId]: decision }))
    } catch {
      setErrors((prev) => ({ ...prev, [userId]: m.review_errors_unexpected() }))
    } finally {
      setBusy(null)
    }
  }

  return (
    <main class="min-h-screen bg-neutral-50 px-4 py-12">
      <div class="mx-auto w-full max-w-3xl">
        <div class="mb-4 flex items-center justify-between gap-4">
          <h1 class="text-2xl font-bold text-neutral-900">{m.probation_title()}</h1>
          <LanguageSwitcher />
        </div>
        <p class="mb-2 text-sm text-neutral-600">{m.probation_subtitle()}</p>
        <Link
          to="/review"
          class="mb-6 inline-block text-sm text-[#00209F] hover:underline"
        >
          {m.probation_openQueue()} →
        </Link>

        <Show
          when={due().length > 0}
          fallback={
            <p class="rounded-lg border border-neutral-200 bg-white p-6 text-sm text-neutral-600">
              {m.probation_empty()}
            </p>
          }
        >
          <ul class="flex flex-col gap-4">
            <For each={due()}>
              {(item) => (
                <li class="rounded-lg border border-neutral-200 bg-white p-6">
                  <p class="font-medium text-neutral-900">{item.name}</p>
                  <p class="text-sm text-neutral-600">{item.email}</p>
                  <p class="mt-1 text-xs text-neutral-500">
                    {m.probation_memberSince()}{' '}
                    {item.memberSince
                      ? new Date(item.memberSince).toLocaleDateString()
                      : '—'}{' '}
                    · {m.probation_dueSince()}{' '}
                    {item.probationUntil
                      ? new Date(item.probationUntil).toLocaleDateString()
                      : '—'}
                  </p>

                  <h2 class="mt-4 mb-1 text-sm font-semibold text-neutral-900">
                    {m.probation_plan()}
                  </h2>
                  <Show
                    when={item.contributionPlan}
                    fallback={
                      <p class="text-sm text-neutral-500">{m.probation_planMissing()}</p>
                    }
                  >
                    {(plan) => (
                      <p class="whitespace-pre-wrap text-sm text-neutral-700">{plan()}</p>
                    )}
                  </Show>

                  <Show
                    when={!settled()[item.userId]}
                    fallback={
                      <p class="mt-4 rounded-md border border-green-200 bg-green-50 p-3 text-sm text-green-900">
                        {settled()[item.userId] === 'confirm'
                          ? m.probation_confirmed()
                          : m.probation_reverted()}
                      </p>
                    }
                  >
                    <p class="mt-4 text-sm font-medium text-neutral-800">
                      {m.probation_question()}
                    </p>
                    <label class="mt-2 flex flex-col gap-1 text-sm">
                      <span class="font-medium text-neutral-800">
                        {m.probation_rationaleLabel()}
                      </span>
                      <span class="text-xs text-neutral-500">
                        {m.probation_rationaleHint()}
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
                        name={`rationale-${item.userId}`}
                        onInput={(e) =>
                          setRationales((prev) => ({
                            ...prev,
                            [item.userId]: e.currentTarget.value,
                          }))
                        }
                        class="rounded-md border border-neutral-300 px-3 py-2 outline-none focus:border-[#00209F] focus:ring-2 focus:ring-[#00209F]/20"
                      />
                    </label>

                    <div class="mt-3 flex flex-wrap gap-2">
                      <button
                        type="button"
                        disabled={busy() === item.userId}
                        onClick={() => void decide(item.userId, 'confirm')}
                        class="h-10 rounded-md bg-[#1F6B45] px-4 text-sm font-semibold text-white hover:opacity-95 disabled:opacity-60"
                      >
                        {busy() === item.userId
                          ? m.probation_deciding()
                          : m.probation_confirm()}
                      </button>
                      <button
                        type="button"
                        disabled={busy() === item.userId}
                        onClick={() => void decide(item.userId, 'revert')}
                        class="h-10 rounded-md bg-[#A3261F] px-4 text-sm font-semibold text-white hover:opacity-95 disabled:opacity-60"
                      >
                        {m.probation_revert()}
                      </button>
                    </div>

                    <div aria-live="polite" class="mt-3 min-h-5 text-sm">
                      <Show when={errors()[item.userId]}>
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
