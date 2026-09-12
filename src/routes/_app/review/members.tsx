import { createFileRoute, Link } from '@tanstack/solid-router'
import { createSignal, For, Show } from 'solid-js'
import LanguageSwitcher from '../../../components/LanguageSwitcher'
import {
  fetchRoster,
  openNomination,
  setBlockedStatus,
} from '../../../lib/governance-actions'
import { GOVERNANCE_ERROR_MESSAGE } from '../../../lib/governance-messages'
import { m } from '../../../paraglide/messages'

export const Route = createFileRoute('/_app/review/members')({
  // The loader's server function re-checks the role itself, which is the check
  // that actually matters.
  loader: () => fetchRoster(),
  component: Roster,
})

type Notice = { kind: 'blocked' | 'unblocked' | 'nominated' }

function Roster() {
  const roster = Route.useLoaderData()
  const [rationales, setRationales] = createSignal<Record<string, string>>({})
  const [busy, setBusy] = createSignal<string | null>(null)
  const [errors, setErrors] = createSignal<Record<string, string>>({})
  const [notices, setNotices] = createSignal<Record<string, Notice>>({})

  const rationaleFor = (id: string) => rationales()[id] ?? ''

  async function run(
    id: string,
    call: () => Promise<
      { ok: true } | { ok: false; code: keyof typeof GOVERNANCE_ERROR_MESSAGE }
    >,
    notice: Notice,
  ) {
    setBusy(id)
    setErrors((prev) => ({ ...prev, [id]: '' }))
    try {
      const result = await call()
      if (!result.ok) {
        setErrors((prev) => ({ ...prev, [id]: GOVERNANCE_ERROR_MESSAGE[result.code]() }))
        return
      }
      setNotices((prev) => ({ ...prev, [id]: notice }))
    } catch {
      setErrors((prev) => ({ ...prev, [id]: m.review_errors_unexpected() }))
    } finally {
      setBusy(null)
    }
  }

  return (
    <main class="min-h-screen bg-neutral-50 px-4 py-12">
      <div class="mx-auto w-full max-w-3xl">
        <div class="mb-4 flex items-center justify-between gap-4">
          <h1 class="text-2xl font-bold text-neutral-900">{m.roster_title()}</h1>
          <LanguageSwitcher />
        </div>
        <p class="mb-2 text-sm text-neutral-600">{m.roster_subtitle()}</p>
        <div class="mb-6 flex flex-wrap gap-4 text-sm">
          <Link to="/review" class="text-[#00209F] hover:underline">
            {m.review_title()} →
          </Link>
          <Link to="/review/promotions" class="text-[#00209F] hover:underline">
            {m.promotions_title()} →
          </Link>
          <Link to="/review/invitations" class="text-[#00209F] hover:underline">
            {m.invitations_title()} →
          </Link>
        </div>

        <Show
          when={roster().length > 0}
          fallback={
            <p class="rounded-lg border border-neutral-200 bg-white p-6 text-sm text-neutral-600">
              {m.roster_empty()}
            </p>
          }
        >
          <ul class="flex flex-col gap-3">
            <For each={roster()}>
              {(person) => (
                <RosterRow
                  person={person}
                  rationale={rationaleFor(person.id)}
                  busy={busy() === person.id}
                  error={errors()[person.id]}
                  notice={notices()[person.id]}
                  onRationale={(value) =>
                    setRationales((prev) => ({ ...prev, [person.id]: value }))
                  }
                  onBlockToggle={() =>
                    void run(
                      person.id,
                      () =>
                        setBlockedStatus({
                          data: {
                            userId: person.id,
                            blocked: person.memberStatus !== 'blocked',
                            rationale: rationaleFor(person.id),
                          },
                        }),
                      {
                        kind: person.memberStatus === 'blocked' ? 'unblocked' : 'blocked',
                      },
                    )
                  }
                  onNominate={() =>
                    void run(
                      person.id,
                      () =>
                        openNomination({
                          data: { userId: person.id, rationale: rationaleFor(person.id) },
                        }),
                      { kind: 'nominated' },
                    )
                  }
                />
              )}
            </For>
          </ul>
        </Show>
      </div>
    </main>
  )
}

