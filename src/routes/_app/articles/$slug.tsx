import { createFileRoute, Link } from '@tanstack/solid-router'
import { For, Show } from 'solid-js'
import LanguageSwitcher from '../../../components/LanguageSwitcher'
import { LOCALE_LABELS } from '../../../i18n'
import { fetchArticle } from '../../../lib/article-actions'
import type { DiscussionTail as Tail } from '../../../lib/forum'
import { m } from '../../../paraglide/messages'

/**
 * The reading view.
 *
 * This is the page the budget is written for: a reader on metered Haitian
 * mobile data. The article's HTML is rendered on the server from the stored
 * ProseMirror document, so what arrives here is finished markup — no editor, no
 * renderer, nothing to run. Everything interactive on this page is a link.
 */
export const Route = createFileRoute('/_app/articles/$slug')({
  loader: ({ params }) => fetchArticle({ data: { slug: params.slug } }),
  component: ArticlePage,
})

function languageName(code: string): string {
  return LOCALE_LABELS[code as keyof typeof LOCALE_LABELS] ?? code
}

function ArticlePage() {
  const result = Route.useLoaderData()
  const article = () => {
    const loaded = result()
    return loaded.ok ? loaded.value : null
  }
  const refusal = () => {
    const loaded = result()
    return loaded.ok ? null : loaded.code
  }

  return (
    <main class="min-h-screen bg-white px-4 py-12">
      <div class="mx-auto w-full max-w-2xl">
        <div class="mb-6 flex items-center justify-between gap-4">
          <Link to="/articles" class="text-sm text-[#00209F] hover:underline">
            ← {m.articles_backToIndex()}
          </Link>
          <LanguageSwitcher />
        </div>

        <Show when={article()} fallback={<Refusal code={refusal()} />}>
          {(loaded) => (
            <article>
              <Show when={loaded().lang !== loaded().requestedLang}>
                {/*
                 * Never require every language. An author writes what they can;
                 * a reader who lands on a language nobody has written yet gets
                 * the article with an honest note rather than a 404.
                 */}
                <aside class="mb-6 rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm">
                  <p class="font-medium text-amber-900">
                    {m.articles_fallbackTitle({
                      language: languageName(loaded().requestedLang),
                    })}
                  </p>
                  <p class="mt-1 text-amber-800">
                    {m.articles_fallbackBody({ shown: languageName(loaded().lang) })}
                  </p>
                </aside>
              </Show>

              <Show when={loaded().visibility === 'members'}>
                <p class="mb-3 inline-block rounded bg-neutral-900 px-2 py-0.5 text-xs font-medium text-white">
                  {m.articles_membersOnly()}
                </p>
              </Show>

              <h1 class="text-3xl leading-tight font-bold text-neutral-900">
                {loaded().title}
              </h1>
              <p class="mt-3 text-base text-neutral-600">{loaded().summary}</p>
              <p class="mt-3 text-xs text-neutral-500">
                {m.articles_by()} {loaded().authorName}
                <Show when={loaded().publishedAt}>
                  {(date) => <> · {new Date(date()).toLocaleDateString()}</>}
                </Show>{' '}
                · {m.articles_readingTime({ minutes: loaded().readingMinutes })}
              </p>

              {/*
               * Safe because this string was produced by `renderDocumentToHtml`
               * on the server, from a document parsed against the allowlist in
               * `lib/prosemirror.ts` on the way in and again on the way out. No
               * author-supplied text reaches it without `escapeHtml`, and the
               * only attributes in it are ones the renderer writes itself.
               */}
              <div class="article-prose mt-8" innerHTML={loaded().html} />

              <Show when={loaded().availableLangs.length > 1}>
                <footer class="mt-10 border-t border-neutral-200 pt-4 text-sm text-neutral-600">
                  {m.articles_availableIn()}{' '}
                  <For each={loaded().availableLangs.filter((l) => l !== loaded().lang)}>
                    {(lang) => <span class="mr-2">{languageName(lang)}</span>}
                  </For>
                </footer>
              </Show>

              <DiscussionTail slug={loaded().slug} tail={loaded().discussion} />
            </article>
          )}
        </Show>
      </div>
    </main>
  )
}

/**
 * A refusal, not a 404.
 *
 * A members-only article somebody was linked to should say so and offer the way
 * in. Answering "not found" to a reader who has an account and simply is not
 * signed in would be a lie they cannot act on.
 */
function Refusal(props: { code: string | null }) {
  return (
    <div class="rounded-lg border border-neutral-200 bg-neutral-50 p-6">
      <p class="text-sm text-neutral-700">
        {props.code === 'FORBIDDEN'
          ? m.articles_errors_forbidden()
          : m.articles_errors_notFound()}
      </p>
      <Show when={props.code === 'FORBIDDEN'}>
        <Link
          to="/auth/login"
          class="mt-4 inline-flex h-10 items-center justify-center rounded-md bg-[#00209F] px-4 text-sm font-semibold text-white hover:opacity-95"
        >
          {m.articles_signIn()}
        </Link>
      </Show>
    </div>
  )
}

/**
 * The last few things said about this article, and the way in.
 *
 * Server-rendered, like the article above it, and it runs nothing: no poller,
 * no composer, no client module of its own. A reader who only wanted the
 * article pays for none of the forum, and one who wants the argument follows
 * the link to a page where spending bytes is the point.
 *
 * The count is here rather than only on the other page because a published
 * article with a visible "14 responses" is an invitation and a silent link is
 * not.
 */
function DiscussionTail(props: { slug: string; tail: Tail }) {
  return (
    <section class="mt-12 border-t border-neutral-200 pt-6">
      <h2 class="text-lg font-semibold text-neutral-900">
        {props.tail.total > 0
          ? m.forum_responses({ count: props.tail.total })
          : m.forum_noResponses()}
      </h2>

      <ol class="mt-4 flex flex-col gap-4">
        <For each={props.tail.recent}>{(post) => <TailPost post={post} />}</For>
      </ol>

      <Link
        to="/articles/$slug/discussion"
        params={{ slug: props.slug }}
        class="mt-6 inline-flex h-10 items-center justify-center rounded-md border border-[#00209F] px-4 text-sm font-semibold text-[#00209F] hover:bg-[#00209F]/5"
      >
        {props.tail.total > 0 ? m.forum_readFullThread() : m.forum_join()}
      </Link>
    </section>
  )
}

/** One post in the tail. Text nodes only — see `DiscussionThread`. */
function TailPost(props: { post: Tail['recent'][number] }) {
  return (
    <li class="rounded-lg border border-neutral-200 bg-neutral-50 p-4">
      <p class="text-sm font-medium text-neutral-900">
        {props.post.authorName}
        <span class="ml-2 text-xs font-normal text-neutral-500">
          {new Date(props.post.createdAt).toLocaleDateString()}
        </span>
      </p>
      {/*
       * One element, not a paragraph each: `whitespace-pre-line` renders the
       * blank lines the server already normalised, and this page does not
       * import the splitter for a difference nobody can see. The text is a
       * text node — the `innerHTML` above is safe only because the renderer
       * wrote it, and a forum post is written by whoever registered today.
       */}
      <p class="mt-1 text-sm whitespace-pre-line text-neutral-700">{props.post.body}</p>
    </li>
  )
}
