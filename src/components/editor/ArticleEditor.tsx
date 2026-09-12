import type { Editor } from '@tiptap/core'
import { createEffect, createSignal, For, onCleanup, Show, untrack } from 'solid-js'
import { type DocNode, isSafeHref } from '../../lib/prosemirror'
import { m } from '../../paraglide/messages'

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
}

type ToolbarButton = {
  key: string
  label: () => string
  /** Which mark or node the button turns on, for the pressed state. */
  active?: { name: string; attrs?: Record<string, unknown> }
  run: (editor: Editor) => void
}

/**
 * The buttons, and nothing else.
 *
 * This list is deliberately the same vocabulary as the allowlist in
 * `lib/prosemirror.ts`. A button that produced something the server drops would
 * silently lose an author's formatting on save, and they would only find out by
 * reloading the page.
 */
const BUTTONS: Array<ToolbarButton> = [
  {
    key: 'bold',
    label: () => m.write_toolbar_bold(),
    active: { name: 'bold' },
    run: (e) => e.chain().focus().toggleBold().run(),
  },
  {
    key: 'italic',
    label: () => m.write_toolbar_italic(),
    active: { name: 'italic' },
    run: (e) => e.chain().focus().toggleItalic().run(),
  },
  {
    key: 'strike',
    label: () => m.write_toolbar_strike(),
    active: { name: 'strike' },
    run: (e) => e.chain().focus().toggleStrike().run(),
  },
  {
    key: 'code',
    label: () => m.write_toolbar_code(),
    active: { name: 'code' },
    run: (e) => e.chain().focus().toggleCode().run(),
  },
  {
    key: 'heading2',
    label: () => m.write_toolbar_heading2(),
    active: { name: 'heading', attrs: { level: 2 } },
    run: (e) => e.chain().focus().toggleHeading({ level: 2 }).run(),
  },
  {
    key: 'heading3',
    label: () => m.write_toolbar_heading3(),
    active: { name: 'heading', attrs: { level: 3 } },
    run: (e) => e.chain().focus().toggleHeading({ level: 3 }).run(),
  },
  {
    key: 'quote',
    label: () => m.write_toolbar_quote(),
    active: { name: 'blockquote' },
    run: (e) => e.chain().focus().toggleBlockquote().run(),
  },
  {
    key: 'bulletList',
    label: () => m.write_toolbar_bulletList(),
    active: { name: 'bulletList' },
    run: (e) => e.chain().focus().toggleBulletList().run(),
  },
  {
    key: 'orderedList',
    label: () => m.write_toolbar_orderedList(),
    active: { name: 'orderedList' },
    run: (e) => e.chain().focus().toggleOrderedList().run(),
  },
  {
    key: 'rule',
    label: () => m.write_toolbar_rule(),
    run: (e) => e.chain().focus().setHorizontalRule().run(),
  },
  {
    key: 'table',
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
            props.onChange(
              current.getJSON() as DocNode,
              current.state.doc
                .textBetween(0, current.state.doc.content.size, ' ')
                .split(/\s+/)
                .filter(Boolean).length,
            )
          },
          onSelectionUpdate: () => setRevision((n) => n + 1),
        })
        setEditor(instance)
        setReady(true)
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
    <div class="rounded-lg border border-neutral-300 bg-white">
      <div class="flex flex-wrap gap-1 border-b border-neutral-200 p-2">
        <For each={BUTTONS}>
          {(button) => (
            <button
              type="button"
              disabled={!ready()}
              aria-pressed={isActive(button) ? 'true' : 'false'}
              onClick={() => {
                const instance = editor()
                if (instance) button.run(instance)
              }}
              class="rounded px-2 py-1 text-xs font-medium text-neutral-700 hover:bg-neutral-100 aria-pressed:bg-neutral-900 aria-pressed:text-white"
            >
              {button.label()}
            </button>
          )}
        </For>
        <button
          type="button"
          onClick={addLink}
          class="rounded px-2 py-1 text-xs font-medium text-neutral-700 hover:bg-neutral-100"
        >
          {m.write_toolbar_link()}
        </button>
        <span class="grow" />
        <button
          type="button"
          onClick={() => editor()?.chain().focus().undo().run()}
          class="rounded px-2 py-1 text-xs font-medium text-neutral-700 hover:bg-neutral-100"
        >
          {m.write_toolbar_undo()}
        </button>
        <button
          type="button"
          onClick={() => editor()?.chain().focus().redo().run()}
          class="rounded px-2 py-1 text-xs font-medium text-neutral-700 hover:bg-neutral-100"
        >
          {m.write_toolbar_redo()}
        </button>
      </div>

      <div aria-live="polite" class="empty:hidden px-3 text-sm text-[#A3261F]">
        {linkError() ? m.write_linkRejected() : ''}
      </div>

      {/*
       * Named rather than blank: the editor is a separate chunk and a slow
       * connection is the case this project designs for.
       */}
      <Show when={!ready()}>
        <p class="px-4 py-3 text-sm text-neutral-500">{m.write_editorLoading()}</p>
      </Show>
      <div ref={host} class="article-prose px-4 py-3" />
    </div>
  )
}
