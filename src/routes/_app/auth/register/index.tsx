import { createFileRoute, Link } from '@tanstack/solid-router'
import { For } from 'solid-js'
import { m } from '../../../../paraglide/messages'

export const Route = createFileRoute('/_app/auth/register/')({
  component: RegisterChooser,
})

/**
 * Two kinds of account, and what each one asks before anybody starts filling
 * in a form. The member application wants three PDFs and a review by senior
 * members; finding that out halfway through is how people give up.
 */
function RegisterChooser() {
  return (
    <main class="flex flex-1 justify-center bg-surface px-4 py-12">
      <div class="w-full max-w-4xl">
        <div class="mb-8 flex flex-col items-center gap-3 text-center">
          <h1 class="font-serif text-4xl font-bold">{m.auth_register_chooserTitle()}</h1>
          <p class="max-w-md text-lg text-ink-soft">
            {m.auth_register_chooserSubtitle()}
          </p>
          <p class="text-[15px] text-muted">
            {m.common_readingIsFree()}{' '}
            <Link to="/articles" class="font-semibold text-accent hover:underline">
              {m.common_browseArticles()}
            </Link>
          </p>
        </div>
        <div class="grid gap-6 md:grid-cols-2">
          <Card
            title={m.auth_register_readerTitle()}
            description={m.auth_register_readerDescription()}
            asks={[
              m.auth_register_askIdentity(),
              m.auth_register_askEssay(),
              m.auth_register_askCaptcha(),
            ]}
            cta={m.auth_register_readerCta()}
            to="/auth/register/reader"
          />
          <Card
            title={m.auth_register_memberTitle()}
            description={m.auth_register_memberDescription()}
            asks={[
              m.auth_register_askIdentity(),
              m.auth_register_askEssay(),
              m.auth_register_askPdfs(),
              m.auth_register_askReview(),
            ]}
            cta={m.auth_register_memberCta()}
            to="/auth/register/member"
            emphasis
          />
        </div>
        <p class="mt-8 text-center text-[15px] text-ink-soft">
          {m.auth_register_common_haveAccount()}{' '}
          <Link to="/auth/login" class="font-semibold text-accent hover:underline">
            {m.articles_signIn()}
          </Link>
        </p>
      </div>
    </main>
  )
}

function Card(props: {
  title: string
  description: string
  asks: Array<string>
  cta: string
  to: '/auth/register/reader' | '/auth/register/member'
  emphasis?: boolean
}) {
  return (
    <section
      class={`flex flex-col gap-4 rounded-2xl bg-raised p-7 ${props.emphasis ? 'border-2 border-accent' : 'border border-line'}`}
    >
      <h2 class="font-serif text-[1.75rem] font-bold">{props.title}</h2>
      <p class="leading-relaxed text-ink-soft">{props.description}</p>
      <div class="flex flex-1 flex-col gap-2.5 border-t border-line pt-4">
        <h3 class="text-xs font-bold tracking-[0.08em] text-muted uppercase">
          {m.auth_register_asksTitle()}
        </h3>
        <ul class="flex flex-col gap-2.5 text-[15px] leading-normal">
          <For each={props.asks}>
            {(ask) => (
              <li class="flex gap-2.5">
                <span aria-hidden="true" class="text-accent">
                  •
                </span>
                {ask}
              </li>
            )}
          </For>
        </ul>
      </div>
      <Link
        to={props.to}
        class={`inline-flex min-h-12 items-center justify-center self-start rounded-lg px-5 font-semibold ${props.emphasis ? 'bg-accent text-on-accent hover:bg-accent-hover' : 'border border-accent-line text-accent hover:bg-accent-soft'}`}
      >
        {props.cta}
      </Link>
    </section>
  )
}
