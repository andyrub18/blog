import type { JSX } from '@solidjs/web'
import { useRouter } from '@tanstack/solid-router'
import { createSignal } from 'solid-js'
import { signOut } from '../../lib/auth/auth-actions'
import { m } from '../../paraglide/messages'

export default function LogoutButton(props: { class?: string; icon?: JSX.Element }) {
  const router = useRouter()
  const [loading, setLoading] = createSignal(false)

  async function onClick() {
    setLoading(true)
    try {
      await signOut()
    } finally {
      setLoading(false)
      await router.navigate({ to: '/auth/login' })
      router.invalidate()
    }
  }

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={loading()}
      class={
        props.class ??
        'h-9 px-4 text-sm font-medium border border-neutral-300 rounded-md hover:bg-neutral-50 disabled:opacity-60'
      }
    >
      {props.icon}
      {/* Disabled while it works, and still named for what it does: it used to
          say "Connexion…", the sign-in form's word, while signing out. */}
      {m.common_logout()}
    </button>
  )
}
