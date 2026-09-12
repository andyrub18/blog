import { createEffect, createSignal, For, Show } from 'solid-js'
import type { Discussion, ForumPostView } from '../../lib/forum'
import {
  editMyPost,
  fetchDiscussion,
  moderateDiscussionPost,
  postToDiscussion,
  withdrawMyPost,
} from '../../lib/forum-actions'
import { FORUM_ERROR_MESSAGE } from '../../lib/forum-messages'
import { forumParagraphs, MIN_MODERATION_RATIONALE_CHARS } from '../../lib/validation'
import { m } from '../../paraglide/messages'
import { getLocale } from '../../paraglide/runtime'
import PostComposer from './PostComposer'

/**
 * The live thread.
 *
 * Polling, not WebSockets — the roadmap's standing rule, and at KLE's scale a
 * request every fifteen seconds is cheaper to run and far cheaper to deploy
 * than a socket layer. What it must not be is cheap for us and expensive for
 * the reader, so the loop here is written around a metered connection:
 *
 * - it asks only for what changed, by `changedAt`, never for the whole thread;
 * - it stops dead while the tab is hidden, so a forgotten tab costs nothing;
 * - it slows down while nothing is happening, and speeds back up when something
 *   does;
 * - and it gives up entirely after ten quiet minutes, leaving a button.
 *
 * Server-Sent Events over Postgres `LISTEN/NOTIFY` is the next step if this
 * proves not to be enough. It is not yet.
 */

const POLL_FASTEST_MS = 15_000
const POLL_SLOWEST_MS = 60_000
const GIVE_UP_AFTER_MS = 10 * 60_000

/** Loader data crosses the wire, so a `Date` may arrive as a string. */
type Stamped = Date | string
const at = (value: Stamped): number => new Date(value).getTime()

function newest(posts: Array<ForumPostView>): string | null {
  let latest = 0
  for (const post of posts) latest = Math.max(latest, at(post.changedAt))
  return latest > 0 ? new Date(latest).toISOString() : null
}

/**
 * Later posts win, and everything is sorted by when it was written.
 *
 * A poll returns posts that are new *and* posts that changed, so a merge by id
 * is what keeps an edited or hidden post from appearing twice.
 */
function merge(
  existing: Array<ForumPostView>,
  incoming: Array<ForumPostView>,
): Array<ForumPostView> {
  const byId = new Map(existing.map((post) => [post.id, post]))
  for (const post of incoming) byId.set(post.id, post)
  return [...byId.values()].sort((a, b) => at(a.createdAt) - at(b.createdAt))
}

