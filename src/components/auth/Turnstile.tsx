import { createSignal, onCleanup, onSettled, Show } from 'solid-js'
import { m } from '../../paraglide/messages'

declare global {
  interface Window {
    turnstile?: {
      render: (
        el: HTMLElement,
        opts: {
          sitekey: string
          callback: (token: string) => void
          'expired-callback'?: () => void
          'error-callback'?: () => void
          theme?: 'light' | 'dark' | 'auto'
          language?: string
        },
      ) => string
      remove: (id: string) => void
    }
  }
}

const SCRIPT_SRC = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit'

/**
 * Cloudflare Turnstile widget.
 *
 * Renders nothing when no site key is configured, so local development and the
 * test suite run without a Cloudflare account. The server is what enforces the
 * check — an absent widget simply means the token is missing, and
 * `verifyCaptcha` rejects it.
 *
 * The token is written into a hidden input so the surrounding form submits it
 * like any other field.
 */
export default function Turnstile(props: { siteKey?: string; name?: string }) {
  const [token, setToken] = createSignal('')
  let container: HTMLDivElement | undefined
  let widgetId: string | undefined

  onSettled(() => {
    if (!props.siteKey || !container) return

    const mount = () => {
      if (!window.turnstile || !container) return
      widgetId = window.turnstile.render(container, {
        sitekey: props.siteKey as string,
        callback: setToken,
        'expired-callback': () => setToken(''),
        'error-callback': () => setToken(''),
        theme: 'auto',
      })
    }

    if (window.turnstile) {
      mount()
    } else {
      const existing = document.querySelector<HTMLScriptElement>(
        `script[src="${SCRIPT_SRC}"]`,
      )
      if (existing) {
        existing.addEventListener('load', mount, { once: true })
      } else {
        const script = document.createElement('script')
        script.src = SCRIPT_SRC
        script.async = true
        script.defer = true
        script.addEventListener('load', mount, { once: true })
        document.head.appendChild(script)
      }
    }
  })

  onCleanup(() => {
    if (widgetId && window.turnstile) window.turnstile.remove(widgetId)
  })

  return (
    <Show when={props.siteKey}>
      <div class="flex flex-col gap-1">
        <span class="text-xs text-neutral-500">
          {m.auth_register_common_captchaLabel()}
        </span>
        <div ref={container} />
        <input type="hidden" name={props.name ?? 'captchaToken'} value={token()} />
      </div>
    </Show>
  )
}
