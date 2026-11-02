import { Link } from '@tanstack/solid-router'
import { createEffect, Show } from 'solid-js'
import type { SessionUser } from '../../lib/auth/session'
import { m } from '../../paraglide/messages'
import { getLocale } from '../../paraglide/runtime'
import LogoutButton from '../auth/LogoutButton'
import LanguageSwitcher from '../LanguageSwitcher'

const NAV_LINK =
  'inline-flex min-h-11 items-center rounded-md px-3 text-[15px] font-semibold text-neutral-700 hover:bg-neutral-100 hover:text-accent'
const NAV_ACTIVE = { class: 'bg-accent-soft text-accent' }
const PILL =
  'inline-flex min-h-11 items-center gap-1.5 rounded-lg border border-line bg-raised px-2.5 text-sm font-semibold text-neutral-700 hover:border-neutral-300'
const PANEL =
  'absolute top-[calc(100%+8px)] right-0 z-30 flex min-w-60 flex-col rounded-xl border border-line bg-raised p-1.5 shadow-lg'
const ITEM =
  'flex min-h-11 w-full items-center rounded-lg px-3 text-left text-[15px] text-ink hover:bg-neutral-100 hover:text-accent'
const PRIMARY =
  'inline-flex min-h-11 items-center justify-center rounded-lg bg-accent px-4 text-[15px] font-semibold whitespace-nowrap text-on-accent hover:bg-accent-hover'

function Chevron() {
  return (
    <svg
      aria-hidden="true"
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
    >
      <path d="m6 9 6 6 6-6" />
    </svg>
  )
}

/**
 * The header on every page: where the reader is, and where they can go.
 *
 * Its three menus — language, account, and the phone's "Menu" — are `<details>`
 * elements, so they open before the bundle has arrived, on the connection where
 * that takes longest. The only script here closes an open menu once a choice
 * has been made in it or the reader clicks elsewhere, which a `<details>` does
 * not do by itself and a client-side navigation would otherwise leave open.
 */
export default function SiteHeader(props: { user: SessionUser | null }) {
  let header!: HTMLElement
  const canWrite = () => !!props.user && props.user.role !== 'reader'
  const canReview = () =>
    props.user?.role === 'senior_member' || props.user?.role === 'super_admin'

  createEffect(
    () => undefined,
    () => {
      const close = (event: MouseEvent) => {
        const target = event.target as Element
        for (const menu of header.querySelectorAll('details[open]')) {
          if (!menu.contains(target) || target.closest('a, button'))
            menu.removeAttribute('open')
        }
      }
      document.addEventListener('click', close)
      return () => document.removeEventListener('click', close)
    },
  )

  return (
    <header ref={header} class="relative border-b border-line bg-page">
      <div aria-hidden="true" class="flex h-1">
        <div class="flex-1 bg-flag-blue" />
        <div class="flex-1 bg-flag-red" />
      </div>
      <div class="mx-auto flex max-w-6xl items-center gap-3 px-4 py-2 md:gap-6 md:px-6">
        <Link to="/" class="flex shrink-0 items-center gap-2.5 text-ink">
          <img
            src="/emblem-mark.png"
            alt=""
            width="30"
            height="44"
            class="h-11 w-[30px]"
          />
          <span class="flex flex-col gap-0.5">
            <span class="font-serif text-[23px] leading-none font-bold tracking-[0.06em]">
              {m.common_appName()}
            </span>
            <span class="hidden text-xs text-muted lg:block">
              {m.common_appFullName()}
            </span>
          </span>
        </Link>

        <nav aria-label={m.common_mainNav()} class="hidden items-center gap-1 md:flex">
          <Link to="/articles" class={NAV_LINK} activeProps={NAV_ACTIVE}>
            {m.articles_nav()}
          </Link>
          <Show when={canWrite()}>
            <Link to="/write" class={NAV_LINK} activeProps={NAV_ACTIVE}>
              {m.write_nav()}
            </Link>
          </Show>
          <Show when={canReview()}>
            <Link to="/review" class={NAV_LINK} activeProps={NAV_ACTIVE}>
              {m.review_nav()}
            </Link>
          </Show>
        </nav>

        <div class="ml-auto flex items-center gap-2">
          <details class="site-menu relative">
            <summary class={PILL}>
              <svg
                aria-hidden="true"
                width="18"
                height="18"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
              >
                <circle cx="12" cy="12" r="9" />
                <path d="M3 12h18M12 3a14 14 0 0 1 0 18a14 14 0 0 1 0-18z" />
              </svg>
              <span class="sr-only">{m.common_switchLanguage()} : </span>
              {getLocale().toUpperCase()}
              <Chevron />
            </summary>
            <div class={PANEL}>
              <LanguageSwitcher />
            </div>
          </details>

          <Show
            when={props.user}
            fallback={
              <div class="hidden items-center gap-2 md:flex">
                <Link
                  to="/auth/login"
                  class="inline-flex min-h-11 items-center rounded-lg px-3.5 text-[15px] font-semibold text-accent hover:bg-accent-soft"
                >
                  {m.articles_signIn()}
                </Link>
                <Link to="/auth/register" class={PRIMARY}>
                  {m.auth_login_register()}
                </Link>
              </div>
            }
          >
            {(user) => (
              <details class="site-menu relative">
                <summary class={PILL}>
                  <span
                    aria-hidden="true"
                    class="inline-flex size-7 items-center justify-center rounded-full bg-accent text-xs font-bold text-on-accent"
                  >
                    {user().name.trim().charAt(0).toUpperCase()}
                  </span>
                  <span class="max-md:sr-only">{user().name}</span>
                  <Chevron />
                </summary>
                <div class={PANEL}>
                  <Link to="/" class={ITEM}>
                    {m.common_mySpace()}
                  </Link>
                  <Show when={canWrite()}>
                    <Link to="/write" class={ITEM}>
                      {m.write_title()}
                    </Link>
                  </Show>
                  <Show when={canReview()}>
                    <Link to="/review" class={ITEM}>
                      {m.review_nav()}
                    </Link>
                  </Show>
                  <LogoutButton class={ITEM} />
                </div>
              </details>
            )}
          </Show>

          <details class="site-menu relative md:hidden">
            <summary class={PILL}>
              <svg
                aria-hidden="true"
                width="18"
                height="18"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
              >
                <path d="M4 6h16M4 12h16M4 18h16" />
              </svg>
              {m.common_menu()}
            </summary>
            <div class={PANEL}>
              <Link to="/articles" class={ITEM}>
                {m.articles_nav()}
              </Link>
              <Show when={canWrite()}>
                <Link to="/write" class={ITEM}>
                  {m.write_nav()}
                </Link>
              </Show>
              <Show when={canReview()}>
                <Link to="/review" class={ITEM}>
                  {m.review_nav()}
                </Link>
              </Show>
              <Show when={!props.user}>
                <Link to="/auth/login" class={ITEM}>
                  {m.articles_signIn()}
                </Link>
                <Link to="/auth/register" class={`${PRIMARY} m-1.5`}>
                  {m.auth_login_register()}
                </Link>
              </Show>
            </div>
          </details>
        </div>
      </div>
    </header>
  )
}
