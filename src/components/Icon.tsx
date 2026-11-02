/**
 * One of the shapes in `lib/shared/icons.ts`. Decorative by construction: the
 * word beside it, or the `aria-label` of the button it sits on, says what it
 * means.
 */
export default function Icon(props: { d: string; class?: string }) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
      stroke-linecap="round"
      stroke-linejoin="round"
      class={props.class ?? 'size-5 shrink-0'}
    >
      <path d={props.d} />
    </svg>
  )
}