/**
 * One account on the roster.
 *
 * A component rather than a block-bodied callback inside `<For>`: written that
 * way, the server and the client rendered different trees and Solid reported a
 * hydration key miss for every row — the buttons were painted but never wired
 * up, so clicking them did nothing at all.
 */
function RosterRow(props: {
  person: {
    id: string
    name: string
    email: string
    role: string
    memberStatus: string
    probationConfirmedAt: Date | null
  }
  rationale: string
  busy: boolean
  error?: string
  notice?: Notice
  onRationale: (value: string) => void
  onBlockToggle: () => void
  onNominate: () => void
}) {
  const blocked = () => props.person.memberStatus === 'blocked'
  const confirmedMember = () =>
    props.person.role === 'member' && Boolean(props.person.probationConfirmedAt)

  return (
    <li class="rounded-lg border border-neutral-200 bg-white p-5">
      <p class="font-medium text-neutral-900">{props.person.name}</p>
      <p class="text-sm text-neutral-600">{props.person.email}</p>
      <p class="mt-1 text-xs text-neutral-500">
        {m.roster_role()}: {props.person.role} · {m.roster_status()}:{' '}
        {blocked() ? m.roster_statusBlocked() : m.roster_statusActive()}
        <Show when={props.person.role === 'member' && !props.person.probationConfirmedAt}>
          {' '}
          · {m.roster_statusProbation()}
        </Show>
      </p>

      <Show
        when={!props.notice}
        fallback={
          <p class="mt-3 rounded-md border border-green-200 bg-green-50 p-3 text-sm text-green-900">
            <Show when={props.notice?.kind === 'blocked'}>{m.roster_blocked()}</Show>
            <Show when={props.notice?.kind === 'unblocked'}>{m.roster_unblocked()}</Show>
            <Show when={props.notice?.kind === 'nominated'}>{m.roster_nominated()}</Show>
          </p>
        }
      >
        <label class="mt-3 flex flex-col gap-1 text-sm">
          <span class="font-medium text-neutral-800">{m.roster_rationaleLabel()}</span>
          <span class="text-xs text-neutral-500">{m.roster_rationaleHint()}</span>
          {/*
           * No `value` binding, deliberately. Solid's SSR writes a textarea's value
           * as a child text node while the client template has none, so the two sides
           * end up one node apart and hydration detaches everything after it in the
           * tree — rendered, visible and completely inert. The field is uncontrolled
           * and read through `onInput`. See CLAUDE.md.
           */}
          <textarea
            rows="2"
            name={`rationale-${props.person.id}`}
            onInput={(e) => props.onRationale(e.currentTarget.value)}
            class="rounded-md border border-neutral-300 px-3 py-2 outline-none focus:border-[#00209F] focus:ring-2 focus:ring-[#00209F]/20"
          />
        </label>

        <div class="mt-3 flex flex-wrap gap-2">
          <button
            type="button"
            disabled={props.busy}
            onClick={() => props.onBlockToggle()}
            class={`h-10 rounded-md px-4 text-sm font-semibold text-white hover:opacity-95 disabled:opacity-60 ${
              blocked() ? 'bg-[#1F6B45]' : 'bg-[#A3261F]'
            }`}
          >
            {props.busy
              ? m.roster_working()
              : blocked()
                ? m.roster_unblock()
                : m.roster_block()}
          </button>

          {/* Only a confirmed member can be nominated: someone still inside
              their probation has not been measured against what they promised. */}
          <Show when={confirmedMember()}>
            <button
              type="button"
              disabled={props.busy}
              onClick={() => props.onNominate()}
              class="h-10 rounded-md border border-neutral-300 px-4 text-sm font-semibold text-neutral-800 hover:bg-neutral-50 disabled:opacity-60"
            >
              {m.roster_nominate()}
            </button>
          </Show>
        </div>

        <div aria-live="polite" class="mt-3 min-h-5 text-sm">
          <Show when={props.error}>
            {(message) => <p class="text-[#A3261F]">{message()}</p>}
          </Show>
        </div>
      </Show>
    </li>
  )
}
