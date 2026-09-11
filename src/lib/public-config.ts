import { createServerFn } from '@tanstack/solid-start'

export type PublicConfig = {
  /**
   * Turnstile site key. Public by design — it identifies the widget, it does
   * not authorise anything. The secret half never leaves the server.
   * Empty when no captcha is configured, which hides the widget.
   */
  turnstileSiteKey: string
}

/** Configuration the browser is allowed to see. Nothing secret goes in here. */
export const fetchPublicConfig = createServerFn({ method: 'GET' }).handler(
  async (): Promise<PublicConfig> => ({
    turnstileSiteKey: process.env.TURNSTILE_SITE_KEY ?? '',
  }),
)