export default function DiscussionThread(props: { initial: Discussion }) {
  const [posts, setPosts] = createSignal<Array<ForumPostView>>(props.initial.posts)
  const [cursor, setCursor] = createSignal<string | null>(newest(props.initial.posts))
  const [live, setLive] = createSignal(true)
  const [busy, setBusy] = createSignal<string | null>(null)
  const [error, setError] = createSignal<string | null>(null)
  const [replyTo, setReplyTo] = createSignal<string | null>(null)
  const [editing, setEditing] = createSignal<string | null>(null)

  // A post the server has not confirmed yet. It is shown immediately, because
  // on a slow connection the alternative is a page that appears to have
  // swallowed what somebody just wrote.
  const [pendingIds, setPendingIds] = createSignal<Array<string>>([])
  const isPending = (id: string) => pendingIds().includes(id)

  // Set by every poll and every action, and read by the loop to decide whether
  // anybody is still here.
  let lastActivity = Date.now()
  let resume: (() => void) | null = null

  const topLevel = () => posts().filter((post) => post.parentId === null)
  const repliesTo = (id: string) => posts().filter((post) => post.parentId === id)

  async function poll(): Promise<boolean> {
    const result = await fetchDiscussion({
      data: { slug: props.initial.slug, since: cursor() },
    })
    if (!result.ok || result.value.posts.length === 0) return false
    setPosts((current) => merge(current, result.value.posts))
    setCursor(newest(result.value.posts) ?? cursor())
    return true
  }

  /**
   * The loop itself, started once on the client.
   *
   * An effect with a constant compute rather than `onMount`, which Solid 2 does
   * not have: the types still declare it and it throws at runtime, taking the
   * whole route render with it. The apply step runs once, in the browser.
   */
  createEffect(
    () => undefined,
    () => {
      let delay = POLL_FASTEST_MS
      let timer: ReturnType<typeof setTimeout> | undefined
      let stopped = false

      const schedule = () => {
        clearTimeout(timer)
        timer = setTimeout(() => void tick(), delay)
      }

      const tick = async () => {
        if (stopped || document.visibilityState !== 'visible') return
        if (Date.now() - lastActivity > GIVE_UP_AFTER_MS) {
          setLive(false)
          return
        }
        const changed = await poll()
        // Faster when the room is talking, slower when it is not. A thread
        // nobody is posting in should not keep asking at the same rate.
        delay = changed
          ? POLL_FASTEST_MS
          : Math.min(POLL_SLOWEST_MS, Math.round(delay * 1.5))
        schedule()
      }

      const wake = () => {
        lastActivity = Date.now()
        delay = POLL_FASTEST_MS
        setLive(true)
        void tick()
      }
      resume = wake

      const onVisibility = () => {
        if (document.visibilityState === 'visible') wake()
        else clearTimeout(timer)
      }

      document.addEventListener('visibilitychange', onVisibility)
      schedule()

      return () => {
        stopped = true
        clearTimeout(timer)
        document.removeEventListener('visibilitychange', onVisibility)
      }
    },
  )

  async function submit(body: string, parentId: string | null): Promise<boolean> {
    lastActivity = Date.now()
    setBusy(parentId ?? 'root')
    setError(null)

    // Shown before the server has answered, then replaced by the row it
    // returns. The id is local and never sent anywhere.
    const temporary: ForumPostView = {
      id: `pending:${Date.now()}`,
      parentId,
      authorId: '',
      authorName: '',
      lang: getLocale(),
      status: 'visible',
      body,
      createdAt: new Date(),
      editedAt: null,
      changedAt: new Date(),
    }
    setPendingIds((ids) => [...ids, temporary.id])
    setPosts((current) => merge(current, [temporary]))

    const drop = () => {
      setPendingIds((ids) => ids.filter((id) => id !== temporary.id))
      setPosts((current) => current.filter((post) => post.id !== temporary.id))
    }

    try {
      const result = await postToDiscussion({
        data: { slug: props.initial.slug, body, parentId: parentId ?? undefined },
      })
      drop()
      if (!result.ok) {
        setError(FORUM_ERROR_MESSAGE[result.code]())
        return false
      }
      setPosts((current) => merge(current, [result.value]))
      setCursor(newest([result.value]) ?? cursor())
      setReplyTo(null)
      return true
    } catch {
      drop()
      setError(m.forum_errors_unexpected())
      return false
    } finally {
      setBusy(null)
    }
  }

  async function saveEdit(postId: string, body: string): Promise<boolean> {
    lastActivity = Date.now()
    setBusy(postId)
    setError(null)
    try {
      const result = await editMyPost({ data: { postId, body } })
      if (!result.ok) {
        setError(FORUM_ERROR_MESSAGE[result.code]())
        return false
      }
      setPosts((current) =>
        current.map((post) =>
          post.id === postId
            ? {
                ...post,
                body,
                editedAt: result.value.editedAt,
                changedAt: result.value.editedAt,
              }
            : post,
        ),
      )
      setEditing(null)
      return true
    } catch {
      setError(m.forum_errors_unexpected())
      return false
    } finally {
      setBusy(null)
    }
  }

  async function withdraw(postId: string) {
    lastActivity = Date.now()
    setBusy(postId)
    setError(null)
    try {
      const result = await withdrawMyPost({ data: { postId } })
      if (!result.ok) {
        setError(FORUM_ERROR_MESSAGE[result.code]())
        return
      }
      setPosts((current) =>
        current.map((post) =>
          post.id === postId ? { ...post, status: 'withdrawn', body: null } : post,
        ),
      )
    } finally {
      setBusy(null)
    }
  }

  async function moderate(postId: string, hidden: boolean, rationale: string) {
    lastActivity = Date.now()
    setBusy(postId)
    setError(null)
    try {
      const result = await moderateDiscussionPost({ data: { postId, hidden, rationale } })
      if (!result.ok) {
        setError(FORUM_ERROR_MESSAGE[result.code]())
        return false
      }
      setPosts((current) =>
        current.map((post) =>
          post.id === postId ? { ...post, status: hidden ? 'hidden' : 'visible' } : post,
        ),
      )
      return true
    } catch {
      setError(m.forum_errors_unexpected())
      return false
    } finally {
      setBusy(null)
    }
  }

  return (
    <div>
      <div class="mb-4 flex items-center justify-between gap-3 text-xs text-neutral-500">
        <span>
          {posts().length > 0
            ? m.forum_responses({ count: posts().length })
            : m.forum_noResponses()}
        </span>
        <Show
          when={live()}
          fallback={
            <button
              type="button"
              onClick={() => resume?.()}
              class="rounded border border-neutral-300 px-2 py-1 hover:bg-neutral-100"
            >
              {m.forum_paused()} {m.forum_refresh()}
            </button>
          }
        >
          <span>{m.forum_live()}</span>
        </Show>
      </div>

      <Show
        when={posts().length > 0}
        fallback={
          <p class="rounded-lg border border-neutral-200 bg-white p-6 text-sm text-neutral-600">
            {m.forum_empty()}
          </p>
        }
      >
        <ol class="flex flex-col gap-4">
          <For each={topLevel()}>
            {(post) => (
              <li>
                <PostCard
                  post={post}
                  viewerId={props.initial.viewerId}
                  pending={isPending(post.id)}
                  canPost={props.initial.canPost}
                  canModerate={props.initial.canModerate}
                  busy={busy() === post.id}
                  replying={replyTo() === post.id}
                  editing={editing() === post.id}
                  onReply={() => setReplyTo(replyTo() === post.id ? null : post.id)}
                  onEdit={() => setEditing(editing() === post.id ? null : post.id)}
                  onWithdraw={() => void withdraw(post.id)}
                  onSaveEdit={(body) => saveEdit(post.id, body)}
                  onModerate={(hidden, rationale) => moderate(post.id, hidden, rationale)}
                  onSubmitReply={(body) => submit(body, post.id)}
                  replies={repliesTo(post.id)}
                  pendingIds={pendingIds()}
                  busyId={busy()}
                  editingId={editing()}
                  onEditReply={(id) => setEditing(editing() === id ? null : id)}
                  onWithdrawReply={(id) => void withdraw(id)}
                  onSaveEditReply={(id, body) => saveEdit(id, body)}
                  onModerateReply={(id, hidden, rationale) =>
                    moderate(id, hidden, rationale)
                  }
                />
              </li>
            )}
          </For>
        </ol>
      </Show>

      <div class="mt-8">
        <Show
          when={props.initial.canPost}
          fallback={
            <p class="rounded-lg border border-neutral-200 bg-neutral-50 p-4 text-sm text-neutral-700">
              {m.forum_signInToPost()}
            </p>
          }
        >
          <PostComposer
            label={m.forum_composerLabel()}
            hint={m.forum_composerHint()}
            submitLabel={m.forum_send()}
            busyLabel={m.forum_sending()}
            busy={busy() === 'root'}
            error={error()}
            onSubmit={(body) => submit(body, null)}
          />
        </Show>
      </div>
    </div>
  )
}

