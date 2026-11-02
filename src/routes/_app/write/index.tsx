import { createFileRoute, Link, useNavigate, useRouter } from '@tanstack/solid-router'
import { createSignal, For, Show } from 'solid-js'
import Icon from '../../../components/Icon'
import { LOCALE_LABELS, LOCALES } from '../../../i18n'
import {
  createArticleAction,
  fetchMyArticles,
} from '../../../lib/articles/article-actions'
import { ARTICLE_ERROR_MESSAGE } from '../../../lib/articles/article-messages'
import { ICON_PEN, ICON_PLUS } from '../../../lib/shared/icons'
import {
  MIN_ARTICLE_SUMMARY_CHARS,
  MIN_ARTICLE_TITLE_CHARS,
} from '../../../lib/shared/validation'
import { m } from '../../../paraglide/messages'

/**
 * The author's desk.
 *
 * The loader's server function re-checks the role itself, which is the check
 * that matters; a reader who reaches this URL gets an empty desk rather than a
 * page they cannot use.
 */
export const Route = createFileRoute('/_app/write/')({
  loader: () => fetchMyArticles(),
  component: WriteDesk,
})

function statusLabel(status: string): string {
  if (status === 'published') return m.write_status_published()
  if (status === 'new') return m.write_status_new()
  return m.write_status_draft()
}

