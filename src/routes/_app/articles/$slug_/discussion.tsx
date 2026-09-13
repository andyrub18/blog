import { createFileRoute, Link } from '@tanstack/solid-router'
import { Show } from 'solid-js'
import DiscussionThread from '../../../../components/forum/DiscussionThread'
import LanguageSwitcher from '../../../../components/LanguageSwitcher'
import { fetchDiscussion } from '../../../../lib/forum-actions'
import { m } from '../../../../paraglide/messages'

/**
 * The discussion, on its own page.
 *
 * Deliberately not part of the article page. The reading view is the one this
 * project's 100 KB budget is written for and it ships no JavaScript of its own;
 * a poller and a composer on it would be paid for by every reader who only
 * wanted to read. Here the reader has asked for the argument, which is a fair
 * place to spend bytes — the same bargain the editor makes.
 *
 * The thread is still server-rendered first, so it is readable before anything
 * runs, and on a slow connection that first paint is most of the value.
 */
export const Route = createFileRoute('/_app/articles/$slug_/discussion')({
  loader: ({ params }) => fetchDiscussion({ data: { slug: params.slug } }),
  component: DiscussionPage,
})

function DiscussionPage() {
  const result = Route.useLoaderData()
  const discussion = () => {
    const loaded = result()
    return loaded.ok ? loaded.value : null
  }
  const refusal = () => {
    const loaded = result()
    return loaded.ok ? null : loaded.code
  }

  return (
    <main class="min-h-screen bg-neutral-50 px-4 py-12">
      <div class="mx-auto w-full max-w-2xl">
        <div class="mb-6 flex items-center justify-between gap-4">
          <Link
            to="/articles/$slug"
            params={{ slug: Route.useParams()().slug }}
            class="text-sm text-[#00209F] hover:underline"
          >
            ← {m.forum_backToArticle()}
          </Link>
          <LanguageSwitcher />
        </div>

        <Show
          when={discussion()}
          fallback={
            <div class="rounded-lg border border-neutral-200 bg-white p-6">
              <p class="text-sm text-neutral-700">
                {refusal() === 'FORBIDDEN'
                  ? m.forum_errors_forbidden()
                  : m.forum_errors_notFound()}
              </p>
            </div>
          }
        >
          {(loaded) => (
            <>
              <h1 class="text-2xl font-bold text-neutral-900">{m.forum_title()}</h1>
              <p class="mt-1 mb-6 text-sm text-neutral-600">
                {m.forum_aboutArticle({ title: loaded().title })}
              </p>
              <DiscussionThread initial={loaded()} />
            </>
          )}
        </Show>
      </div>
    </main>
  )
}
