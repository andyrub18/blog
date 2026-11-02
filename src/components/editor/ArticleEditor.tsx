import type { JSX } from '@solidjs/web'
import type { Editor } from '@tiptap/core'
import { createEffect, createSignal, For, onCleanup, Show, untrack } from 'solid-js'
import { type DocNode, isSafeHref } from '../../lib/articles/prosemirror'
import {
  ICON_BOLD,
  ICON_CODE,
  ICON_HEADING_2,
  ICON_HEADING_3,
  ICON_ITALIC,
  ICON_LINK,
  ICON_LIST,
  ICON_LIST_ORDERED,
  ICON_QUOTE,
  ICON_REDO,
  ICON_RULE,
  ICON_STRIKE,
  ICON_TABLE,
  ICON_UNDO,
} from '../../lib/shared/icons-workspace'
import { m } from '../../paraglide/messages'
import Icon from '../Icon'

/**
 * The writing surface. TipTap, which is ProseMirror with an API (D9).
 *
 * **TipTap is imported dynamically, inside the effect, and nowhere else.** It is
 * 115 KB gzipped — by a wide margin the heaviest thing in the project — and a
 * reader on metered Haitian mobile data must never download it. The dynamic
 * import is what puts it in its own chunk; only the type is imported statically,
 * and a type import compiles away.
 *
 * It was previously the whole component that was split, with `lazy()` on the
 * route. That was wrong in a way worth recording: the server rendered the
 * toolbar, the client asset manifest had no entry for the module, and hydration
 * gave up — leaving a toolbar that looked fine and an editor that never
 * appeared. Loading the library rather than the component keeps the split and
 * puts the component on both sides of the render where Solid expects it.
 *
 * There is no first-party Solid binding, so the vanilla `Editor` is constructed
 * once on the client and destroyed on cleanup. Solid 2 has no `onMount`; an
 * effect with a constant compute runs its apply step once, after the tree is
 * live — the same shape `_app.tsx` uses.
 */

/** The handle the editor hands back once it is live. */
export type EditorHandle = {
  /**
   * Replace everything in the editor.
   *
   * The only way in, on purpose. The editor does not follow `content` after it
   * is built — see `untrack` below — because the route re-reads its loader data
   * after every save and following that would tear the editor down under the
   * author's cursor. An import is the one case where replacing is what the
   * author asked for, so it is an explicit call rather than a reactive edge.
   */
  replace: (doc: DocNode) => void
}

type Props = {
  content: DocNode
  onChange: (doc: DocNode, words: number) => void
  onReady?: (handle: EditorHandle) => void
  /** The word count of the document as opened; `onChange` carries it after. */
  onCount?: (words: number) => void
  /** At the end of the toolbar: what fills the editor from elsewhere. */
  actions?: JSX.Element
  /** Between the toolbar and the text, for what such an action opens. */
  panel?: JSX.Element
  /** Under the text: the word count, the save state, the save button. */
  footer?: JSX.Element
}

type ToolbarButton = {
  key: string
  label: () => string
  icon: string
  /** Which mark or node the button turns on, for the pressed state. */
  active?: { name: string; attrs?: Record<string, unknown> }
  run: (editor: Editor) => void
}

/**
 * The buttons, and nothing else.
 *
 * This list is deliberately the same vocabulary as the allowlist in
 * `lib/articles/prosemirror.ts`. A button that produced something the server drops would
 * silently lose an author's formatting on save, and they would only find out by
 * reloading the page.
 */