function WriteDesk() {
  const articles = Route.useLoaderData()
  const navigate = useNavigate()
  const router = useRouter()

  const [title, setTitle] = createSignal('')
  const [summary, setSummary] = createSignal('')
  const [visibility, setVisibility] = createSignal<'public' | 'members'>('public')
  const [busy, setBusy] = createSignal(false)
  const [error, setError] = createSignal('')

  async function create(event: SubmitEvent) {
    event.preventDefault()
    setBusy(true)
    setError('')
    try {
      const result = await createArticleAction({
        data: { title: title(), summary: summary(), visibility: visibility() },
      })
      if (!result.ok) {
        setError(ARTICLE_ERROR_MESSAGE[result.code]())
        return
      }
      await router.invalidate()
      navigate({ to: '/write/$articleId', params: { articleId: result.value.articleId } })
    } catch {
      setError(m.write_errors_unexpected())
    } finally {
      setBusy(false)
    }
  }

  return (
    <main class="flex-1 bg-neutral-50 px-4 py-12">
      <div class="mx-auto w-full max-w-3xl">
        <div class="mb-4 flex items-center justify-between gap-4">
          <h1 class="font-serif text-3xl font-bold text-neutral-900">
            {m.write_title()}
          </h1>
        </div>
        <p class="mb-6 text-sm text-neutral-600">{m.write_subtitle()}</p>

        <section class="mb-8 rounded-xl border border-line bg-raised p-6">
          <h2 class="flex items-center gap-2 text-lg font-bold text-ink">
            <Icon d={ICON_PLUS} class="size-5 text-accent" />
            {m.write_newTitle()}
          </h2>
          <p class="mt-1 mb-4 text-sm text-neutral-600">{m.write_newSubtitle()}</p>

          <form onSubmit={create} class="flex flex-col gap-4">
            <label class="flex flex-col gap-1 text-sm">
              <span class="font-medium text-neutral-800">{m.write_titleLabel()}</span>
              <span class="text-xs text-neutral-500">{m.write_titleHint()}</span>
              <input
                name="title"
                value={title()}
                minlength={MIN_ARTICLE_TITLE_CHARS}
                required
                onInput={(e) => setTitle(e.currentTarget.value)}
                class="h-10 rounded-md border border-neutral-300 px-3 outline-none focus:border-accent focus:ring-2 focus:ring-accent/20"
              />
            </label>

            <label class="flex flex-col gap-1 text-sm">
              <span class="font-medium text-neutral-800">{m.write_summaryLabel()}</span>
              <span class="text-xs text-neutral-500">{m.write_summaryHint()}</span>
              {/*
               * `prop:value`, not `value`. Solid's SSR writes a textarea's
               * value as a child text node while the client template has no
               * child at all, so `value={…}` leaves the two sides one node
               * apart and hydration silently detaches everything after it —
               * the list below stops responding to clicks. `prop:` is ignored
               * on the server, so both sides render an empty textarea and the
               * client sets the property after hydration.
               */}
              <textarea
                name="summary"
                rows="3"
                minlength={MIN_ARTICLE_SUMMARY_CHARS}
                required
                onInput={(e) => setSummary(e.currentTarget.value)}
                class="rounded-md border border-neutral-300 px-3 py-2 outline-none focus:border-accent focus:ring-2 focus:ring-accent/20"
              />
            </label>

            <label class="flex flex-col gap-1 text-sm">
              <span class="font-medium text-neutral-800">
                {m.write_visibilityLabel()}
              </span>
              <span class="text-xs text-neutral-500">{m.write_visibilityHint()}</span>
              <select
                name="visibility"
                value={visibility()}
                onChange={(e) =>
                  setVisibility(
                    e.currentTarget.value === 'members' ? 'members' : 'public',
                  )
                }
                class="h-10 rounded-md border border-neutral-300 px-3 outline-none focus:border-accent focus:ring-2 focus:ring-accent/20"
              >
                <option value="public">{m.write_visibilityPublic()}</option>
                <option value="members">{m.write_visibilityMembers()}</option>
              </select>
            </label>

            <div>
              <button
                type="submit"
                disabled={busy()}
                class="inline-flex min-h-11 items-center gap-2 rounded-lg bg-accent px-4 font-semibold text-on-accent hover:bg-accent-hover disabled:opacity-60"
              >
                <Icon d={ICON_PLUS} />
                {busy() ? m.write_creating() : m.write_create()}
              </button>
            </div>

            <div aria-live="polite" class="min-h-5 text-sm">
              <Show when={error()}>
                {(message) => <p class="text-danger">{message()}</p>}
              </Show>
            </div>
          </form>
        </section>

        <Show
          when={articles().length > 0}
          fallback={
            <p class="rounded-lg border border-neutral-200 bg-white p-6 text-sm text-neutral-600">
              {m.write_empty()}
            </p>
          }
        >
          <ul class="flex flex-col gap-3">
            <For each={articles()}>
              {(item) => (
                <li class="rounded-xl border border-line bg-raised p-5">
                  <div class="flex items-start justify-between gap-4">
                    <div class="min-w-0">
                      <p class="truncate font-serif text-lg font-bold text-ink">
                        {item.translations[0]?.title || item.slug}
                      </p>
                      <p class="mt-1 text-xs text-neutral-500">
                        /{item.slug} ·{' '}
                        {item.visibility === 'members'
                          ? m.write_visibilityMembers()
                          : m.write_visibilityPublic()}
                      </p>
                    </div>
                    <Link
                      to="/write/$articleId"
                      params={{ articleId: item.articleId }}
                      class="inline-flex min-h-11 shrink-0 items-center gap-2 rounded-lg bg-accent px-4 font-semibold text-on-accent hover:bg-accent-hover"
                    >
                      <Icon d={ICON_PEN} class="size-4" />
                      {m.write_open()}
                    </Link>
                  </div>

                  {/*
                   * Every language, present or not. A missing language is the
                   * thing an author most needs to see on this page, so the ones
                   * they have not started are listed too rather than left out —
                   * including English and Spanish, which an author may write if
                   * they want to and the circle can review.
                   */}
                  <ul class="mt-3 flex flex-wrap gap-2 text-xs">
                    <For each={LOCALES}>
                      {(lang) => (
                        <li>
                          <Link
                            to="/write/$articleId"
                            params={{ articleId: item.articleId }}
                            search={{ lang }}
                            class="rounded border border-neutral-200 px-2 py-1 text-neutral-700 hover:bg-neutral-50"
                          >
                            {LOCALE_LABELS[lang]} ·{' '}
                            {statusLabel(
                              item.translations.find((t) => t.lang === lang)?.status ??
                                'new',
                            )}
                          </Link>
                        </li>
                      )}
                    </For>
                  </ul>
                </li>
              )}
            </For>
          </ul>
        </Show>
      </div>
    </main>
  )
}
