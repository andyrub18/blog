import { useRouteContext } from '@tanstack/solid-router'
import { Show } from 'solid-js'
import LogoutButton from '../../components/auth/LogoutButton'

/**
 * Header identity chip. The session comes from the `/$lang` route context,
 * which is resolved on the server, so there is no loading skeleton and no
 * flash of signed-out state on first paint.
 */
export default function BetterAuthHeader() {
  const context = useRouteContext({ from: '/$lang' })

  return (
    <Show when={context().user}>
      {(user) => (
        <div class="flex items-center gap-2">
          <Show
            when={user().image}
            fallback={
              <div class="flex h-8 w-8 items-center justify-center bg-neutral-100 dark:bg-neutral-800">
                <span class="text-xs font-medium text-neutral-600 dark:text-neutral-400">
                  {user().name?.charAt(0).toUpperCase() || 'U'}
                </span>
              </div>
            }
          >
            {(image) => <img src={image()} alt="" class="h-8 w-8" />}
          </Show>
          <LogoutButton />
        </div>
      )}
    </Show>
  )
}