const BUTTONS: Array<ToolbarButton> = [
  // Character formatting.
  {
    key: 'bold',
    icon: ICON_BOLD,
    label: () => m.write_toolbar_bold(),
    active: { name: 'bold' },
    run: (e) => e.chain().focus().toggleBold().run(),
  },
  {
    key: 'italic',
    icon: ICON_ITALIC,
    label: () => m.write_toolbar_italic(),
    active: { name: 'italic' },
    run: (e) => e.chain().focus().toggleItalic().run(),
  },
  {
    key: 'strike',
    icon: ICON_STRIKE,
    label: () => m.write_toolbar_strike(),
    active: { name: 'strike' },
    run: (e) => e.chain().focus().toggleStrike().run(),
  },
  {
    key: 'code',
    icon: ICON_CODE,
    label: () => m.write_toolbar_code(),
    active: { name: 'code' },
    run: (e) => e.chain().focus().toggleCode().run(),
  },
  // Structure: the headings are what the contents list is made from.
  {
    key: 'heading2',
    icon: ICON_HEADING_2,
    label: () => m.write_toolbar_heading2(),
    active: { name: 'heading', attrs: { level: 2 } },
    run: (e) => e.chain().focus().toggleHeading({ level: 2 }).run(),
  },
  {
    key: 'heading3',
    icon: ICON_HEADING_3,
    label: () => m.write_toolbar_heading3(),
    active: { name: 'heading', attrs: { level: 3 } },
    run: (e) => e.chain().focus().toggleHeading({ level: 3 }).run(),
  },
  // Blocks.
  {
    key: 'quote',
    icon: ICON_QUOTE,
    label: () => m.write_toolbar_quote(),
    active: { name: 'blockquote' },
    run: (e) => e.chain().focus().toggleBlockquote().run(),
  },
  {
    key: 'bulletList',
    icon: ICON_LIST,
    label: () => m.write_toolbar_bulletList(),
    active: { name: 'bulletList' },
    run: (e) => e.chain().focus().toggleBulletList().run(),
  },
  {
    key: 'orderedList',
    icon: ICON_LIST_ORDERED,
    label: () => m.write_toolbar_orderedList(),
    active: { name: 'orderedList' },
    run: (e) => e.chain().focus().toggleOrderedList().run(),
  },
  // Insertions.
  {
    key: 'rule',
    icon: ICON_RULE,
    label: () => m.write_toolbar_rule(),
    run: (e) => e.chain().focus().setHorizontalRule().run(),
  },
  {
    key: 'table',
    icon: ICON_TABLE,
    label: () => m.write_toolbar_table(),
    active: { name: 'table' },
    run: (e) =>
      e.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run(),
  },
]

