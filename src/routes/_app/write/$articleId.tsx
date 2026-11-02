import { createFileRoute, Link, useRouter } from '@tanstack/solid-router'
import { createSignal, For, Show } from 'solid-js'
/**
 * The editor route.
 *
 * `ArticleEditor` is imported normally; the split that matters happens inside
 * it, where TipTap is loaded with a dynamic import. Splitting the component
 * instead — `lazy()` here — served the toolbar from the server with no client
 * entry to hydrate against, so the editor never appeared at all.
 */
import ArticleEditor, {
  type EditorHandle,
} from '../../../components/editor/ArticleEditor'
import CompanionPanel from '../../../components/editor/CompanionPanel'
import ImportPanel from '../../../components/editor/ImportPanel'
import SubmitPanel from '../../../components/editor/SubmitPanel'
import Icon from '../../../components/Icon'
import { isLocale, LOCALE_LABELS, LOCALES, type Locale } from '../../../i18n'
import {
  fetchEditableArticle,
  saveArticle,
  withdrawTranslation,
} from '../../../lib/articles/article-actions'
import { ARTICLE_ERROR_MESSAGE } from '../../../lib/articles/article-messages'
import type { DocNode } from '../../../lib/articles/prosemirror'
import { fetchRounds } from '../../../lib/deliberation/article-review-actions'
import { ICON_FILE_IMPORT, ICON_SAVE } from '../../../lib/shared/icons'
import { m } from '../../../paraglide/messages'
import { getLocale } from '../../../paraglide/runtime'

type Search = { lang?: Locale }

export const Route = createFileRoute('/_app/write/$articleId')({
  validateSearch: (search: Record<string, unknown>): Search => ({
    lang: isLocale(search.lang) ? search.lang : undefined,
  }),
  loaderDeps: ({ search }) => ({ lang: search.lang }),
  loader: async ({ params, deps }) => {
    const [article, rounds] = await Promise.all([
      fetchEditableArticle({ data: { articleId: params.articleId, lang: deps.lang } }),
      fetchRounds({ data: { articleId: params.articleId } }),
    ])
    return { article, rounds }
  },
  component: EditorPage,
})

function EditorPage() {
  const result = Route.useLoaderData()
  const context = Route.useRouteContext()
  const router = useRouter()

  const article = () => {
    const loaded = result().article
    return loaded.ok ? loaded.value : null
  }
  const refusal = (): keyof typeof ARTICLE_ERROR_MESSAGE => {
    const loaded = result().article
    return loaded.ok ? 'NOT_FOUND' : loaded.code
  }

  return (
    <main class="flex-1 bg-neutral-50 px-4 py-8 md:px-6">
      <div class="mx-auto w-full max-w-4xl">
        <Link
          to="/write"
          class="inline-flex min-h-11 items-center text-[15px] font-semibold text-accent hover:underline"
        >
          ← {m.write_backToDesk()}
        </Link>

        <Show
          when={article()}
          fallback={
            <p class="mt-6 rounded-lg border border-neutral-200 bg-white p-6 text-sm text-danger">
              {ARTICLE_ERROR_MESSAGE[refusal()]()}
            </p>
          }
        >
          {(loaded) => (
            /*
             * Rebuilt when the language changes, and only then. Switching tabs
             * keeps this route mounted, and the editor reads its document once
             * (see `ArticleEditor`), so without the key the Creole tab showed
             * the French title and text — and saving would have stored them as
             * the Creole version. Keying on the loader data instead would
             * rebuild after every save, under the author's cursor.
             */
            <Show when={`${loaded().articleId}:${loaded().lang}`} keyed>
              {(_language) => (
                <Editing
                  article={loaded()}
                  rounds={result().rounds}
                  canPublish={
                    context().user?.role === 'senior_member' ||
                    context().user?.role === 'super_admin'
                  }
                  onChanged={() => router.invalidate()}
                />
              )}
            </Show>
          )}
        </Show>
      </div>
    </main>
  )
}

type EditingProps = {
  article: {
    articleId: string
    slug: string
    lang: string
    title: string
    summary: string
    content: DocNode
    translationStatus: string
    otherLangs: Array<{ lang: string; status: string }>
    hasUnpublishedChanges: boolean
    changedSinceSubmission: boolean
  }
  canPublish: boolean
  rounds: Array<{
    submissionId: string
    round: number
    status: string
    langs: Array<string>
    outcome: string | null
  }>
  onChanged: () => void | Promise<void>
}

