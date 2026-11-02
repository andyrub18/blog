import { createEffect, createSignal, createUniqueId, Show } from 'solid-js'
import { ICON_UPLOAD } from '../lib/shared/icons'
import { m } from '../paraglide/messages'
import Icon from './Icon'

/**
 * A file field that speaks the page's language.
 *
 * A browser writes "Choose File / No file chosen" in *its* language, whatever the
 * page is in, and no page can change those words. So the real
 * `<input type="file">` is kept — it is what the form submits, what the keyboard
 * reaches and what a screen reader announces — and only hidden from sight; what
 * a sighted person sees is this drop zone, in French or Creole like the rest.
 *
 * The visible label is tied to the input with `aria-labelledby`, which the
 * member application's three PDF fields never had: a screen reader announced
 * each of them as "file, button".
 *
 * A dropped file is put into the input itself, so the form reads it the same way
 * as a chosen one. The `accept` list does not stop a drop — the browser only
 * applies it to its own dialog — which is fine: every upload is checked on the
 * server by its first bytes, never by its name or the type the browser claims.
 */
export default function FilePicker(props: {
  name: string
  accept: string
  label: string
  hint?: string
  error?: string
  required?: boolean
}) {
  const id = createUniqueId()
  let input!: HTMLInputElement
  const [fileName, setFileName] = createSignal<string | null>(null)
  const [dragging, setDragging] = createSignal(false)

  // A form that resets itself after a successful upload empties the input; the
  // name shown here has to follow.
  createEffect(
    () => undefined,
    () => {
      const form = input.form
      if (!form) return
      const clear = () => setFileName(null)
      form.addEventListener('reset', clear)
      return () => form.removeEventListener('reset', clear)
    },
  )

  function drop(event: DragEvent) {
    event.preventDefault()
    setDragging(false)
    const files = event.dataTransfer?.files
    if (!files || files.length === 0) return
    input.files = files
    input.dispatchEvent(new Event('change', { bubbles: true }))
  }

  return (
    <div class="flex flex-col gap-1.5 text-sm">
      <span id={`${id}-label`} class="font-medium text-neutral-800">
        {props.label}
      </span>
      <Show when={props.hint}>
        <span id={`${id}-hint`} class="text-xs text-muted">
          {props.hint}
        </span>
      </Show>
      <label
        onDragOver={(event) => {
          event.preventDefault()
          setDragging(true)
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={drop}
        class={`flex cursor-pointer flex-col items-center gap-1 rounded-xl border-2 border-dashed px-4 py-5 text-center focus-within:ring-2 focus-within:ring-accent/40 ${dragging() ? 'border-accent bg-accent-soft' : props.error ? 'border-danger bg-raised' : 'border-neutral-300 bg-raised hover:border-accent-line hover:bg-neutral-50'}`}
      >
        <input
          ref={input}
          type="file"
          name={props.name}
          accept={props.accept}
          required={props.required}
          class="sr-only"
          aria-labelledby={`${id}-label`}
          aria-describedby={props.hint ? `${id}-hint` : undefined}
          aria-invalid={props.error ? 'true' : undefined}
          onChange={(event) => setFileName(event.currentTarget.files?.[0]?.name ?? null)}
        />
        <Icon d={ICON_UPLOAD} class="size-6 text-accent" />
        <span>
          <span class="font-semibold text-accent underline underline-offset-2">
            {m.common_chooseFile()}
          </span>
          <span class="max-sm:hidden"> {m.common_orDropHere()}</span>
        </span>
        <span
          class={fileName() ? 'font-medium break-all text-ink' : 'text-xs text-muted'}
        >
          {fileName() ?? m.common_noFileChosen()}
        </span>
      </label>
      <Show when={props.error}>
        <span class="text-xs text-danger">{props.error}</span>
      </Show>
    </div>
  )
}
