import { createFileRoute, Link } from '@tanstack/solid-router'
import { For, Show } from 'solid-js'
import LanguageSwitcher from '../../../components/LanguageSwitcher'
import { LOCALE_LABELS } from '../../../i18n'
import { fetchArticleIndex } from '../../../lib/article-actions'
import { m } from '../../../paraglide/messages'

/**
 * The public index.
 *
 * No guard. Reading the movement's articles must never require an account —
 * reach is the point (DECISIONS.md, D1) — and the server function decides for
 * itself whether the caller gets the `members` articles as well.
 */
export const Route = createFileRoute('/_app/articles/')({
  loader: () => fetchArticleIndex(),
  component: ArticleIndex,
})

function ArticleIndex() {
  const articles = Route.useLoaderData()

  return (
    <main class="min-h-screen bg-neutral-50 px-4 py-12">
      <div class="mx-auto w-full max-w-3xl">
        <div class="mb-4 flex items-center justify-between gap-4">
          <h1 class="text-2xl font-bold text-neutral-900">{m.articles_title()}</h1>
          <LanguageSwitcher />
        </div>
        <p class="mb-6 text-sm text-neutral-600">{m.articles_subtitle()}</p>

        <Show
          when={articles().length > 0}
          fallback={
            <p class="rounded-lg border border-neutral-200 bg-white p-6 text-sm text-neutral-600">
              {m.articles_empty()}
            </p>
          }
        >
          <ul class="flex flex-col gap-4">
            <For each={articles()}>
              {(card) => (
                <li class="rounded-lg border border-neutral-200 bg-white p-6">
                  <div class="mb-1 flex flex-wrap items-center gap-2 text-xs text-neutral-500">
                    <Show when={card.visibility === 'members'}>
                      <span class="rounded bg-neutral-900 px-2 py-0.5 font-medium text-white">
                        {m.articles_membersOnly()}
                      </span>
                    </Show>
                    {/* An honest label rather than a silent substitution: the
                        reader can see they are being shown another language. */}
                    <Show when={card.isFallback}>
                      <span class="rounded bg-neutral-200 px-2 py-0.5 font-medium text-neutral-700">
                        {LOCALE_LABELS[card.lang as 'fr'] ?? card.lang}
                      </span>
                    </Show>
                    <Show when={card.publishedAt}>
                      {(date) => (
                        <span>
                          {m.articles_publishedOn()}{' '}
                          {new Date(date()).toLocaleDateString()}
                        </span>
                      )}
                    </Show>
                  </div>
                  <h2 class="text-lg font-semibold text-neutral-900">
                    <Link
                      to="/articles/$slug"
                      params={{ slug: card.slug }}
                      class="hover:underline"
                    >
                      {card.title}
                    </Link>
                  </h2>
                  <p class="mt-1 text-sm text-neutral-700">{card.summary}</p>
                  <p class="mt-2 text-xs text-neutral-500">
                    {m.articles_by()} {card.authorName}
                  </p>
                </li>
              )}
            </For>
          </ul>
        </Show>
      </div>
    </main>
  )
}
