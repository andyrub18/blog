import { createEffect, createSignal, Show } from 'solid-js'
import type { CompanionState } from '../../lib/companion'
import {
  type AttachResult,
  attachCompanionPdf,
  type CompanionActionError,
  fetchCompanionState,
  removeCompanionPdf,
} from '../../lib/companion-actions'
import type { PdfCleaning } from '../../lib/pdf'
import { formatMegabytes } from '../../lib/validation'
import { m } from '../../paraglide/messages'
import { getLocale } from '../../paraglide/runtime'

/**
 * Attaching the author's typeset PDF to one language of an article (D26).
 *
 * The circle reviews it with the text, and readers get it only once a decision
 * approves it (D29). So most of what this panel says is *where the file is* on
 * the way to readers — in review, waiting for the next round, approved — since
 * from the author's side every one of those looks like "I attached it and it
 * is not on the page".
 *
 * The sentence this panel exists to say is the stale one. A companion stops
 * being offered the moment the text is saved again — that is the rule, and it
 * is the right rule, but from the author's side it looks like the PDF vanished
 * for no reason. So the panel re-reads its state after every save and import,
 * and says in words that readers no longer see the file and why.
 *
 * The report after an upload is the other half: what was stripped from the
 * file. An author who learns their PDF carried their home directory and a
 * photo's GPS position learns it here, rather than from somebody who read it
 * out of the published file.
 */

const ERROR_MESSAGE: Record<CompanionActionError, () => string> = {
  MISSING_FILE: m.companion_errors_missingFile,
  FILE_TOO_LARGE: m.companion_errors_fileTooLarge,
  NOT_A_PDF: m.companion_errors_notAPdf,
  ENCRYPTED: m.companion_errors_encrypted,
  UNREADABLE: m.companion_errors_unreadable,
  EMPTY_DOCUMENT: m.companion_errors_emptyDocument,
  ACTIVE_CONTENT: m.companion_errors_activeContent,
  ANNOTATIONS: m.companion_errors_annotations,
  UNSUPPORTED_IMAGE: m.companion_errors_unsupportedImage,
  FORBIDDEN: m.companion_errors_forbidden,
  NOT_FOUND: m.companion_errors_notFound,
  NO_TEXT: m.companion_errors_noText,
  RATE_LIMITED: m.companion_errors_rateLimited,
  INVALID_LANGUAGE: m.companion_errors_invalidLanguage,
  UNEXPECTED: m.companion_errors_unexpected,
}

type Props = {
  articleId: string
  lang: string
  published: boolean
  /** Unsaved edits in the editor: a PDF attached now would describe the old text. */
  dirty: boolean
  /** Goes up on every save or import, which is when a companion can go stale. */
  textVersion: number
}

