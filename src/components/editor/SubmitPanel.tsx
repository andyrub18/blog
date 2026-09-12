import { Link } from '@tanstack/solid-router'
import { createSignal, For, Show } from 'solid-js'
import { LOCALE_LABELS } from '../../i18n'
import { submitArticleForReview } from '../../lib/article-review-actions'
import type { Documentation } from '../../lib/deliberation'
import {
  DELIBERATION_ERROR_MESSAGE,
  OUTCOME_MESSAGE,
  SUBMISSION_STATUS_MESSAGE,
} from '../../lib/deliberation-messages'
import { m } from '../../paraglide/messages'

/**
 * Putting an article to the circle.
 *
 * The five fields are the manifesto's admissibility test, not a form we
 * invented: a proposal states its diagnosis, the solutions considered, the
 * resources required, the risks identified and how success will be measured.
 * They are laid out with their hints because the hints are the standard — an
 * author who reads them knows what the contradictor is going to look for.
 */

type Round = {
  submissionId: string
  round: number
  status: string
  langs: Array<string>
  outcome: string | null
}

type Props = {
  articleId: string
  /** Languages of this article that actually have text in them. */
  writtenLangs: Array<string>
  rounds: Array<Round>
  onSubmitted: () => void | Promise<void>
}

const FIELDS: Array<{
  key: keyof Documentation
  label: () => string
  hint: () => string
}> = [
  {
    key: 'diagnosis',
    label: () => m.submit_diagnosisLabel(),
    hint: () => m.submit_diagnosisHint(),
  },
  {
    key: 'solutions',
    label: () => m.submit_solutionsLabel(),
    hint: () => m.submit_solutionsHint(),
  },
  {
    key: 'resources',
    label: () => m.submit_resourcesLabel(),
    hint: () => m.submit_resourcesHint(),
  },
  { key: 'risks', label: () => m.submit_risksLabel(), hint: () => m.submit_risksHint() },
  {
    key: 'indicators',
    label: () => m.submit_indicatorsLabel(),
    hint: () => m.submit_indicatorsHint(),
  },
]

function languageName(code: string): string {
  return LOCALE_LABELS[code as keyof typeof LOCALE_LABELS] ?? code
}

export default function SubmitPanel(props: Props) {
  const [documentation, setDocumentation] = createSignal<Documentation>({
    diagnosis: '',
    solutions: '',
    resources: '',
    risks: '',
    indicators: '',
  })
  const [langs, setLangs] = createSignal<Array<string>>([])
  const [busy, setBusy] = createSignal(false)
  const [error, setError] = createSignal('')
  const [done, setDone] = createSignal(false)

  const live = () =>
    props.rounds.find((r) => r.status === 'open' || r.status === 'in_review') ?? null

  async function submit(event: SubmitEvent) {
    event.preventDefault()
    setBusy(true)
    setError('')
    try {
      const result = await submitArticleForReview({
        data: {
          articleId: props.articleId,
          langs: langs(),
          documentation: documentation(),
        },
      })
      if (!result.ok) {
        setError(DELIBERATION_ERROR_MESSAGE[result.code]())
        return
      }
      setDone(true)
      await props.onSubmitted()
    } catch {
      setError(m.deliberation_errors_unexpected())
    } finally {
      setBusy(false)
    }
  }

  return (
    <section class="rounded-lg border border-neutral-200 bg-white p-6">
      <h2 class="text-lg font-semibold text-neutral-900">{m.submit_title()}</h2>
      <p class="mt-1 text-sm text-neutral-600">{m.submit_subtitle()}</p>
      <p class="mt-2 text-xs text-neutral-500">{m.submit_process()}</p>

      <Show when={props.rounds.length > 0}>
        <div class="mt-4 border-t border-neutral-200 pt-4">
          <h3 class="text-sm font-semibold text-neutral-900">{m.submit_rounds()}</h3>
          <ul class="mt-2 flex flex-col gap-1 text-sm">
            <For each={props.rounds}>
              {(round) => (
                <li class="flex flex-wrap items-center gap-2 text-neutral-700">
                  <span>{m.submit_round({ round: round.round })}</span>
                  <span class="text-xs text-neutral-500">
                    {round.langs.map(languageName).join(', ')} ·{' '}
                    {round.outcome
                      ? (OUTCOME_MESSAGE[
                          round.outcome as keyof typeof OUTCOME_MESSAGE
                        ]?.() ?? round.outcome)
                      : (SUBMISSION_STATUS_MESSAGE[round.status]?.() ?? round.status)}
                  </span>
                  <Link
                    to="/review/articles/$submissionId"
                    params={{ submissionId: round.submissionId }}
                    class="text-xs text-[#00209F] hover:underline"
                  >
                    {m.submit_open()}
                  </Link>
                </li>
              )}
            </For>
          </ul>
        </div>
      </Show>

      {/*
       * One live round at a time. A second would split the assigned panel and
       * could produce two different answers about the same text.
       */}
      <Show
        when={!live() && !done()}
        fallback={
          <p class="mt-4 rounded-md border border-neutral-200 bg-neutral-50 p-3 text-sm text-neutral-700">
            {done() ? m.submit_done() : m.deliberation_errors_alreadySubmitted()}
          </p>
        }
      >
        <form
          onSubmit={submit}
          class="mt-4 flex flex-col gap-4 border-t border-neutral-200 pt-4"
        >
          <fieldset class="flex flex-col gap-1 text-sm">
            <legend class="font-medium text-neutral-800">{m.submit_langsLabel()}</legend>
            <span class="text-xs text-neutral-500">{m.submit_langsHint()}</span>
            <div class="mt-1 flex flex-wrap gap-3">
              <For each={props.writtenLangs}>
                {(lang) => (
                  <label class="flex items-center gap-2">
                    <input
                      type="checkbox"
                      name="langs"
                      value={lang}
                      onChange={(e) =>
                        setLangs((prev) =>
                          e.currentTarget.checked
                            ? [...prev, lang]
                            : prev.filter((l) => l !== lang),
                        )
                      }
                    />
                    <span>{languageName(lang)}</span>
                  </label>
                )}
              </For>
            </div>
          </fieldset>

          <For each={FIELDS}>
            {(field) => (
              <label class="flex flex-col gap-1 text-sm">
                <span class="font-medium text-neutral-800">{field.label()}</span>
                <span class="text-xs text-neutral-500">{field.hint()}</span>
                {/* Uncontrolled: see the note in routes/_app/write/index.tsx. */}
                <textarea
                  rows="3"
                  name={field.key}
                  onInput={(e) =>
                    setDocumentation((prev) => ({
                      ...prev,
                      [field.key]: e.currentTarget.value,
                    }))
                  }
                  class="rounded-md border border-neutral-300 px-3 py-2 outline-none focus:border-[#00209F] focus:ring-2 focus:ring-[#00209F]/20"
                />
              </label>
            )}
          </For>

          <div>
            <button
              type="submit"
              disabled={busy() || langs().length === 0}
              class="h-10 rounded-md bg-[#00209F] px-4 text-sm font-semibold text-white hover:opacity-95 disabled:opacity-60"
            >
              {busy() ? m.submit_submitting() : m.submit_cta()}
            </button>
          </div>

          <div aria-live="polite" class="min-h-5 text-sm">
            <Show when={error()}>
              {(message) => <p class="text-[#A3261F]">{message()}</p>}
            </Show>
          </div>
        </form>
      </Show>
    </section>
  )
}
