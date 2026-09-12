import { createFileRoute, Link } from '@tanstack/solid-router'
import { createSignal, For, Show } from 'solid-js'
import LanguageSwitcher from '../../../components/LanguageSwitcher'
import {
  fetchInvitations,
  issueInvitationAction,
  revokeInvitationAction,
} from '../../../lib/governance-actions'
import { GOVERNANCE_ERROR_MESSAGE } from '../../../lib/governance-messages'
import { m } from '../../../paraglide/messages'

export const Route = createFileRoute('/_app/review/invitations')({
  loader: () => fetchInvitations(),
  component: Invitations,
})

function Invitations() {
  const invitations = Route.useLoaderData()
  const [email, setEmail] = createSignal('')
  const [note, setNote] = createSignal('')
  // Held as a ref because the textarea below is uncontrolled: issuing an
  // invitation has to clear the box, and with no `value` binding there is
  // nothing else that would.
  let noteField!: HTMLTextAreaElement
  const [busy, setBusy] = createSignal(false)
  const [error, setError] = createSignal<string | null>(null)
  const [issued, setIssued] = createSignal<{ url: string; email: string } | null>(null)
  const [revoked, setRevoked] = createSignal<Record<string, boolean>>({})

  async function issue(e: SubmitEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      const result = await issueInvitationAction({
        data: { email: email(), note: note() },
      })
      if (!result.ok) {
        setError(GOVERNANCE_ERROR_MESSAGE[result.code]())
        return
      }
      setIssued({ url: result.url, email: result.email })
      setEmail('')
      setNote('')
      noteField.value = ''
    } catch {
      setError(m.review_errors_unexpected())
    } finally {
      setBusy(false)
    }
  }

  async function revoke(invitationId: string) {
    const result = await revokeInvitationAction({ data: { invitationId } })
    if (!result.ok) {
      setError(GOVERNANCE_ERROR_MESSAGE[result.code]())
      return
    }
    setRevoked((prev) => ({ ...prev, [invitationId]: true }))
  }

  function stateOf(row: {
    usedAt: Date | null
    revokedAt: Date | null
    expiresAt: Date
    id: string
  }): string {
    if (row.usedAt) return m.invitations_stateUsed()
    if (row.revokedAt || revoked()[row.id]) return m.invitations_stateRevoked()
    if (new Date(row.expiresAt) <= new Date()) return m.invitations_stateExpired()
    return m.invitations_statePending()
  }

  return (
    <main class="min-h-screen bg-neutral-50 px-4 py-12">
      <div class="mx-auto w-full max-w-3xl">
        <div class="mb-4 flex items-center justify-between gap-4">
          <h1 class="text-2xl font-bold text-neutral-900">{m.invitations_title()}</h1>
          <LanguageSwitcher />
        </div>
        <p class="mb-2 text-sm text-neutral-600">{m.invitations_subtitle()}</p>
        <Link
          to="/review/members"
          class="mb-6 inline-block text-sm text-[#00209F] hover:underline"
        >
          {m.roster_title()} →
        </Link>

        <form
          onSubmit={(e) => void issue(e)}
          class="mb-6 flex flex-col gap-3 rounded-lg border border-neutral-200 bg-white p-6"
        >
          <label class="flex flex-col gap-1 text-sm">
            <span class="font-medium text-neutral-800">{m.invitations_emailLabel()}</span>
            <input
              type="email"
              name="email"
              value={email()}
              onInput={(e) => setEmail(e.currentTarget.value)}
              class="h-11 rounded-md border border-neutral-300 px-3 outline-none focus:border-[#00209F] focus:ring-2 focus:ring-[#00209F]/20"
            />
          </label>
          <label class="flex flex-col gap-1 text-sm">
            <span class="font-medium text-neutral-800">{m.invitations_noteLabel()}</span>
            <span class="text-xs text-neutral-500">{m.invitations_noteHint()}</span>
            {/*
             * No `value` binding, deliberately. Solid's SSR writes a textarea's
             * value as a child text node while the client template has none, so
             * the two sides end up one node apart and hydration detaches
             * everything after it in the tree — rendered, visible and
             * completely inert. See CLAUDE.md.
             */}
            <textarea
              ref={noteField}
              rows="3"
              name="note"
              onInput={(e) => setNote(e.currentTarget.value)}
              class="rounded-md border border-neutral-300 px-3 py-2 outline-none focus:border-[#00209F] focus:ring-2 focus:ring-[#00209F]/20"
            />
          </label>
          <div>
            <button
              type="submit"
              disabled={busy()}
              class="h-10 rounded-md bg-[#00209F] px-4 text-sm font-semibold text-white hover:opacity-95 disabled:opacity-60"
            >
              {busy() ? m.invitations_issuing() : m.invitations_issue()}
            </button>
          </div>
          <div aria-live="polite" class="min-h-5 text-sm">
            <Show when={error()}>
              {(message) => <p class="text-[#A3261F]">{message()}</p>}
            </Show>
          </div>
        </form>

        {/* Shown once and stored nowhere. The sponsor may need to pass the link
            on by hand: delivery to a Haitian inbox is not a given, and an
            invitation nobody receives is one that quietly never happened. */}
        <Show when={issued()}>
          {(result) => (
            <div class="mb-6 rounded-lg border border-green-200 bg-green-50 p-5">
              <p class="text-sm font-semibold text-green-900">
                {m.invitations_issued()} — {result().email}
              </p>
              <p class="mt-2 text-xs text-green-900">{m.invitations_linkWarning()}</p>
              <p class="mt-2 text-xs font-medium text-green-900">
                {m.invitations_linkLabel()}
              </p>
              <code class="mt-1 block break-all rounded bg-white p-2 text-xs text-neutral-800">
                {result().url}
              </code>
            </div>
          )}
        </Show>

        <Show
          when={invitations().length > 0}
          fallback={
            <p class="rounded-lg border border-neutral-200 bg-white p-6 text-sm text-neutral-600">
              {m.invitations_empty()}
            </p>
          }
        >
          <ul class="flex flex-col gap-2">
            <For each={invitations()}>
              {(row) => (
                <li class="flex items-center justify-between gap-4 rounded-lg border border-neutral-200 bg-white p-4">
                  <div class="min-w-0">
                    <p class="truncate text-sm font-medium text-neutral-900">
                      {row.email}
                    </p>
                    <p class="truncate text-xs text-neutral-500">
                      {stateOf(row)} · {m.invitations_expiresOn()}{' '}
                      {new Date(row.expiresAt).toLocaleDateString()}
                      <Show when={row.inviterName}> · {row.inviterName}</Show>
                    </p>
                  </div>
                  <Show when={!row.usedAt && !row.revokedAt && !revoked()[row.id]}>
                    <button
                      type="button"
                      onClick={() => void revoke(row.id)}
                      class="h-9 shrink-0 rounded-md border border-neutral-300 px-3 text-sm font-semibold text-neutral-800 hover:bg-neutral-50"
                    >
                      {m.invitations_revoke()}
                    </button>
                  </Show>
                </li>
              )}
            </For>
          </ul>
        </Show>
      </div>
    </main>
  )
}
