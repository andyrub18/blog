import { createFileRoute, Link, useRouter } from '@tanstack/solid-router'
import { createSignal, For, Show } from 'solid-js'
import LanguageSwitcher from '../../../../components/LanguageSwitcher'
import { LOCALE_LABELS } from '../../../../i18n'
import {
  assignReviewerAction,
  decideSubmissionAction,
  fetchAssignableMembers,
  fetchSubmission,
  openDeliberationAction,
  recordVerdictAction,
  unassignReviewerAction,
} from '../../../../lib/article-review-actions'
import { MIN_REVIEWERS } from '../../../../lib/deliberation'
import {
  DELIBERATION_ERROR_MESSAGE,
  LANGUAGE_REASON_MESSAGE,
  METHOD_MESSAGE,
  OUTCOME_MESSAGE,
  SUBMISSION_STATUS_MESSAGE,
} from '../../../../lib/deliberation-messages'
import { m } from '../../../../paraglide/messages'

/**
 * One deliberation.
 *
 * Three audiences on one page, which is deliberate: the documentation a
 * reviewer reads, the verdicts everybody's argument is recorded in, and the
 * panel controls a senior member uses. Splitting them would hide the arguments
 * from the people making them, and the whole point of naming a contradictor is
 * that the disagreement is in the open.
 */
export const Route = createFileRoute('/_app/review/articles/$submissionId')({
  loader: async ({ params }) => {
    const [detail, assignable] = await Promise.all([
      fetchSubmission({ data: { submissionId: params.submissionId } }),
      fetchAssignableMembers({ data: { submissionId: params.submissionId } }).catch(
        // A member who is not senior may read the deliberation but has no
        // business with the panel list; an empty list simply hides the control.
        () => [],
      ),
    ])
    return { detail, assignable }
  },
  component: Deliberation,
})

function languageName(code: string): string {
  return LOCALE_LABELS[code as keyof typeof LOCALE_LABELS] ?? code
}

