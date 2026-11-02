import { createSignal, Show } from 'solid-js'
import type {
  ImportErrorCode,
  ImportResult,
} from '../../lib/articles/import/docx-actions'
import { importDocx } from '../../lib/articles/import/docx-actions'
import type { ImportReport } from '../../lib/articles/import/html-to-prosemirror'
import type { DocNode } from '../../lib/articles/prosemirror'
import { ICON_CLOSE, ICON_FILE_IMPORT } from '../../lib/shared/icons-workspace'
import { m } from '../../paraglide/messages'
import FilePicker from '../FilePicker'
import Icon from '../Icon'

/**
 * Importing a Word file into the language on screen.
 *
 * It opens inside the editor, from the toolbar, because that is what it does:
 * it fills the editor. It used to be a separate form under it with its own
 * language list, so an author editing the French text could import into the
 * Creole one from the same page — two ways of writing that looked like they
 * competed. The language is now the editor's, and choosing another means
 * opening that language first.
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
  /** The language the editor is open on, which the import fills. */
  lang: string
  /** That language's name, for the sentence that says so. */
  languageName: string
  /** Whether the editor already holds text the import would replace. */
  replacing: boolean
  /** Handed the converted document, so the editor can show what just arrived. */
  onImported: (doc: DocNode) => void | Promise<void>
  onClose: () => void
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
    <section
      aria-labelledby="import-title"
      class="border-b border-line bg-surface px-5 py-5"
    >
      <div class="flex items-start justify-between gap-4">
        <div>
          <h2 id="import-title" class="flex items-center gap-2 font-bold text-ink">
            <Icon d={ICON_FILE_IMPORT} class="size-5 text-accent" />
            {m.import_title()}
          </h2>
          <p class="mt-1 text-sm text-ink-soft">
            {m.import_subtitle()}{' '}
            {m.import_intoLanguage({ language: props.languageName })}
          </p>
        </div>
        <button
          type="button"
          onClick={() => props.onClose()}
          aria-label={m.common_close()}
          title={m.common_close()}
          class="inline-flex size-9 shrink-0 items-center justify-center rounded-md text-neutral-700 hover:bg-neutral-100"
        >
          <Icon d={ICON_CLOSE} />
        </button>
      </div>

      <form onSubmit={submit} class="mt-4 flex flex-col gap-4">
        <input type="hidden" name="articleId" value={props.articleId} />
        <input type="hidden" name="lang" value={props.lang} />

        <FilePicker
          name="file"
          accept=".docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
          required
          label={m.import_fileLabel()}
          hint={m.import_fileHint()}
        />

        {/* Only when there is something to lose. */}
        <Show when={props.replacing}>
          <p class="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
            {m.import_replaceWarning()}
          </p>
        </Show>

        <div class="flex flex-wrap gap-3">
          <button
            type="submit"
            disabled={busy()}
            class="inline-flex min-h-11 items-center gap-2 rounded-lg bg-accent px-4 font-semibold text-on-accent hover:bg-accent-hover disabled:opacity-60"
          >
            <Icon d={ICON_FILE_IMPORT} />
            {busy() ? m.import_importing() : m.import_cta()}
          </button>
          <button
            type="button"
            onClick={() => props.onClose()}
            class="inline-flex min-h-11 items-center rounded-lg border border-line bg-raised px-4 font-semibold text-neutral-700 hover:bg-neutral-100"
          >
            {m.common_cancel()}
          </button>
        </div>

        <div aria-live="polite" class="empty:hidden text-sm">
          <Show when={error()}>
            {(message) => <p class="text-danger">{message()}</p>}
          </Show>
        </div>
      </form>

      <Show when={result()}>
        {(imported) => (
          <div class="mt-4 rounded-lg border border-green-200 bg-green-50 p-4 text-sm text-green-900">
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
