import { Show } from 'solid-js'
import type { Comparison, PdfChange } from '../../lib/articles/versions'
import { m } from '../../paraglide/messages'

const PDF_CHANGE_MESSAGE: Record<PdfChange, (() => string) | null> = {
  none: null,
  unchanged: m.versions_pdf_unchanged,
  changed: m.versions_pdf_changed,
  added: m.versions_pdf_added,
  removed: m.versions_pdf_removed,
}

/**
 * What changed between two versions (D31): title, summary, body and PDF, each
 * only when it changed.
 *
 * Shared by the circle's review page and the readers' version history, so a
 * reviewer and a reader see a change drawn the same way. `innerHTML` is safe
 * here for the reason it is on the reading view: `diff.ts` wrote every tag and
 * escaped every character the author typed.
 */
export default function VersionChanges(props: { comparison: Comparison }) {
  return (
    <div class="mt-2 flex flex-col gap-2 text-sm">
      <Show when={props.comparison.titleHtml}>
        {(html) => (
          <p class="diff-line">
            <span class="font-medium">{m.versions_titleLabel()}</span>{' '}
            <span innerHTML={html()} />
          </p>
        )}
      </Show>
      <Show when={props.comparison.summaryHtml}>
        {(html) => (
          <p class="diff-line">
            <span class="font-medium">{m.versions_summaryLabel()}</span>{' '}
            <span innerHTML={html()} />
          </p>
        )}
      </Show>
      <Show
        when={props.comparison.body.changed}
        fallback={<p class="text-neutral-600">{m.versions_noTextChange()}</p>}
      >
        <div class="article-prose article-diff" innerHTML={props.comparison.body.html} />
      </Show>
      <Show when={PDF_CHANGE_MESSAGE[props.comparison.pdf]}>
        {(message) => <p class="text-neutral-600">{message()()}</p>}
      </Show>
    </div>
  )
}
