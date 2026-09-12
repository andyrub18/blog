import { createSignal, For, Show } from 'solid-js'
import { LOCALE_LABELS, LOCALES, type Locale } from '../../i18n'
import type { ImportErrorCode, ImportResult } from '../../lib/docx-actions'
import { importDocx } from '../../lib/docx-actions'
import type { ImportReport } from '../../lib/html-to-prosemirror'
import type { DocNode } from '../../lib/prosemirror'
import { m } from '../../paraglide/messages'

/**
 * Importing a Word file into one language of an article.
 *
 * Two things on this panel are there to prevent the complaint this feature will
 * otherwise generate every time. The first is the sentence next to the button
 * saying what survives — the gap between "I uploaded my Word file" and "where
 * did my formatting go" is entirely predictable, and one line closes most of
 * it. The second is the report afterwards, which names what was dropped instead
 * of quietly succeeding.
 */

const ERROR_MESSAGE: Record<ImportErrorCode, () => string> = {
  MISSING_FILE: m.import_errors_missingFile,
  FILE_TOO_LARGE: m.import_errors_fileTooLarge,
  NOT_A_ZIP: m.import_errors_notAZip,
  NOT_A_DOCX: m.import_errors_notADocx,
  ARCHIVE_REFUSED: m.import_errors_archiveRefused,
  CONVERSION_FAILED: m.import_errors_conversionFailed,
  CONVERSION_TIMEOUT: m.import_errors_conversionTimeout,
  EMPTY_DOCUMENT: m.import_errors_emptyDocument,
  FORBIDDEN: m.import_errors_forbidden,
  NOT_FOUND: m.import_errors_notFound,
  RATE_LIMITED: m.import_errors_rateLimited,
  UNEXPECTED: m.import_errors_unexpected,
}

/**
 * The names the converter uses, in the reader's language.
 *
 * A `Record` keyed by the converter's own vocabulary, so a new kind of dropped
 * thing shows up untranslated rather than invisible — and the fallback prints
 * the raw kind, which is still more use to an author than nothing.
 */
const KIND_MESSAGE: Record<string, () => string> = {
  heading: m.import_kind_heading,
  paragraph: m.import_kind_paragraph,
  table: m.import_kind_table,
  list: m.import_kind_list,
  quote: m.import_kind_quote,
  link: m.import_kind_link,
  'code block': m.import_kind_codeBlock,
  image: m.import_kind_image,
  equation: m.import_kind_equation,
  underline: m.import_kind_underline,
  'unsafe link': m.import_kind_unsafeLink,
  'embedded object': m.import_kind_embeddedObject,
  video: m.import_kind_video,
  audio: m.import_kind_audio,
  script: m.import_kind_script,
  style: m.import_kind_style,
  'form field': m.import_kind_formField,
  other: m.import_kind_other,
}

const describe = (kind: string) => KIND_MESSAGE[kind]?.() ?? kind

type Props = {
  articleId: string
  /** The language the editor is currently open on, used as the default. */
  lang: string
  /** Handed the converted document, so the editor can show what just arrived. */
  onImported: (doc: DocNode) => void | Promise<void>
}

function summarise(counts: Record<string, number>): string {
  return Object.entries(counts)
    .sort((a, b) => b[1] - a[1])
    .map(([kind, n]) => `${n} ${describe(kind)}`)
    .join(', ')
}

export default function ImportPanel(props: Props) {
  const [busy, setBusy] = createSignal(false)
  const [error, setError] = createSignal('')
  const [result, setResult] = createSignal<{
    report: ImportReport
    words: number
  } | null>(null)

  async function submit(event: SubmitEvent) {
    event.preventDefault()
    const form = event.currentTarget as HTMLFormElement
    setBusy(true)
    setError('')
    setResult(null)
    try {
      // Sent as FormData, because the file is the payload. The server re-reads
      // `articleId` and `lang` from it and re-checks the caller; nothing here
      // is trusted on the other side.
      const response = (await importDocx({ data: new FormData(form) })) as ImportResult
      if (!response.ok) {
        setError(ERROR_MESSAGE[response.code]?.() ?? m.import_errors_unexpected())
        return
      }
      setResult({ report: response.report, words: response.words })
      await props.onImported(response.doc)
    } catch {
      setError(m.import_errors_unexpected())
    } finally {
      setBusy(false)
    }
  }

  return (
    <section class="rounded-lg border border-neutral-200 bg-white p-6">
      <h2 class="text-lg font-semibold text-neutral-900">{m.import_title()}</h2>
      <p class="mt-1 text-sm text-neutral-600">{m.import_subtitle()}</p>

      <form onSubmit={submit} class="mt-4 flex flex-col gap-4">
        <input type="hidden" name="articleId" value={props.articleId} />

        <label class="flex flex-col gap-1 text-sm">
          <span class="font-medium text-neutral-800">{m.import_langLabel()}</span>
          <span class="text-xs text-neutral-500">{m.import_langHint()}</span>
          <select
            name="lang"
            class="h-10 rounded-md border border-neutral-300 px-3 outline-none focus:border-[#00209F] focus:ring-2 focus:ring-[#00209F]/20"
          >
            <For each={LOCALES}>
              {(lang) => (
                <option value={lang} selected={lang === props.lang}>
                  {LOCALE_LABELS[lang as Locale]}
                </option>
              )}
            </For>
          </select>
        </label>

        <label class="flex flex-col gap-1 text-sm">
          <span class="font-medium text-neutral-800">{m.import_fileLabel()}</span>
          <span class="text-xs text-neutral-500">{m.import_fileHint()}</span>
          <input
            type="file"
            name="file"
            accept=".docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
            required
            class="text-sm"
          />
        </label>

        <p class="rounded-md border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
          {m.import_replaceWarning()}
        </p>

        <div>
          <button
            type="submit"
            disabled={busy()}
            class="h-10 rounded-md bg-[#00209F] px-4 text-sm font-semibold text-white hover:opacity-95 disabled:opacity-60"
          >
            {busy() ? m.import_importing() : m.import_cta()}
          </button>
        </div>

        <div aria-live="polite" class="min-h-5 text-sm">
          <Show when={error()}>
            {(message) => <p class="text-[#A3261F]">{message()}</p>}
          </Show>
        </div>
      </form>

      <Show when={result()}>
        {(imported) => (
          <div class="mt-2 rounded-md border border-green-200 bg-green-50 p-4 text-sm text-green-900">
            <p class="font-medium">{m.import_done()}</p>
            <p class="mt-1">{m.import_words({ count: imported().words })}</p>
            <p class="mt-2">
              <span class="font-medium">{m.import_kept()}:</span>{' '}
              {summarise(imported().report.kept)}
            </p>
            <p class="mt-1">
              <span class="font-medium">{m.import_dropped()}:</span>{' '}
              {Object.keys(imported().report.dropped).length === 0
                ? m.import_nothingDropped()
                : summarise(imported().report.dropped)}
            </p>
            <p class="mt-2 text-xs">{m.import_reviewFirst()}</p>
          </div>
        )}
      </Show>
    </section>
  )
}
