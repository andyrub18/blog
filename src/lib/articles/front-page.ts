import { LOCALE_LABELS, type Locale } from '../../i18n'
import { m } from '../../paraglide/messages'
import { localizeHref } from '../../paraglide/runtime'
import type { Role } from '../db/schema'
import {
  ICON_APPLICATIONS,
  ICON_APPLY,
  ICON_BOOK,
  ICON_DELIBERATION,
  ICON_PEN,
  ICON_PROBATION,
  iconSvg,
} from '../shared/icons'
import type { ArticleCard } from './articles'
import { escapeHtml as e } from './prosemirror'

/**
 * The home page and the article index, as markup. **Server only** — reached
 * through a dynamic import inside the server functions in `article-actions.ts`.
 *
 * Neither page does anything but link, and both are mostly words: a paragraph
 * on how a text gets published, three steps, two kinds of account. Written as
 * components, every one of those sentences shipped to the browser in all four
 * languages, because a Paraglide message carries every translation — the home
 * page measured 105.9 KB against a 100 KB budget. Rendered here, the reader gets
 * one language, as HTML, and the page ships no JavaScript of its own: the
 * reading view's approach (`renderOutlineToHtml`), for the same reason.
 *
 * Every value that comes from the database or an account — titles, summaries,
 * names — goes through `escapeHtml`, and so does every message, so the string
 * can be given to `innerHTML`. Links are plain `<a href>`, localized here.
 */

const BUTTON =
  'inline-flex min-h-12 items-center justify-center rounded-lg bg-accent px-5 font-semibold text-on-accent hover:bg-accent-hover'
const BUTTON_QUIET =
  'inline-flex min-h-12 items-center justify-center rounded-lg border border-accent-line bg-raised px-5 font-semibold text-accent hover:bg-accent-soft'
const SECTION_TITLE = 'font-serif text-3xl font-bold'
/** An icon in a soft square, at the head of a card. */
const badge = (d: string) =>
  `<span class="inline-flex size-11 items-center justify-center rounded-xl bg-accent-soft text-accent">${iconSvg(d, 'size-6')}</span>`

export type FrontPageUser = { name: string; role: Role }

