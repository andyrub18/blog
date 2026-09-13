import { createSignal, Show } from 'solid-js'
import {
  MAX_FORUM_POST_CHARS,
  MIN_FORUM_POST_CHARS,
  normalizeForumPost,
} from '../../lib/validation'
import { m } from '../../paraglide/messages'

/**
 * The box people type into — once for a new post, once per reply, once per edit.
 *
 * The length rule comes from `validation.ts`, the same module the server checks
 * against. This copy is a courtesy to the person typing; `createPost` is the
 * one that decides.
 */
export default function PostComposer(props: {
  label: string
  hint?: string
  submitLabel: string
  busyLabel: string
  initialValue?: string
  busy: boolean
  error?: string | null
  autofocus?: boolean
  /** Resolves true when the post landed, which is when the box is cleared. */
  onSubmit: (body: string) => Promise<boolean>
  onCancel?: () => void
}) {
  const [body, setBody] = createSignal(props.initialValue ?? '')
  // Held as a ref because the textarea is uncontrolled: a successful post has
  // to empty the box, and with no `value` binding there is nothing else that
  // would. See CLAUDE.md — binding `value` on a textarea breaks hydration.
  let field!: HTMLTextAreaElement

  const length = () => normalizeForumPost(body()).length
  const tooLong = () => length() > MAX_FORUM_POST_CHARS
  const ready = () => length() >= MIN_FORUM_POST_CHARS && !tooLong()

  async function submit(event: SubmitEvent) {
    event.preventDefault()
    if (!ready() || props.busy) return
    const sent = await props.onSubmit(body())
    if (sent) {
      setBody('')
      field.value = ''
    }
  }

  return (
    <form onSubmit={(e) => void submit(e)} class="flex flex-col gap-2">
      <label class="flex flex-col gap-1 text-sm">
        <span class="font-medium text-neutral-800">{props.label}</span>
        <Show when={props.hint}>
          <span class="text-xs text-neutral-500">{props.hint}</span>
        </Show>
        {/*
         * No `value` binding, deliberately: Solid's SSR writes a textarea's
         * value as a child text node while the client template has none, and
         * the two sides end up one node apart — everything after it in the tree
         * is rendered, visible and completely inert.
         */}
        <textarea
          ref={field}
          rows="4"
          name="body"
          autofocus={props.autofocus}
          maxlength={MAX_FORUM_POST_CHARS + 200}
          onInput={(e) => setBody(e.currentTarget.value)}
          class="rounded-md border border-neutral-300 px-3 py-2 outline-none focus:border-[#00209F] focus:ring-2 focus:ring-[#00209F]/20"
        >
          {props.initialValue ?? ''}
        </textarea>
      </label>

      <div class="flex flex-wrap items-center gap-3">
        <button
          type="submit"
          disabled={props.busy || !ready()}
          class="h-10 rounded-md bg-[#00209F] px-4 text-sm font-semibold text-white hover:opacity-95 disabled:opacity-60"
        >
          {props.busy ? props.busyLabel : props.submitLabel}
        </button>
        <Show when={props.onCancel}>
          <button
            type="button"
            onClick={() => props.onCancel?.()}
            class="h-10 rounded-md px-3 text-sm text-neutral-700 hover:bg-neutral-100"
          >
            {m.forum_cancel()}
          </button>
        </Show>
        <span
          class={
            tooLong() ? 'text-xs font-medium text-red-700' : 'text-xs text-neutral-500'
          }
        >
          {m.forum_composerCount({ used: length(), max: MAX_FORUM_POST_CHARS })}
        </span>
      </div>

      <div aria-live="polite" class="min-h-5 text-sm">
        <Show when={props.error}>
          {(message) => <p class="text-red-700">{message()}</p>}
        </Show>
      </div>
    </form>
  )
}