export default function CompanionPanel(props: Props) {
  const [state, setState] = createSignal<CompanionState | null>(null)
  const [busy, setBusy] = createSignal(false)
  const [error, setError] = createSignal('')
  const [cleaning, setCleaning] = createSignal<PdfCleaning | null>(null)

  createEffect(
    () => [props.articleId, props.lang, props.textVersion] as const,
    ([articleId, lang]) => {
      void fetchCompanionState({ data: { articleId, lang } })
        .then((result) => {
          if (result.ok) setState(result.state)
        })
        .catch(() => {
          // The panel still works without it: attaching reports its own state.
        })
    },
  )

  const summary = () => {
    const current = state()
    if (!current || current.state === 'none') return null
    return {
      pages: String(current.pageCount),
      size: formatMegabytes(current.byteSize, getLocale()),
    }
  }

  async function attach(event: SubmitEvent) {
    event.preventDefault()
    const form = event.currentTarget as HTMLFormElement
    setBusy(true)
    setError('')
    setCleaning(null)
    try {
      const result = (await attachCompanionPdf({
        data: new FormData(form),
      })) as AttachResult
      if (!result.ok) {
        setError(ERROR_MESSAGE[result.code]?.() ?? m.companion_errors_unexpected())
        return
      }
      setState(result.state)
      setCleaning(result.cleaning)
      form.reset()
    } catch {
      setError(m.companion_errors_unexpected())
    } finally {
      setBusy(false)
    }
  }

  async function remove() {
    setBusy(true)
    setError('')
    setCleaning(null)
    try {
      const result = await removeCompanionPdf({
        data: { articleId: props.articleId, lang: props.lang },
      })
      if (!result.ok) {
        setError(ERROR_MESSAGE[result.code]?.() ?? m.companion_errors_unexpected())
        return
      }
      setState(result.state)
    } catch {
      setError(m.companion_errors_unexpected())
    } finally {
      setBusy(false)
    }
  }

  /**
   * One sentence per state, and every one but the first says why readers do not
   * have the file — the author cannot act on a state they are not told about.
   */
  const describeState = (values: { pages: string; size: string }) => {
    switch (state()?.state) {
      case 'approved':
        return props.published
          ? m.companion_current(values)
          : m.companion_approvedNotLive(values)
      case 'inReview':
        return m.companion_inReview(values)
      case 'nextRound':
        return m.companion_nextRound(values)
      default:
        return m.companion_awaitingReview(values)
    }
  }

  const hasCompanion = () => {
    const current = state()
    return current !== null && current.state !== 'none'
  }

  return (
    <section
      class="rounded-lg border border-neutral-200 bg-white p-6"
      data-testid="companion"
    >
      <h2 class="text-lg font-semibold text-neutral-900">{m.companion_title()}</h2>
      <p class="mt-1 text-sm text-neutral-600">{m.companion_subtitle()}</p>

      <div aria-live="polite" class="mt-4 flex flex-col gap-2 text-sm">
        <Show when={state()?.state === 'stale'}>
          <p class="rounded-md border border-amber-200 bg-amber-50 p-3 text-amber-900">
            {m.companion_stale()}
          </p>
        </Show>
        <Show when={state()?.state !== 'stale' && summary()}>
          {(values) => <p class="text-neutral-700">{describeState(values())}</p>}
        </Show>
        <Show when={state()?.state === 'approved' && props.published}>
          <p class="text-xs text-neutral-500">{m.companion_replaceWarning()}</p>
        </Show>
        <Show when={props.dirty}>
          <p class="rounded-md border border-amber-200 bg-amber-50 p-3 text-amber-900">
            {m.companion_unsaved()}
          </p>
        </Show>
        <Show when={cleaning()}>
          {(removed) => (
            <Show
              when={
                removed().properties || removed().photos > 0 || removed().leftovers > 0
              }
            >
              <div class="rounded-md border border-neutral-200 bg-neutral-50 p-3 text-neutral-700">
                <p class="font-medium">{m.companion_cleanedTitle()}</p>
                <ul class="mt-1 list-disc pl-5">
                  <Show when={removed().properties}>
                    <li>{m.companion_cleanedProperties()}</li>
                  </Show>
                  <Show when={removed().photos > 0}>
                    <li>
                      {m.companion_cleanedPhotos({ count: String(removed().photos) })}
                    </li>
                  </Show>
                  <Show when={removed().leftovers > 0}>
                    <li>{m.companion_cleanedLeftovers()}</li>
                  </Show>
                </ul>
                <p class="mt-1 text-xs text-neutral-500">{m.companion_cleanedWhy()}</p>
              </div>
            </Show>
          )}
        </Show>
        <Show when={error()}>
          {(message) => <p class="text-[#A3261F]">{message()}</p>}
        </Show>
      </div>

      <form onSubmit={attach} class="mt-4 flex flex-col gap-4">
        <input type="hidden" name="articleId" value={props.articleId} />
        <input type="hidden" name="lang" value={props.lang} />
        <label class="flex flex-col gap-1 text-sm">
          <span class="font-medium text-neutral-800">{m.companion_fileLabel()}</span>
          <span class="text-xs text-neutral-500">{m.companion_fileHint()}</span>
          <input
            type="file"
            name="file"
            accept="application/pdf,.pdf"
            required
            class="text-sm"
          />
        </label>
        <div class="flex flex-wrap items-center gap-3">
          <button
            type="submit"
            disabled={busy()}
            class="h-10 rounded-md bg-[#00209F] px-4 text-sm font-semibold text-white hover:opacity-95 disabled:opacity-60"
          >
            {busy()
              ? m.companion_working()
              : hasCompanion()
                ? m.companion_replace()
                : m.companion_attach()}
          </button>
          <Show when={hasCompanion()}>
            <button
              type="button"
              disabled={busy()}
              onClick={() => void remove()}
              class="text-sm font-medium text-[#A3261F] hover:underline disabled:opacity-60"
            >
              {m.companion_remove()}
            </button>
          </Show>
        </div>
      </form>
    </section>
  )
}