function Deliberation() {
  const data = Route.useLoaderData()
  const context = Route.useRouteContext()
  const router = useRouter()

  const [busy, setBusy] = createSignal<string | null>(null)
  const [error, setError] = createSignal('')
  const [rationales, setRationales] = createSignal<Record<string, string>>({})
  const [decisionRationale, setDecisionRationale] = createSignal('')
  const [unresolved, setUnresolved] = createSignal<'revision_requested' | 'rejected'>(
    'revision_requested',
  )
  const [stance, setStance] = createSignal<'contradictor' | 'reviewer'>('contradictor')
  const [candidate, setCandidate] = createSignal('')

  const detail = () => data().detail
  const viewer = () => context().user
  const isSenior = () =>
    viewer()?.role === 'senior_member' || viewer()?.role === 'super_admin'
  const myStance = () =>
    detail()?.reviewers.find((r) => r.userId === viewer()?.id)?.stance ?? null

  async function run(key: string, action: () => Promise<{ ok: boolean; code?: string }>) {
    setBusy(key)
    setError('')
    try {
      const result = await action()
      if (!result.ok) {
        setError(
          DELIBERATION_ERROR_MESSAGE[
            (result.code ?? 'UNEXPECTED') as keyof typeof DELIBERATION_ERROR_MESSAGE
          ]?.() ?? m.deliberation_errors_unexpected(),
        )
        return
      }
      await router.invalidate()
    } catch {
      setError(m.deliberation_errors_unexpected())
    } finally {
      setBusy(null)
    }
  }

  return (
    <main class="min-h-screen bg-neutral-50 px-4 py-12">
      <div class="mx-auto w-full max-w-3xl">
        <div class="mb-4 flex items-center justify-between gap-4">
          <Link to="/review/articles" class="text-sm text-[#00209F] hover:underline">
            ← {m.deliberation_title()}
          </Link>
          <LanguageSwitcher />
        </div>

        <Show
          when={detail()}
          fallback={
            <p class="rounded-lg border border-neutral-200 bg-white p-6 text-sm text-neutral-600">
              {m.deliberation_errors_notFound()}
            </p>
          }
        >
          {(loaded) => (
            <div class="flex flex-col gap-6">
              <header>
                <h1 class="text-2xl font-bold text-neutral-900">
                  {loaded().submission.slug}
                </h1>
                <p class="mt-1 text-sm text-neutral-600">
                  {m.deliberation_by()} {loaded().submission.authorName} ·{' '}
                  {m.deliberation_round({ round: loaded().submission.round })} ·{' '}
                  {SUBMISSION_STATUS_MESSAGE[loaded().submission.status]?.() ??
                    loaded().submission.status}
                </p>
                <p class="mt-1 text-sm text-neutral-600">
                  {m.deliberation_languages()}:{' '}
                  {loaded().submission.langs.map(languageName).join(', ')}
                </p>
              </header>

              {/* The five fields are the manifesto's admissibility test. */}
              <section class="rounded-lg border border-neutral-200 bg-white p-6">
                <h2 class="mb-4 text-lg font-semibold text-neutral-900">
                  {m.deliberation_documentation()}
                </h2>
                <dl class="flex flex-col gap-4 text-sm">
                  <For
                    each={[
                      [m.submit_diagnosisLabel(), loaded().submission.diagnosis],
                      [m.submit_solutionsLabel(), loaded().submission.solutions],
                      [m.submit_resourcesLabel(), loaded().submission.resources],
                      [m.submit_risksLabel(), loaded().submission.risks],
                      [m.submit_indicatorsLabel(), loaded().submission.indicators],
                    ]}
                  >
                    {(entry) => (
                      <div>
                        <dt class="font-medium text-neutral-800">{entry[0]}</dt>
                        <dd class="mt-1 whitespace-pre-wrap text-neutral-700">
                          {entry[1]}
                        </dd>
                      </div>
                    )}
                  </For>
                </dl>
              </section>

              <section class="rounded-lg border border-neutral-200 bg-white p-6">
                <h2 class="text-lg font-semibold text-neutral-900">
                  {m.deliberation_panel()}
                </h2>
                <p class="mt-1 mb-4 text-xs text-neutral-500">
                  {m.deliberation_panelHint()}
                </p>

                <ul class="flex flex-col gap-2 text-sm">
                  <For each={loaded().reviewers}>
                    {(reviewer) => (
                      <li class="flex items-center justify-between gap-3 rounded border border-neutral-200 px-3 py-2">
                        <span>
                          {reviewer.name}{' '}
                          <span
                            class={
                              reviewer.stance === 'contradictor'
                                ? 'rounded bg-[#A3261F] px-2 py-0.5 text-xs font-medium text-white'
                                : 'rounded bg-neutral-200 px-2 py-0.5 text-xs font-medium text-neutral-700'
                            }
                          >
                            {reviewer.stance === 'contradictor'
                              ? m.deliberation_stance_contradictor()
                              : m.deliberation_stance_reviewer()}
                          </span>
                        </span>
                        <Show
                          when={isSenior() && loaded().submission.status !== 'decided'}
                        >
                          <button
                            type="button"
                            disabled={busy() !== null}
                            onClick={() =>
                              void run(`unassign-${reviewer.userId}`, () =>
                                unassignReviewerAction({
                                  data: {
                                    submissionId: loaded().submission.id,
                                    userId: reviewer.userId,
                                  },
                                }),
                              )
                            }
                            class="shrink-0 text-xs text-[#A3261F] hover:underline disabled:opacity-60"
                          >
                            {m.deliberation_unassign()}
                          </button>
                        </Show>
                      </li>
                    )}
                  </For>
                </ul>

                <Show when={isSenior() && loaded().submission.status !== 'decided'}>
                  <div class="mt-4 flex flex-wrap items-end gap-2">
                    <label class="flex flex-col gap-1 text-sm">
                      <span class="font-medium text-neutral-800">
                        {m.deliberation_assign()}
                      </span>
                      <select
                        value={candidate()}
                        onChange={(e) => setCandidate(e.currentTarget.value)}
                        class="h-10 rounded-md border border-neutral-300 px-3"
                      >
                        <option value="">—</option>
                        <For each={data().assignable}>
                          {(person) => <option value={person.id}>{person.name}</option>}
                        </For>
                      </select>
                    </label>
                    <label class="flex flex-col gap-1 text-sm">
                      <span class="font-medium text-neutral-800">
                        {m.deliberation_stance_contradictor()} /{' '}
                        {m.deliberation_stance_reviewer()}
                      </span>
                      <select
                        value={stance()}
                        onChange={(e) =>
                          setStance(
                            e.currentTarget.value === 'reviewer'
                              ? 'reviewer'
                              : 'contradictor',
                          )
                        }
                        class="h-10 rounded-md border border-neutral-300 px-3"
                      >
                        <option value="contradictor">
                          {m.deliberation_stance_contradictor()}
                        </option>
                        <option value="reviewer">
                          {m.deliberation_stance_reviewer()}
                        </option>
                      </select>
                    </label>
                    <button
                      type="button"
                      disabled={busy() !== null || candidate() === ''}
                      onClick={() =>
                        void run('assign', () =>
                          assignReviewerAction({
                            data: {
                              submissionId: loaded().submission.id,
                              userId: candidate(),
                              stance: stance(),
                            },
                          }),
                        )
                      }
                      class="h-10 rounded-md bg-[#00209F] px-4 text-sm font-semibold text-white hover:opacity-95 disabled:opacity-60"
                    >
                      {busy() === 'assign'
                        ? m.deliberation_assigning()
                        : m.deliberation_assign()}
                    </button>
                  </div>

                  <Show when={loaded().submission.status === 'open'}>
                    <button
                      type="button"
                      disabled={
                        busy() !== null || loaded().reviewers.length < MIN_REVIEWERS
                      }
                      onClick={() =>
                        void run('open', () =>
                          openDeliberationAction({
                            data: { submissionId: loaded().submission.id },
                          }),
                        )
                      }
                      class="mt-4 h-10 rounded-md bg-[#1F6B45] px-4 text-sm font-semibold text-white hover:opacity-95 disabled:opacity-60"
                    >
                      {busy() === 'open'
                        ? m.deliberation_opening()
                        : m.deliberation_openDebate()}
                    </button>
                  </Show>
                </Show>
              </section>

              {/* Per language: the running tally, and what it would mean. */}
              <section class="rounded-lg border border-neutral-200 bg-white p-6">
                <h2 class="mb-4 text-lg font-semibold text-neutral-900">
                  {m.deliberation_tally()}
                </h2>
                <ul class="flex flex-col gap-3 text-sm">
                  <For each={loaded().tallies}>
                    {(tally) => (
                      <li class="rounded border border-neutral-200 p-3">
                        <p class="font-medium text-neutral-900">
                          {languageName(tally.lang)}
                        </p>
                        <p class="mt-1 text-neutral-700">
                          {m.deliberation_tallyLine({
                            supports: tally.supports,
                            objections: tally.objections,
                            abstentions: tally.abstentions,
                          })}
                        </p>
                        <p
                          class={
                            tally.accepted
                              ? 'mt-1 text-xs text-[#1F6B45]'
                              : 'mt-1 text-xs text-amber-700'
                          }
                        >
                          {tally.accepted
                            ? m.deliberation_wouldPass()
                            : m.deliberation_wouldNotPass()}{' '}
                          {LANGUAGE_REASON_MESSAGE[tally.reason]?.() ?? ''}
                        </p>
                      </li>
                    )}
                  </For>
                </ul>
              </section>

              {/* An assigned reviewer's own verdict, one per language. */}
              <Show when={myStance() && loaded().submission.status === 'in_review'}>
                <section class="rounded-lg border border-neutral-200 bg-white p-6">
                  <For each={loaded().submission.langs}>
                    {(lang) => (
                      <Show
                        when={
                          !loaded().verdicts.some(
                            (v) => v.lang === lang && v.reviewerId === viewer()?.id,
                          )
                        }
                      >
                        <div class="mb-6 last:mb-0">
                          <h2 class="text-sm font-semibold text-neutral-900">
                            {m.deliberation_yourVerdict({ language: languageName(lang) })}
                          </h2>
                          <label class="mt-2 flex flex-col gap-1 text-sm">
                            <span class="text-xs text-neutral-500">
                              {m.deliberation_rationaleHint()}
                            </span>
                            {/* Uncontrolled: see the note in routes/_app/write/index.tsx. */}
                            <textarea
                              rows="3"
                              name={`rationale-${lang}`}
                              onInput={(e) =>
                                setRationales((prev) => ({
                                  ...prev,
                                  [lang]: e.currentTarget.value,
                                }))
                              }
                              class="rounded-md border border-neutral-300 px-3 py-2 outline-none focus:border-[#00209F] focus:ring-2 focus:ring-[#00209F]/20"
                            />
                          </label>
                          <div class="mt-2 flex flex-wrap gap-2">
                            <For
                              each={
                                [
                                  ['support', m.deliberation_verdict_support()],
                                  ['object', m.deliberation_verdict_object()],
                                  ['abstain', m.deliberation_verdict_abstain()],
                                ] as const
                              }
                            >
                              {(option) => (
                                <button
                                  type="button"
                                  disabled={busy() !== null}
                                  onClick={() =>
                                    void run(`verdict-${lang}`, () =>
                                      recordVerdictAction({
                                        data: {
                                          submissionId: loaded().submission.id,
                                          lang,
                                          verdict: option[0],
                                          rationale: rationales()[lang] ?? '',
                                        },
                                      }),
                                    )
                                  }
                                  class="h-10 rounded-md border border-neutral-300 px-4 text-sm font-semibold text-neutral-800 hover:bg-neutral-50 disabled:opacity-60"
                                >
                                  {option[1]}
                                </button>
                              )}
                            </For>
                          </div>
                        </div>
                      </Show>
                    )}
                  </For>
                </section>
              </Show>

              {/* Every verdict, named. Attributable by design. */}
              <section class="rounded-lg border border-neutral-200 bg-white p-6">
                <h2 class="mb-4 text-lg font-semibold text-neutral-900">
                  {m.deliberation_verdicts()}
                </h2>
                <Show
                  when={loaded().verdicts.length > 0}
                  fallback={
                    <p class="text-sm text-neutral-600">{m.deliberation_noVerdicts()}</p>
                  }
                >
                  <ul class="flex flex-col gap-3 text-sm">
                    <For each={loaded().verdicts}>
                      {(verdict) => (
                        <li class="rounded border border-neutral-200 p-3">
                          <p class="font-medium text-neutral-900">
                            {verdict.reviewerName} · {languageName(verdict.lang)} ·{' '}
                            {verdict.verdict === 'support'
                              ? m.deliberation_verdict_support()
                              : verdict.verdict === 'object'
                                ? m.deliberation_verdict_object()
                                : m.deliberation_verdict_abstain()}
                          </p>
                          <p class="mt-1 whitespace-pre-wrap text-neutral-700">
                            {verdict.rationale}
                          </p>
                        </li>
                      )}
                    </For>
                  </ul>
                </Show>
              </section>

              <Show when={loaded().decision}>
                {(decision) => (
                  <section class="rounded-lg border border-green-200 bg-green-50 p-6">
                    <h2 class="text-lg font-semibold text-green-900">
                      {m.deliberation_decision()}
                    </h2>
                    <p class="mt-1 text-sm text-green-900">
                      {OUTCOME_MESSAGE[decision().outcome]?.() ?? decision().outcome}{' '}
                      {METHOD_MESSAGE[decision().method]?.() ?? ''} ·{' '}
                      {m.deliberation_decidedOn()}{' '}
                      {new Date(decision().decidedAt).toLocaleDateString()}
                    </p>
                    <p class="mt-2 whitespace-pre-wrap text-sm text-green-900">
                      {decision().tallyJson.rationale}
                    </p>
                  </section>
                )}
              </Show>

              <Show when={isSenior() && loaded().submission.status === 'in_review'}>
                <section class="rounded-lg border border-neutral-200 bg-white p-6">
                  <h2 class="text-lg font-semibold text-neutral-900">
                    {m.deliberation_decide()}
                  </h2>
                  <p class="mt-1 mb-4 text-xs text-neutral-500">
                    {m.deliberation_decideHint()}
                  </p>
                  <label class="flex flex-col gap-1 text-sm">
                    <span class="font-medium text-neutral-800">
                      {m.deliberation_rationaleLabel()}
                    </span>
                    {/* Uncontrolled: see the note in routes/_app/write/index.tsx. */}
                    <textarea
                      rows="3"
                      name="decisionRationale"
                      onInput={(e) => setDecisionRationale(e.currentTarget.value)}
                      class="rounded-md border border-neutral-300 px-3 py-2 outline-none focus:border-[#00209F] focus:ring-2 focus:ring-[#00209F]/20"
                    />
                  </label>
                  <label class="mt-3 flex flex-col gap-1 text-sm">
                    <span class="font-medium text-neutral-800">
                      {m.deliberation_unresolvedLabel()}
                    </span>
                    <select
                      value={unresolved()}
                      onChange={(e) =>
                        setUnresolved(
                          e.currentTarget.value === 'rejected'
                            ? 'rejected'
                            : 'revision_requested',
                        )
                      }
                      class="h-10 rounded-md border border-neutral-300 px-3"
                    >
                      <option value="revision_requested">
                        {m.deliberation_unresolved_revision()}
                      </option>
                      <option value="rejected">
                        {m.deliberation_unresolved_rejected()}
                      </option>
                    </select>
                  </label>
                  <button
                    type="button"
                    disabled={busy() !== null}
                    onClick={() =>
                      void run('decide', () =>
                        decideSubmissionAction({
                          data: {
                            submissionId: loaded().submission.id,
                            rationale: decisionRationale(),
                            unresolved: unresolved(),
                          },
                        }),
                      )
                    }
                    class="mt-4 h-10 rounded-md bg-[#00209F] px-4 text-sm font-semibold text-white hover:opacity-95 disabled:opacity-60"
                  >
                    {busy() === 'decide'
                      ? m.deliberation_deciding()
                      : m.deliberation_decide()}
                  </button>
                </section>
              </Show>

              <div aria-live="polite" class="min-h-5 text-sm">
                <Show when={error()}>
                  {(message) => <p class="text-[#A3261F]">{message()}</p>}
                </Show>
              </div>
            </div>
          )}
        </Show>
      </div>
    </main>
  )
}
