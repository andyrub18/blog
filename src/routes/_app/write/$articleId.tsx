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
import ArticleEditor from '../../../components/editor/ArticleEditor'
import SubmitPanel from '../../../components/editor/SubmitPanel'
import { isLocale, LOCALE_LABELS, type Locale } from '../../../i18n'
import {
  fetchEditableArticle,
  saveArticle,
  withdrawTranslation,
} from '../../../lib/article-actions'
import { ARTICLE_ERROR_MESSAGE } from '../../../lib/article-messages'
import { fetchRounds } from '../../../lib/article-review-actions'
import type { DocNode } from '../../../lib/prosemirror'
import { m } from '../../../paraglide/messages'

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
    <main class="min-h-screen bg-neutral-50 px-4 py-10">
      <div class="mx-auto w-full max-w-3xl">
        <Link to="/write" class="text-sm text-[#00209F] hover:underline">
          ← {m.write_backToDesk()}
        </Link>

        <Show
          when={article()}
          fallback={
            <p class="mt-6 rounded-lg border border-neutral-200 bg-white p-6 text-sm text-[#A3261F]">
              {ARTICLE_ERROR_MESSAGE[refusal()]()}
            </p>
          }
        >
          {(loaded) => (
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
  const [title, setTitle] = createSignal(props.article.title)
  const [summary, setSummary] = createSignal(props.article.summary)
  const [doc, setDoc] = createSignal<DocNode>(props.article.content)
  const [words, setWords] = createSignal(0)
  const [dirty, setDirty] = createSignal(false)
  const [savedAt, setSavedAt] = createSignal<string | null>(null)
  const [busy, setBusy] = createSignal<'save' | 'publish' | null>(null)
  const [error, setError] = createSignal('')

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
      setSavedAt(new Date(result.value.savedAt).toLocaleTimeString())
      setDirty(false)
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

  return (
    <div class="mt-6 flex flex-col gap-4">
      <div class="flex flex-wrap items-center justify-between gap-2">
        <h1 class="text-xl font-bold text-neutral-900">
          {languageName(props.article.lang)}
        </h1>
        <div class="flex flex-wrap items-center gap-2 text-xs text-neutral-500">
          <span>/{props.article.slug}</span>
          <span class="rounded bg-neutral-200 px-2 py-0.5 font-medium text-neutral-700">
            {props.article.translationStatus === 'published'
              ? m.write_status_published()
              : m.write_status_draft()}
          </span>
          <Show when={props.article.translationStatus === 'published'}>
            <Link
              to="/articles/$slug"
              params={{ slug: props.article.slug }}
              class="text-[#00209F] hover:underline"
            >
              {m.write_viewPublished()}
            </Link>
          </Show>
        </div>
      </div>

      <label class="flex flex-col gap-1 text-sm">
        <span class="font-medium text-neutral-800">{m.write_titleLabel()}</span>
        <input
          name="title"
          value={title()}
          onInput={(e) => {
            setTitle(e.currentTarget.value)
            setDirty(true)
          }}
          class="h-10 rounded-md border border-neutral-300 bg-white px-3 outline-none focus:border-[#00209F] focus:ring-2 focus:ring-[#00209F]/20"
        />
      </label>

      <label class="flex flex-col gap-1 text-sm">
        <span class="font-medium text-neutral-800">{m.write_summaryLabel()}</span>
        <textarea
          name="summary"
          rows="2"
          onInput={(e) => {
            setSummary(e.currentTarget.value)
            setDirty(true)
          }}
          class="rounded-md border border-neutral-300 bg-white px-3 py-2 outline-none focus:border-[#00209F] focus:ring-2 focus:ring-[#00209F]/20"
        >
          {props.article.summary}
        </textarea>
      </label>

      {/* The wait for TipTap is named inside the editor itself. */}
      <ArticleEditor
        content={props.article.content}
        onChange={(next, count) => {
          setDoc(next)
          setWords(count)
          setDirty(true)
        }}
      />

      <div class="flex flex-wrap items-center gap-3">
        <button
          type="button"
          disabled={busy() !== null}
          onClick={() => void save()}
          class="h-10 rounded-md bg-[#00209F] px-4 text-sm font-semibold text-white hover:opacity-95 disabled:opacity-60"
        >
          {busy() === 'save' ? m.write_saving() : m.write_save()}
        </button>

        {/*
         * Publication now comes out of a deliberation, not a button. A senior
         * member may still take a language down — that is an editorial
         * correction — but putting one up is a decision the circle makes, which
         * is the whole point of phase 3.
         */}
        <Show when={props.canPublish && props.article.translationStatus === 'published'}>
          <button
            type="button"
            disabled={busy() !== null}
            onClick={() => void withdraw()}
            class="h-10 rounded-md border border-[#A3261F] px-4 text-sm font-semibold text-[#A3261F] hover:bg-red-50 disabled:opacity-60"
          >
            {busy() === 'publish' ? m.write_publishing() : m.write_unpublish()}
          </button>
        </Show>

        <span class="text-xs text-neutral-500">
          {m.write_wordCount({ count: words() })}
        </span>
        <Show when={dirty()}>
          <span class="text-xs text-amber-700">{m.write_unsaved()}</span>
        </Show>
        <Show when={!dirty() && savedAt()}>
          {(time) => (
            <span class="text-xs text-neutral-500">
              {m.write_saved({ time: time() })}
            </span>
          )}
        </Show>
      </div>

      <div aria-live="polite" class="min-h-5 text-sm">
        <Show when={error()}>
          {(message) => <p class="text-[#A3261F]">{message()}</p>}
        </Show>
      </div>

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

      <Show when={props.article.otherLangs.length > 0}>
        <footer class="border-t border-neutral-200 pt-4 text-sm">
          <p class="mb-2 font-medium text-neutral-800">{m.write_languages()}</p>
          <ul class="flex flex-wrap gap-2 text-xs">
            <For each={props.article.otherLangs}>
              {(other) => (
                <li>
                  <Link
                    to="/write/$articleId"
                    params={{ articleId: props.article.articleId }}
                    search={{ lang: other.lang as Locale }}
                    class="rounded border border-neutral-200 bg-white px-2 py-1 text-neutral-700 hover:bg-neutral-50"
                  >
                    {languageName(other.lang)} ·{' '}
                    {other.status === 'published'
                      ? m.write_status_published()
                      : m.write_status_draft()}
                  </Link>
                </li>
              )}
            </For>
          </ul>
        </footer>
      </Show>
    </div>
  )
}