function Editing(props: EditingProps) {
  let editor: EditorHandle | undefined
  const [title, setTitle] = createSignal(props.article.title)
  const [summary, setSummary] = createSignal(props.article.summary)
  const [doc, setDoc] = createSignal<DocNode>(props.article.content)
  const [words, setWords] = createSignal(0)
  const [dirty, setDirty] = createSignal(false)
  const [savedAt, setSavedAt] = createSignal<string | null>(null)
  const [busy, setBusy] = createSignal<'save' | 'publish' | null>(null)
  const [error, setError] = createSignal('')
  // Counts stored text changes, so the companion panel can re-check whether its
  // PDF still matches: every save and every import writes a new revision.
  const [textVersion, setTextVersion] = createSignal(0)
  const [importing, setImporting] = createSignal(false)

  async function save() {
    setBusy('save')
    setError('')
    try {
      const result = await saveArticle({
        data: {
          articleId: props.article.articleId,
          lang: props.article.lang,
          title: title(),
          summary: summary(),
          content: doc(),
        },
      })
      if (!result.ok) {
        setError(ARTICLE_ERROR_MESSAGE[result.code]())
        return
      }
      setSavedAt(new Date(result.value.savedAt).toLocaleTimeString(getLocale()))
      setDirty(false)
      setTextVersion((n) => n + 1)
      await props.onChanged()
    } catch {
      setError(m.write_errors_unexpected())
    } finally {
      setBusy(null)
    }
  }

  async function withdraw() {
    setBusy('publish')
    setError('')
    try {
      const result = await withdrawTranslation({
        data: { articleId: props.article.articleId, lang: props.article.lang },
      })
      if (!result.ok) {
        setError(ARTICLE_ERROR_MESSAGE[result.code]())
        return
      }
      await props.onChanged()
    } catch {
      setError(m.write_errors_unexpected())
    } finally {
      setBusy(null)
    }
  }

  const languageName = (code: string) =>
    LOCALE_LABELS[code as keyof typeof LOCALE_LABELS] ?? code

  /** Each language's state, written or not: the tabs across the top. */
  const statusOf = (code: Locale) => {
    const status =
      code === props.article.lang
        ? props.article.translationStatus
        : props.article.otherLangs.find((other) => other.lang === code)?.status
    if (status === 'published')
      return { label: m.write_status_published(), class: 'bg-green-50 text-green-900' }
    // `new` is what the server says for a language nobody has written yet.
    if (status && status !== 'new')
      return { label: m.write_status_draft(), class: 'bg-amber-50 text-amber-900' }
    return { label: m.write_status_new(), class: 'bg-neutral-100 text-neutral-600' }
  }

  return (
    <div class="mt-4 flex flex-col gap-5">
      <header class="flex flex-col gap-2">
        <h1 class="font-serif text-3xl leading-tight font-bold md:text-4xl">
          {title() || props.article.slug}
        </h1>
        <div class="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted">
          <span>/{props.article.slug}</span>
          <Show when={props.article.translationStatus === 'published'}>
            <Link
              to="/articles/$slug"
              params={{ slug: props.article.slug }}
              class="font-semibold text-accent hover:underline"
            >
              {m.write_viewPublished()}
            </Link>
          </Show>
        </div>
      </header>

      {/*
       * Every language, written or not, so starting the Creole version is a
       * click here — then writing, or importing a Word file into it. The import
       * always fills the language on screen.
       */}
      <nav
        aria-label={m.write_languages()}
        class="flex flex-wrap gap-2 border-b border-line pb-3"
      >
        <For each={LOCALES}>
          {(code) => (
            <Link
              to="/write/$articleId"
              params={{ articleId: props.article.articleId }}
              search={{ lang: code }}
              aria-current={code === props.article.lang ? 'page' : undefined}
              class={`flex min-h-11 items-center gap-2 rounded-lg border px-3 text-[15px] ${code === props.article.lang ? 'border-accent bg-raised font-bold text-ink' : 'border-line bg-raised text-neutral-700 hover:border-accent-line'}`}
            >
              <span lang={code}>{languageName(code)}</span>
              <span
                class={`rounded-full px-2 py-0.5 text-xs font-semibold ${statusOf(code).class}`}
              >
                {statusOf(code).label}
              </span>
            </Link>
          )}
        </For>
      </nav>

      {/*
       * Published text is what the circle approved, and saving here does not
       * change it (D30). Said up front, because an author who fixes a typo on
       * a live article will otherwise go looking for the fix on the page and
       * conclude the save failed.
       */}
      <Show when={props.article.translationStatus === 'published'}>
        <p class="rounded-md border border-neutral-200 bg-neutral-50 p-3 text-sm text-neutral-700">
          {m.write_publishedIsApproved()}
        </p>
      </Show>
      <Show when={props.article.hasUnpublishedChanges}>
        <p class="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
          {m.write_unpublishedChanges()}
        </p>
      </Show>
      <Show when={props.article.changedSinceSubmission}>
        <p class="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
          {m.write_changedSinceSubmission()}
        </p>
      </Show>

      <label class="flex flex-col gap-1.5 text-sm">
        <span class="font-medium text-neutral-800">{m.write_titleLabel()}</span>
        <input
          name="title"
          value={title()}
          onInput={(e) => {
            setTitle(e.currentTarget.value)
            setDirty(true)
          }}
          class="h-12 rounded-lg border border-neutral-300 bg-white px-3 font-serif text-lg outline-none focus:border-accent focus:ring-2 focus:ring-accent/20"
        />
      </label>

      <label class="flex flex-col gap-1.5 text-sm">
        <span class="font-medium text-neutral-800">{m.write_summaryLabel()}</span>
        <textarea
          name="summary"
          rows="2"
          onInput={(e) => {
            setSummary(e.currentTarget.value)
            setDirty(true)
          }}
          class="rounded-lg border border-neutral-300 bg-white px-3 py-2 text-base outline-none focus:border-accent focus:ring-2 focus:ring-accent/20"
        >
          {props.article.summary}
        </textarea>
      </label>

      {/*
       * The wait for TipTap is named inside the editor itself. Importing a Word
       * file opens inside it too, from the toolbar: it is the other way of
       * filling the same text, not a second document beside it.
       */}
      <ArticleEditor
        content={props.article.content}
        onReady={(handle) => {
          editor = handle
        }}
        onCount={setWords}
        onChange={(next, count) => {
          setDoc(next)
          setWords(count)
          setDirty(true)
        }}
        actions={
          <button
            type="button"
            onClick={() => setImporting(!importing())}
            aria-expanded={importing() ? 'true' : 'false'}
            class="inline-flex min-h-9 items-center gap-2 rounded-md border border-line px-3 text-sm font-semibold text-accent hover:bg-accent-soft"
          >
            <Icon d={ICON_FILE_IMPORT} />
            {m.write_importWord()}
          </button>
        }
        panel={
          <Show
            when={importing()}
            fallback={
              /* A language with nothing in it yet says there are two ways in. */
              <Show when={!hasText(doc())}>
                <p class="border-b border-line bg-accent-soft px-5 py-3 text-sm text-ink">
                  {m.write_startHint()}
                </p>
              </Show>
            }
          >
            <ImportPanel
              articleId={props.article.articleId}
              lang={props.article.lang}
              languageName={languageName(props.article.lang)}
              replacing={hasText(doc())}
              onClose={() => setImporting(false)}
              onImported={async (imported) => {
                // The server already stored it, so the editor is being caught
                // up rather than changed: put the text on screen and clear the
                // unsaved marker the replacement itself sets.
                editor?.replace(imported)
                setDirty(false)
                setTextVersion((n) => n + 1)
                await props.onChanged()
              }}
            />
          </Show>
        }
        footer={
          <>
            <button
              type="button"
              disabled={busy() !== null}
              onClick={() => void save()}
              class="inline-flex min-h-11 items-center gap-2 rounded-lg bg-accent px-4 font-semibold text-on-accent hover:bg-accent-hover disabled:opacity-60"
            >
              <Icon d={ICON_SAVE} />
              {busy() === 'save' ? m.write_saving() : m.write_save()}
            </button>

            {/*
             * Publication now comes out of a deliberation, not a button. A
             * senior member may still take a language down — that is an
             * editorial correction — but putting one up is a decision the
             * circle makes, which is the whole point of phase 3.
             */}
            <Show
              when={props.canPublish && props.article.translationStatus === 'published'}
            >
              <button
                type="button"
                disabled={busy() !== null}
                onClick={() => void withdraw()}
                class="inline-flex min-h-11 items-center rounded-lg border border-danger px-4 font-semibold text-danger hover:bg-red-50 disabled:opacity-60"
              >
                {busy() === 'publish' ? m.write_publishing() : m.write_unpublish()}
              </button>
            </Show>

            <span class="text-sm text-muted">
              {m.write_wordCount({ count: words() })}
            </span>
            <Show when={dirty()}>
              <span class="text-sm font-semibold text-amber-700">
                {m.write_unsaved()}
              </span>
            </Show>
            <Show when={!dirty() && savedAt()}>
              {(time) => (
                <span class="text-sm text-muted">{m.write_saved({ time: time() })}</span>
              )}
            </Show>
          </>
        }
      />

      <div aria-live="polite" class="empty:hidden text-sm">
        <Show when={error()}>{(message) => <p class="text-danger">{message()}</p>}</Show>
      </div>

      {/*
       * The PDF before the submission, in the order the work happens: it goes
       * to the circle with the text, so it has to be attached first — a PDF
       * attached after submitting waits for the next round (`companion_fileHint`
       * says so). It was below the submit button, inviting the opposite.
       */}
      <CompanionPanel
        articleId={props.article.articleId}
        lang={props.article.lang}
        dirty={dirty()}
        textVersion={textVersion()}
      />

      {/*
       * The languages this article actually has text in. Submitting a language
       * nobody has written would put the panel in front of a blank page.
       */}
      <SubmitPanel
        articleId={props.article.articleId}
        writtenLangs={[
          props.article.lang,
          ...props.article.otherLangs.map((other) => other.lang),
        ].sort()}
        rounds={props.rounds}
        onSubmitted={props.onChanged}
      />
    </div>
  )
}

/** Whether a document has any text in it: a language nobody has written yet has none. */
function hasText(node: DocNode): boolean {
  if (node.text?.trim()) return true
  return (node.content ?? []).some(hasText)
}
