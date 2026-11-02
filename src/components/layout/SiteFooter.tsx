import { Link } from '@tanstack/solid-router'
import { Show } from 'solid-js'
import type { SessionUser } from '../../lib/auth/session'
import { m } from '../../paraglide/messages'

const LINK = 'block py-2.5 text-[15px] text-neutral-700 hover:text-accent hover:underline'

/**
 * The foot of every page: who this is, and the two doors a newcomer looks for.
 *
 * Deliberately short. It ships with every page, so each message in it is paid
 * for by the reader of every article; everything here is already in the header
 * except the sentence that reading needs no account.
 */
export default function SiteFooter(props: { user: SessionUser | null }) {
  return (
    <footer class="border-t border-line bg-surface">
      <div class="mx-auto flex max-w-6xl flex-col gap-6 px-4 pt-10 pb-6 md:flex-row md:justify-between md:px-6">
        <div class="flex max-w-md flex-col gap-3">
          <div class="flex items-center gap-2.5">
            <img
              src="/emblem-mark.png"
              alt=""
              width="30"
              height="44"
              class="h-11 w-[30px]"
            />
            <span class="font-serif text-[22px] font-bold tracking-[0.06em]">
              {m.common_appName()}
            </span>
          </div>
          <p class="text-sm leading-relaxed text-ink-soft">
            {m.common_appFullName()}. {m.articles_subtitle()}
          </p>
        </div>
        <div class="flex flex-col">
          <Link to="/articles" class={LINK}>
            {m.articles_nav()}
          </Link>
          <Show when={!props.user}>
            <Link to="/auth/register" class={LINK}>
              {m.auth_login_register()}
            </Link>
            <Link to="/auth/login" class={LINK}>
              {m.articles_signIn()}
            </Link>
          </Show>
        </div>
      </div>
      <p class="mx-auto max-w-6xl border-t border-line px-4 pt-4 pb-8 text-[13px] text-muted md:px-6">
        {m.common_readingIsFree()}
      </p>
    </footer>
  )
}
