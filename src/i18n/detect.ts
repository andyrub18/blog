import { createServerFn } from '@tanstack/solid-start'
import { DEFAULT_LOCALE, isLocale, LOCALES, type Locale } from './index'

const COOKIE_NAME = 'lang'
const COOKIE_MAX_AGE = 60 * 60 * 24 * 365 // 1 year

function parseCookie(header: string | null, name: string): string | undefined {
  if (!header) return undefined
  for (const part of header.split(';')) {
    const [k, ...v] = part.trim().split('=')
    if (k === name) return decodeURIComponent(v.join('='))
  }
  return undefined
}

function fromAcceptLanguage(header: string | null): Locale | undefined {
  if (!header) return undefined
  // Parse "fr-FR,fr;q=0.9,en;q=0.8" → first match wins.
  const tags = header
    .split(',')
    .map((part) => {
      const [tag, ...params] = part.trim().split(';')
      const q = params
        .map((p) => p.trim())
        .find((p) => p.startsWith('q='))
        ?.slice(2)
      return { tag: tag.toLowerCase(), q: q ? Number(q) : 1 }
    })
    .sort((a, b) => b.q - a.q)
  for (const { tag } of tags) {
    const primary = tag.split('-')[0]
    if (isLocale(primary)) return primary
  }
  return undefined
}

/** Negotiate the active locale for an unprefixed request. */
export const detectLocale = createServerFn({ method: 'GET' }).handler(
  async (): Promise<Locale> => {
    const { getRequest } = await import('@tanstack/solid-start/server')
    const req = getRequest()
    const cookieLocale = parseCookie(req.headers.get('cookie'), COOKIE_NAME)
    if (isLocale(cookieLocale)) return cookieLocale
    const accepted = fromAcceptLanguage(req.headers.get('accept-language'))
    return accepted ?? DEFAULT_LOCALE
  },
)

/** Persist the user-selected locale as a cookie. */
export const setLocaleCookie = createServerFn({ method: 'POST' })
  .inputValidator((data: { locale: string }) => {
    if (!isLocale(data?.locale)) throw new Error('Invalid locale.')
    return { locale: data.locale }
  })
  .handler(async ({ data }) => {
    // Lazy import to keep this module ESM-safe in client transforms.
    const { setCookie } = await import('@tanstack/solid-start/server')
    setCookie(COOKIE_NAME, data.locale, {
      path: '/',
      maxAge: COOKIE_MAX_AGE,
      sameSite: 'lax',
      httpOnly: false, // readable by client if ever needed
    })
    return { ok: true as const }
  })

export { LOCALES }