export default function ArticleEditor(props: Props) {
  let host!: HTMLDivElement
  let instance: Editor | null = null
  const [editor, setEditor] = createSignal<Editor | null>(null)
  // Bumped on every transaction so the toolbar's pressed states recompute;
  // TipTap is not reactive and Solid has no reason to re-read it otherwise.
  const [revision, setRevision] = createSignal(0)
  const [ready, setReady] = createSignal(false)
  const [linkError, setLinkError] = createSignal(false)

  // Registered at component scope, where there is an owner to run it. Inside the
  // effect's apply step — and especially after an `await` — there is none, and
  // the editor would simply never be destroyed.
  onCleanup(() => {
    instance?.destroy()
    instance = null
  })

  createEffect(
    () => undefined,
    () => {
      // The document the author opens, taken once. `untrack` says so out loud:
      // the route re-reads its loader data after every save, and following that
      // would tear the editor down and rebuild it under the author's cursor.
      const initial = untrack(() => props.content)

      void (async () => {
        const [{ Editor }, { default: StarterKit }, { TableKit }] = await Promise.all([
          import('@tiptap/core'),
          import('@tiptap/starter-kit'),
          import('@tiptap/extension-table'),
        ])

        // The author may have navigated away while the chunk was in flight.
        if (!host.isConnected) return

        instance = new Editor({
          element: host,
          extensions: [
            StarterKit.configure({
              // Not in the server's allowlist, so the button would produce a
              // mark that vanishes on save.
              underline: false,
              link: {
                openOnClick: false,
                // The server re-checks this on the way in; doing it here too
                // means the author is told immediately rather than discovering
                // the link is gone after a reload.
                isAllowedUri: (url) => isSafeHref(url),
              },
            }),
            /**
             * Tables, so an imported one can be edited rather than only read.
             *
             * `resizable` is off: a column width is layout, and layout is what
             * this document format deliberately does not carry — the server
             * would drop the attribute on the next save and the author would
             * watch their work undo itself.
             */
            TableKit.configure({ table: { resizable: false } }),
          ],
          content: initial,
          onUpdate: ({ editor: current }) => {
            setRevision((n) => n + 1)
            props.onChange(current.getJSON() as DocNode, countWords(current))
          },
          onSelectionUpdate: () => setRevision((n) => n + 1),
        })
        setEditor(instance)
        setReady(true)
        // The count of the text the author opened, not of their first edit:
        // until then the footer said "0 words" under a page of text.
        props.onCount?.(countWords(instance))
        props.onReady?.({
          replace: (next) => {
            // `emitUpdate` stays on, so the route's own copy of the document
            // follows. Turning it off would leave the parent holding the old
            // text, and the next save would quietly undo the import.
            instance?.commands.setContent(next as never)
          },
        })
      })()
    },
  )

  function addLink() {
    const instance = editor()
    if (!instance) return
    const previous = instance.getAttributes('link').href as string | undefined
    const url = window.prompt(m.write_linkPrompt(), previous ?? 'https://')
    if (url === null) return
    if (url === '') {
      instance.chain().focus().unsetLink().run()
      setLinkError(false)
      return
    }
    if (!isSafeHref(url)) {
      setLinkError(true)
      return
    }
    setLinkError(false)
    instance.chain().focus().setLink({ href: url }).run()
  }

  const isActive = (button: ToolbarButton) => {
    revision()
    const instance = editor()
    if (!instance || !button.active) return false
    return instance.isActive(button.active.name, button.active.attrs)
  }

  return (
    <div class="rounded-xl border border-line bg-raised">
      {/*
       * Icons, each named by its `aria-label` and, on hover, its `title`: a
       * screen reader says "Gras", and so does the tooltip for somebody who
       * does not recognise the B. Sticky, because a proposal runs to pages and
       * the formatting is needed at the bottom as much as at the top.
       */}
      <div
        role="toolbar"
        aria-label={m.write_toolbarLabel()}
        class="sticky top-0 z-10 flex flex-wrap items-center gap-0.5 rounded-t-xl border-b border-line bg-raised px-2 py-1.5"
      >
        <For each={BUTTONS}>
          {(button) => (
            <>
              <Show when={GROUP_STARTS.has(button.key)}>
                <Separator />
              </Show>
              <button
                type="button"
                disabled={!ready()}
                aria-label={button.label()}
                title={button.label()}
                aria-pressed={isActive(button) ? 'true' : 'false'}
                onClick={() => {
                  const instance = editor()
                  if (instance) button.run(instance)
                }}
                class={TOOL}
              >
                <Icon d={button.icon} />
              </button>
            </>
          )}
        </For>
        <button
          type="button"
          disabled={!ready()}
          aria-label={m.write_toolbar_link()}
          title={m.write_toolbar_link()}
          onClick={addLink}
          class={TOOL}
        >
          <Icon d={ICON_LINK} />
        </button>
        <Separator />
        <button
          type="button"
          disabled={!ready()}
          aria-label={m.write_toolbar_undo()}
          title={m.write_toolbar_undo()}
          onClick={() => editor()?.chain().focus().undo().run()}
          class={TOOL}
        >
          <Icon d={ICON_UNDO} />
        </button>
        <button
          type="button"
          disabled={!ready()}
          aria-label={m.write_toolbar_redo()}
          title={m.write_toolbar_redo()}
          onClick={() => editor()?.chain().focus().redo().run()}
          class={TOOL}
        >
          <Icon d={ICON_REDO} />
        </button>
        {/*
         * Each slot is read once, not tested first: a JSX prop is a getter that
         * builds its element on every read, so `<Show when={props.actions}>`
         * around `{props.actions}` would build the button twice to show it once.
         */}
        <span class="grow" />
        {props.actions}
      </div>

      {props.panel}

      <div aria-live="polite" class="empty:hidden px-5 pt-3 text-sm text-danger">
        {linkError() ? m.write_linkRejected() : ''}
      </div>

      {/*
       * Named rather than blank: the editor is a separate chunk and a slow
       * connection is the case this project designs for.
       */}
      <Show when={!ready()}>
        <p class="px-5 py-4 text-sm text-muted">{m.write_editorLoading()}</p>
      </Show>
      <div ref={host} class="article-prose px-5 py-4 md:px-8 md:py-6" />

      <div class="flex flex-wrap items-center gap-3 rounded-b-xl border-t border-line bg-surface px-4 py-3 empty:hidden">
        {props.footer}
      </div>
    </div>
  )
}

function countWords(editor: Editor): number {
  const doc = editor.state.doc
  return doc.textBetween(0, doc.content.size, ' ').split(/\s+/).filter(Boolean).length
}

const TOOL =
  'inline-flex size-9 items-center justify-center rounded-md text-neutral-700 hover:bg-neutral-100 hover:text-ink disabled:opacity-40 aria-pressed:bg-accent-soft aria-pressed:text-accent'

/** Where a new group of the toolbar begins: structure, blocks, insertions. */
const GROUP_STARTS = new Set(['heading2', 'quote', 'rule'])

function Separator() {
  return <span aria-hidden="true" class="mx-1 h-6 w-px bg-line" />
}