/**
 * One post and its replies.
 *
 * A component rather than a block-bodied callback inside `<For>`: written that
 * way, the server and the client render different trees and every row loses its
 * event handlers — painted, visible, and completely inert.
 */
function PostCard(props: {
  post: ForumPostView
  replies: Array<ForumPostView>
  viewerId: string | null
  pending: boolean
  pendingIds: Array<string>
  canPost: boolean
  canModerate: boolean
  busy: boolean
  busyId: string | null
  replying: boolean
  editing: boolean
  editingId: string | null
  onReply: () => void
  onEdit: () => void
  onWithdraw: () => void
  onSaveEdit: (body: string) => Promise<boolean>
  onModerate: (hidden: boolean, rationale: string) => Promise<boolean>
  onSubmitReply: (body: string) => Promise<boolean>
  onEditReply: (id: string) => void
  onWithdrawReply: (id: string) => void
  onSaveEditReply: (id: string, body: string) => Promise<boolean>
  onModerateReply: (id: string, hidden: boolean, rationale: string) => Promise<boolean>
}) {
  return (
    <article
      class={
        props.pending
          ? 'rounded-lg border border-neutral-200 bg-white p-5 opacity-60'
          : 'rounded-lg border border-neutral-200 bg-white p-5'
      }
    >
      <PostBody
        post={props.post}
        mine={props.post.authorId === props.viewerId}
        canModerate={props.canModerate}
        busy={props.busy}
        editing={props.editing}
        onEdit={props.onEdit}
        onWithdraw={props.onWithdraw}
        onSaveEdit={props.onSaveEdit}
        onModerate={props.onModerate}
      />

      <Show when={props.canPost}>
        <button
          type="button"
          onClick={props.onReply}
          class="mt-3 text-xs font-medium text-[#00209F] hover:underline"
        >
          {m.forum_reply()}
        </button>
      </Show>

      <Show when={props.replies.length > 0 || props.replying}>
        <ol class="mt-4 flex flex-col gap-3 border-l-2 border-neutral-200 pl-4">
          <For each={props.replies}>
            {(reply) => (
              <li>
                <ReplyCard
                  post={reply}
                  viewerId={props.viewerId}
                  pending={props.pendingIds.includes(reply.id)}
                  canModerate={props.canModerate}
                  busy={props.busyId === reply.id}
                  editing={props.editingId === reply.id}
                  onEdit={() => props.onEditReply(reply.id)}
                  onWithdraw={() => props.onWithdrawReply(reply.id)}
                  onSaveEdit={(body) => props.onSaveEditReply(reply.id, body)}
                  onModerate={(hidden, rationale) =>
                    props.onModerateReply(reply.id, hidden, rationale)
                  }
                />
              </li>
            )}
          </For>

          <Show when={props.replying}>
            <li>
              <PostComposer
                label={m.forum_replyingTo({ name: props.post.authorName })}
                submitLabel={m.forum_send()}
                busyLabel={m.forum_sending()}
                busy={props.busy}
                autofocus
                onSubmit={props.onSubmitReply}
                onCancel={props.onReply}
              />
            </li>
          </Show>
        </ol>
      </Show>
    </article>
  )
}

