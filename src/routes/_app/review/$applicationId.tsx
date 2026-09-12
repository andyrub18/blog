import { createFileRoute, Link } from '@tanstack/solid-router'
import { createSignal, For, Show } from 'solid-js'
import LanguageSwitcher from '../../../components/LanguageSwitcher'
import { decideApplication, fetchApplication } from '../../../lib/review-actions'
import { REVIEW_ERROR_MESSAGE } from '../../../lib/review-messages'
import { m } from '../../../paraglide/messages'

export const Route = createFileRoute('/_app/review/$applicationId')({
  loader: ({ params }) =>
    fetchApplication({ data: { applicationId: params.applicationId } }),
  component: ReviewDetail,
})

function ReviewDetail() {
  const data = Route.useLoaderData()
  const params = Route.useParams()
  const [rationale, setRationale] = createSignal('')
  const [busy, setBusy] = createSignal(false)
  const [error, setError] = createSignal<string | null>(null)
  const [done, setDone] = createSignal(false)

  async function decide(decision: 'approve' | 'reject' | 'request_more_info') {
    setBusy(true)
    setError(null)
    try {
      const result = await decideApplication({
        data: {
          applicationId: params().applicationId,
          decision,
          rationale: rationale(),
        },
      })
      if (!result.ok) {
        setError(REVIEW_ERROR_MESSAGE[result.code]())
        return
      }
      setDone(true)
    } catch {
      setError(m.review_errors_unexpected())
    } finally {
      setBusy(false)
    }
  }

  const fileHref = (field: string) => `/api/dossier/${params().applicationId}/${field}`

  return (
    <main class="min-h-screen bg-neutral-50 px-4 py-12">
      <div class="mx-auto w-full max-w-2xl">
        <div class="mb-6 flex items-center justify-between gap-4">
          <Link to="/review" class="text-sm text-[#00209F] hover:underline">
            ← {m.review_backToQueue()}
          </Link>
          <LanguageSwitcher />
        </div>

        <Show when={data()} fallback={<p>{m.review_errors_notFound()}</p>}>
          {(loaded) => (
            <div class="flex flex-col gap-6">
              <section class="rounded-lg border border-neutral-200 bg-white p-6">
                <h1 class="text-xl font-bold text-neutral-900">
                  {loaded().application.applicantName}
                </h1>
                <p class="text-sm text-neutral-600">
                  {loaded().application.applicantEmail}
                </p>
                <p class="mt-1 text-xs text-neutral-500">
                  {m.review_status()}: {loaded().application.status}
                </p>
              </section>

              <section class="rounded-lg border border-neutral-200 bg-white p-6">
                <h2 class="mb-2 font-semibold text-neutral-900">{m.review_plan()}</h2>
                <p class="whitespace-pre-wrap text-sm text-neutral-700">
                  {loaded().application.contributionPlan}
                </p>
              </section>

              <section class="rounded-lg border border-neutral-200 bg-white p-6">
                <h2 class="mb-3 font-semibold text-neutral-900">{m.review_dossier()}</h2>
                <ul class="flex flex-col gap-2 text-sm">
                  <li>
                    <a href={fileHref('cv')} class="text-[#00209F] hover:underline">
                      {m.review_downloadCv()}
                    </a>
                  </li>
                  <li>
                    <a href={fileHref('vision')} class="text-[#00209F] hover:underline">
                      {m.review_downloadVision()}
                    </a>
                  </li>
                  <li>
                    <a
                      href={fileHref('contribution')}
                      class="text-[#00209F] hover:underline"
                    >
                      {m.review_downloadContribution()}
                    </a>
                  </li>
                </ul>
                <p class="mt-3 text-xs text-neutral-500">{m.review_downloadNote()}</p>
              </section>

              <section class="rounded-lg border border-neutral-200 bg-white p-6">
                <h2 class="mb-3 font-semibold text-neutral-900">{m.review_history()}</h2>
                <ul class="flex flex-col gap-2 text-sm text-neutral-700">
                  <For each={loaded().history}>
                    {(event) => (
                      <li>
                        <span class="font-medium">{event.toStatus}</span>
                        <Show when={event.rationale}>
                          {(why) => <span class="text-neutral-600"> — {why()}</span>}
                        </Show>
                        <span class="block text-xs text-neutral-500">
                          {new Date(event.createdAt).toLocaleString()}
                        </span>
                      </li>
                    )}
                  </For>
                </ul>
              </section>

              <Show
                when={!done()}
                fallback={
                  <p class="rounded-lg border border-green-200 bg-green-50 p-4 text-sm text-green-900">
                    {m.review_decided()}
                  </p>
                }
              >
                <section class="rounded-lg border border-neutral-200 bg-white p-6">
                  <h2 class="mb-3 font-semibold text-neutral-900">
                    {m.review_decision()}
                  </h2>
                  <label class="flex flex-col gap-1 text-sm">
                    <span class="font-medium text-neutral-800">
                      {m.review_rationaleLabel()}
                    </span>
                    <span class="text-xs text-neutral-500">
                      {m.review_rationaleHint()}
                    </span>
                    {/*
                     * No `value` binding, deliberately. Solid's SSR writes a textarea's value
                     * as a child text node while the client template has none, so the two sides
                     * end up one node apart and hydration detaches everything after it in the
                     * tree — rendered, visible and completely inert. The field is uncontrolled
                     * and read through `onInput`. See CLAUDE.md.
                     */}
                    <textarea
                      rows="4"
                      onInput={(e) => setRationale(e.currentTarget.value)}
                      class="rounded-md border border-neutral-300 px-3 py-2 outline-none focus:border-[#00209F] focus:ring-2 focus:ring-[#00209F]/20"
                    />
                  </label>

                  <div class="mt-4 flex flex-wrap gap-2">
                    <button
                      type="button"
                      disabled={busy()}
                      onClick={() => void decide('approve')}
                      class="h-10 rounded-md bg-[#1F6B45] px-4 text-sm font-semibold text-white hover:opacity-95 disabled:opacity-60"
                    >
                      {busy() ? m.review_deciding() : m.review_approve()}
                    </button>
                    <button
                      type="button"
                      disabled={busy()}
                      onClick={() => void decide('request_more_info')}
                      class="h-10 rounded-md border border-neutral-300 px-4 text-sm font-semibold text-neutral-800 hover:bg-neutral-50 disabled:opacity-60"
                    >
                      {m.review_requestInfo()}
                    </button>
                    <button
                      type="button"
                      disabled={busy()}
                      onClick={() => void decide('reject')}
                      class="h-10 rounded-md bg-[#A3261F] px-4 text-sm font-semibold text-white hover:opacity-95 disabled:opacity-60"
                    >
                      {m.review_reject()}
                    </button>
                  </div>

                  <div aria-live="polite" class="mt-3 min-h-5 text-sm">
                    <Show when={error()}>
                      {(message) => <p class="text-[#A3261F]">{message()}</p>}
                    </Show>
                  </div>
                </section>
              </Show>
            </div>
          )}
        </Show>
      </div>
    </main>
  )
}