export function renderFrontPage(input: {
  user: FrontPageUser | null
  articles: Array<ArticleCard>
  lang: Locale
}): string {
  const href = (path: string) => e(localizeHref(path, { locale: input.lang }))
  const latest =
    input.articles.length === 0
      ? ''
      : `<section class="border-y border-line bg-surface px-4 py-14 md:px-6"><div class="mx-auto max-w-6xl">` +
        `<div class="flex flex-wrap items-baseline justify-between gap-3"><h2 class="${SECTION_TITLE}">${e(m.home_latest())}</h2>` +
        `<a href="${href('/articles')}" class="font-semibold text-accent hover:underline">${e(m.articles_backToIndex())} →</a></div>` +
        `<div class="mt-7 grid gap-6 md:grid-cols-2 lg:grid-cols-3">${input.articles
          .map((card) => renderArticleCard(card, 'h3', input.lang))
          .join('')}</div></div></section>`

  if (input.user) return renderDesk(input.user, href) + latest

  const steps = [
    [m.home_step1Title(), m.home_step1Body()],
    [m.home_step2Title(), m.home_step2Body()],
    [m.home_step3Title(), m.home_step3Body()],
  ]
    .map(
      ([title, body], index) =>
        `<li class="flex flex-col gap-2.5"><span aria-hidden="true" class="inline-flex size-11 items-center justify-center rounded-full border-2 border-accent font-serif text-xl font-bold text-accent">${index + 1}</span>` +
        `<h3 class="text-lg font-bold">${e(title)}</h3><p class="leading-relaxed text-ink-soft">${e(body)}</p></li>`,
    )
    .join('')

  return (
    // The welcome. The emblem is decorative here: the movement is named in the
    // header and in the line above the title.
    `<section class="px-4 py-14 md:px-6 md:py-20"><div class="mx-auto flex max-w-6xl flex-wrap items-center gap-12">` +
    `<div class="flex min-w-0 flex-[1_1_30rem] flex-col gap-5">` +
    `<p class="text-sm font-bold tracking-[0.08em] text-accent uppercase">${e(m.common_appFullName())}</p>` +
    `<h1 class="max-w-[17ch] font-serif text-4xl leading-[1.08] font-bold md:text-[3.25rem]">${e(m.articles_subtitle())}</h1>` +
    `<p class="max-w-[58ch] text-lg leading-relaxed text-ink-soft">${e(m.home_lead())}</p>` +
    `<div class="mt-2 flex flex-wrap gap-3"><a href="${href('/articles')}" class="${BUTTON}">${e(m.home_readArticles())}</a>` +
    `<a href="${href('/auth/register')}" class="${BUTTON_QUIET}">${e(m.auth_login_register())}</a></div>` +
    `<p class="text-[15px] text-ink-soft">${e(m.auth_register_common_haveAccount())} <a href="${href('/auth/login')}" class="font-semibold text-accent hover:underline">${e(m.articles_signIn())}</a></p>` +
    `</div><img src="/emblem.png" alt="" width="213" height="320" class="mx-auto h-80 w-[213px]"></div></section>` +
    latest +
    // How a text gets published: the reason to trust what is on this site.
    `<section class="px-4 py-16 md:px-6"><div class="mx-auto max-w-6xl">` +
    `<h2 class="${SECTION_TITLE}">${e(m.home_howTitle())}</h2><p class="mt-3 max-w-2xl text-[17px] text-ink-soft">${e(m.home_howLead())}</p>` +
    `<ol class="mt-8 grid gap-8 md:grid-cols-3">${steps}</ol></div></section>` +
    // The two kinds of account.
    `<section class="px-4 pb-20 md:px-6"><div class="mx-auto max-w-6xl"><h2 class="${SECTION_TITLE}">${e(m.home_joinTitle())}</h2><div class="mt-6 grid gap-6 md:grid-cols-2">` +
    `<div class="flex flex-col items-start gap-3 rounded-xl border border-line bg-raised p-7">${badge(ICON_BOOK)}<h3 class="font-serif text-2xl font-bold">${e(m.auth_register_readerTitle())}</h3>` +
    `<p class="leading-relaxed text-ink-soft">${e(m.auth_register_readerDescription())}</p><a href="${href('/auth/register/reader')}" class="${BUTTON_QUIET}">${e(m.auth_register_readerCta())}</a></div>` +
    `<div class="flex flex-col items-start gap-3 rounded-xl border border-accent-line bg-accent-soft p-7"><span class="inline-flex size-11 items-center justify-center rounded-xl bg-accent text-on-accent">${iconSvg(ICON_PEN, 'size-6')}</span><h3 class="font-serif text-2xl font-bold">${e(m.auth_register_memberTitle())}</h3>` +
    `<p class="leading-relaxed text-ink-soft">${e(m.auth_register_memberDescription())}</p><a href="${href('/auth/register/member')}" class="${BUTTON}">${e(m.auth_register_memberCta())}</a></div>` +
    `</div></div></section>`
  )
}

/**
 * What is waiting for the person signed in: a door into each part of the site
 * their role opens. The review queues used to be reachable only by knowing
 * their address.
 */
