import { createFileRoute, Link } from '@tanstack/solid-router'
import { For, Show } from 'solid-js'
import VersionChanges from '../../../../components/articles/VersionChanges'
import LanguageSwitcher from '../../../../components/LanguageSwitcher'
import { fetchVersionHistory } from '../../../../lib/articles/version-actions'
import { m } from '../../../../paraglide/messages'
import { getLocale } from '../../../../paraglide/runtime'

/**
 * An article's approved versions, and what each one changed (D31).
 *
 * Readers asked to be able to tell whether an article has changed since they
 * read it. A separate page, like the discussion, so the reading view pays
 * nothing for it but a link; the comparisons are built on the server and
 * arrive as markup.
 */
export const Route = createFileRoute('/_app/articles/$slug_/versions')({
  loader: ({ params }) => fetchVersionHistory({ data: { slug: params.slug } }),
  component: VersionsPage,
})

function VersionsPage() {
  const result = Route.useLoaderData()
  const history = () => {
    const loaded = result()
    return loaded.ok ? loaded.value : null
  }
  const date = (value: Date | null) =>
    value
      ? new Intl.DateTimeFormat(getLocale(), { dateStyle: 'long' }).format(
          new Date(value),
        )
      : '—'

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
          when={history()}
          fallback={
            <div class="rounded-lg border border-neutral-200 bg-white p-6">
              <p class="text-sm text-neutral-700">{m.versions_notFound()}</p>
            </div>
          }
        >
          {(loaded) => (
            <div class="flex flex-col gap-6">
              <header>
                <p class="text-xs font-medium uppercase tracking-wide text-neutral-500">
                  {m.articles_versionHistory()}
                </p>
                <h1 class="mt-1 text-2xl font-bold text-neutral-900">{loaded().title}</h1>
                <p class="mt-2 text-sm text-neutral-600">{m.versions_intro()}</p>
              </header>
              <For each={loaded().entries}>
                {(entry) => (
                  <section
                    class="rounded-lg border border-neutral-200 bg-white p-6"
                    data-testid="version-entry"
                  >
                    <h2 class="text-lg font-semibold text-neutral-900">
                      {m.articles_versionLine({
                        number: String(entry.number),
                        date: date(entry.approvedAt),
                      })}
                    </h2>
                    <Show
                      when={entry.comparison.previous}
                      fallback={
                        <p class="mt-2 text-sm text-neutral-600">{m.versions_first()}</p>
                      }
                    >
                      {(previous) => (
                        <>
                          <p class="mt-2 text-sm font-medium text-neutral-800">
                            {m.versions_comparedTo({ number: String(previous().number) })}
                          </p>
                          <VersionChanges comparison={entry.comparison} />
                        </>
                      )}
                    </Show>
                  </section>
                )}
              </For>
            </div>
          )}
        </Show>
      </div>
    </main>
  )
}