function ReplyCard(props: {
  post: ForumPostView
  viewerId: string | null
  pending: boolean
  canModerate: boolean
  busy: boolean
  editing: boolean
  onEdit: () => void
  onWithdraw: () => void
  onSaveEdit: (body: string) => Promise<boolean>
  onModerate: (hidden: boolean, rationale: string) => Promise<boolean>
}) {
  return (
    <div class={props.pending ? 'opacity-60' : undefined}>
      <PostBody
        post={props.post}
        mine={props.post.authorId === props.viewerId}
        canModerate={props.canModerate}
        busy={props.busy}
        editing={props.editing}
        onEdit={props.onEdit}
        onWithdraw={props.onWithdraw}
        onSaveEdit={props.onSaveEdit}
        onModerate={props.onModerate}
      />
    </div>
  )
}

/**
 * The text of a post, or the note that stands in its place.
 *
 * Rendered as text nodes — `<For>` over paragraphs, never `innerHTML`. The
 * reading view's `innerHTML` is safe because the server's renderer wrote every
 * tag of that string; a forum post was written by whoever registered five
 * minutes ago, and gets no such treatment.
 */
function PostBody(props: {
  post: ForumPostView
  mine: boolean
  canModerate: boolean
  busy: boolean
  editing: boolean
  onEdit: () => void
  onWithdraw: () => void
  onSaveEdit: (body: string) => Promise<boolean>
  onModerate: (hidden: boolean, rationale: string) => Promise<boolean>
}) {
  const [moderating, setModerating] = createSignal(false)
  const [rationale, setRationale] = createSignal('')
  let rationaleField!: HTMLTextAreaElement

  const gone = () => props.post.status !== 'visible'

  async function confirmModeration() {
    const done = await props.onModerate(props.post.status !== 'hidden', rationale())
    if (done) {
      setModerating(false)
      setRationale('')
      rationaleField.value = ''
    }
  }

  return (
    <div>
      <p class="text-sm font-medium text-neutral-900">
        {props.post.authorName}
        <span class="ml-2 text-xs font-normal text-neutral-500">
          {new Date(props.post.createdAt).toLocaleString()}
          <Show when={props.post.editedAt}> · {m.forum_edited()}</Show>
        </span>
      </p>

      <Show
        when={!gone()}
        fallback={
          <p class="mt-2 text-sm text-neutral-500 italic">
            {props.post.status === 'withdrawn'
              ? m.forum_withdrawnNotice()
              : m.forum_hiddenNotice()}
          </p>
        }
      >
        <Show
          when={!props.editing}
          fallback={
            <div class="mt-2">
              <PostComposer
                label={m.forum_edit()}
                submitLabel={m.forum_save()}
                busyLabel={m.forum_sending()}
                initialValue={props.post.body ?? ''}
                busy={props.busy}
                onSubmit={props.onSaveEdit}
                onCancel={props.onEdit}
              />
            </div>
          }
        >
          <div class="mt-2 flex flex-col gap-2 text-sm leading-relaxed text-neutral-800">
            <For each={forumParagraphs(props.post.body ?? '')}>
              {(paragraph) => <p class="whitespace-pre-line">{paragraph}</p>}
            </For>
          </div>
        </Show>
      </Show>

      {/*
       * A moderator sees the text of a hidden post. Restoring something you
       * cannot read is a decision taken blind.
       */}
      <Show when={gone() && props.canModerate && props.post.body}>
        {(body) => (
          <p class="mt-2 rounded border border-neutral-200 bg-neutral-50 p-2 text-xs whitespace-pre-line text-neutral-600">
            {body()}
          </p>
        )}
      </Show>

      <div class="mt-2 flex flex-wrap items-center gap-3 text-xs">
        <Show when={props.mine && !gone() && !props.editing}>
          <button
            type="button"
            onClick={props.onEdit}
            class="text-neutral-600 hover:underline"
          >
            {m.forum_edit()}
          </button>
          <button
            type="button"
            onClick={props.onWithdraw}
            disabled={props.busy}
            class="text-neutral-600 hover:underline disabled:opacity-60"
          >
            {m.forum_withdraw()}
          </button>
        </Show>

        <Show when={props.canModerate && props.post.status !== 'withdrawn'}>
          <button
            type="button"
            onClick={() => setModerating(!moderating())}
            class="text-amber-800 hover:underline"
          >
            {props.post.status === 'hidden' ? m.forum_restore() : m.forum_hide()}
          </button>
        </Show>
      </div>

      <Show when={moderating()}>
        <div class="mt-2 rounded-md border border-amber-200 bg-amber-50 p-3">
          <label class="flex flex-col gap-1 text-xs">
            <span class="font-medium text-amber-900">{m.forum_rationaleLabel()}</span>
            <span class="text-amber-800">
              {m.forum_rationaleHint({ min: MIN_MODERATION_RATIONALE_CHARS })}
            </span>
            {/* Uncontrolled, and cleared through the ref — see CLAUDE.md. */}
            <textarea
              ref={rationaleField}
              rows="2"
              onInput={(e) => setRationale(e.currentTarget.value)}
              class="rounded-md border border-amber-300 px-2 py-1 outline-none focus:border-amber-500"
            />
          </label>
          <button
            type="button"
            disabled={
              props.busy || rationale().trim().length < MIN_MODERATION_RATIONALE_CHARS
            }
            onClick={() => void confirmModeration()}
            class="mt-2 h-8 rounded-md bg-amber-800 px-3 text-xs font-semibold text-white disabled:opacity-60"
          >
            {props.post.status === 'hidden' ? m.forum_restore() : m.forum_hide()}
          </button>
        </div>
      </Show>
    </div>
  )
}