function renderDesk(user: FrontPageUser, href: (path: string) => string): string {
  const senior = user.role === 'senior_member' || user.role === 'super_admin'
  const role = {
    reader: m.auth_register_readerTitle,
    member: m.auth_register_memberTitle,
    senior_member: m.common_roleSenior,
    super_admin: m.common_roleAdmin,
  }[user.role]()
  const door = (path: string, icon: string, title: string, text: string) =>
    `<a href="${href(path)}" class="flex flex-col gap-2 rounded-xl border border-line bg-raised p-6 hover:border-accent-line">` +
    `${badge(icon)}<span class="mt-1 text-[17px] font-bold text-ink">${e(title)}</span><span class="flex-1 text-[15px] leading-relaxed text-ink-soft">${e(text)}</span>` +
    `<span class="font-semibold text-accent">${e(m.write_open())} →</span></a>`

  const doors = [
    senior
      ? door('/review', ICON_APPLICATIONS, m.review_title(), m.review_subtitle())
      : '',
    senior
      ? door(
          '/review/articles',
          ICON_DELIBERATION,
          m.deliberation_title(),
          m.deliberation_subtitle(),
        )
      : '',
    senior
      ? door(
          '/review/probation',
          ICON_PROBATION,
          m.probation_title(),
          m.probation_subtitle(),
        )
      : '',
    user.role !== 'reader'
      ? door('/write', ICON_PEN, m.write_title(), m.write_subtitle())
      : '',
    // The promotion path: read and take part first, then apply.
    user.role === 'reader'
      ? door('/apply', ICON_APPLY, m.apply_title(), m.apply_subtitle())
      : '',
    user.role === 'reader'
      ? door('/articles', ICON_BOOK, m.articles_title(), m.articles_subtitle())
      : '',
  ].join('')

  return (
    `<section class="px-4 py-12 md:px-6"><div class="mx-auto max-w-6xl"><div class="flex flex-wrap items-center gap-3">` +
    `<h1 class="font-serif text-4xl font-bold">${e(m.home_greeting({ name: user.name }))}</h1>` +
    `<span class="rounded-full bg-accent-soft px-3 py-1 text-sm font-bold text-accent">${e(role)}</span></div>` +
    `<h2 class="mt-8 font-serif text-2xl font-bold">${e(m.home_waiting())}</h2>` +
    `<div class="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">${doors}</div></div></section>`
  )
}

/** The public index: every published article the viewer may read. */
export function renderArticleIndex(input: {
  articles: Array<ArticleCard>
  lang: Locale
}): string {
  const list =
    input.articles.length === 0
      ? `<p class="mt-8 rounded-xl border border-line bg-surface p-6 text-ink-soft">${e(m.articles_empty())}</p>`
      : `<ul class="mt-8 flex flex-col gap-4">${input.articles
          .map((card) => `<li>${renderArticleCard(card, 'h2', input.lang)}</li>`)
          .join('')}</ul>`
  return (
    `<div class="mx-auto w-full max-w-3xl"><h1 class="font-serif text-4xl font-bold md:text-[2.75rem]">${e(m.articles_title())}</h1>` +
    `<p class="mt-3 text-lg text-ink-soft">${e(m.articles_subtitle())}</p>${list}</div>`
  )
}

/**
 * One published article in a list. The heading level is the caller's, because
 * the same card sits under the index's `h1` and under the home page's `h2`.
 */
export function renderArticleCard(
  card: ArticleCard,
  heading: 'h2' | 'h3',
  lang: Locale,
): string {
  const href = e(
    localizeHref(`/articles/${encodeURIComponent(card.slug)}`, { locale: lang }),
  )
  const badges =
    (card.visibility === 'members'
      ? `<span class="rounded-full bg-red-50 px-2.5 py-1 text-red-700">${e(m.articles_membersOnly())}</span>`
      : '') +
    // An honest label rather than a silent substitution: the reader can see
    // they are being shown another language.
    (card.isFallback
      ? `<span class="rounded-full bg-accent-soft px-2.5 py-1 text-accent">${e(LOCALE_LABELS[card.lang as Locale] ?? card.lang)}</span>`
      : '')
  const published = card.publishedAt
    ? `<span>${e(m.articles_publishedOn())} ${e(new Intl.DateTimeFormat(lang, { dateStyle: 'long' }).format(card.publishedAt))}</span>`
    : ''
  return (
    `<article class="flex h-full flex-col gap-3 rounded-xl border border-line bg-raised p-6">` +
    (badges
      ? `<div class="flex flex-wrap items-center gap-2 text-xs font-bold">${badges}</div>`
      : '') +
    `<${heading} class="font-serif text-[1.4rem] leading-snug font-bold text-ink"><a href="${href}" class="hover:text-accent hover:underline">${e(card.title)}</a></${heading}>` +
    `<p class="flex-1 text-[15px] leading-relaxed text-ink-soft">${e(card.summary)}</p>` +
    `<p class="flex flex-wrap gap-x-3 border-t border-line pt-3 text-sm text-muted"><span>${e(m.articles_by())} ${e(card.authorName)}</span>${published}</p>` +
    `</article>`
  )
}
