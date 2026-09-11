import type { Locale } from '../../i18n'
import { m } from '../../paraglide/messages'

export type RenderedEmail = {
  subject: string
  html: string
  text: string
}

/**
 * Escape text for interpolation into the HTML body.
 *
 * Names come from user registration and are therefore untrusted. An unescaped
 * name would let someone register as `<img src=x onerror=...>` and have it
 * rendered by every mail client that runs HTML.
 */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

/**
 * Wrap body content in a minimal, table-free shell.
 *
 * Deliberately plain: no images, no web fonts, no tracking pixel. Readers on
 * metered Haitian mobile data should not pay for decoration, and a mail that
 * loads no remote resources cannot be used to confirm that an address is live.
 */
function layout(locale: Locale, heading: string, body: string): string {
  return `<!doctype html>
<html lang="${locale}">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:24px;background:#f6f7f9;font-family:system-ui,-apple-system,'Segoe UI',sans-serif;color:#10151c">
  <div style="max-width:520px;margin:0 auto;background:#ffffff;border:1px solid #dde1e8;border-radius:6px;padding:28px">
    <h1 style="margin:0 0 16px;font-size:20px;line-height:1.3;color:#10151c">${heading}</h1>
    ${body}
    <p style="margin:24px 0 0;font-size:14px;color:#4a5462">${escapeHtml(m.email_common_signoff({}, { locale }))}</p>
  </div>
  <p style="max-width:520px;margin:16px auto 0;font-size:12px;color:#727d8c;text-align:center">${escapeHtml(m.email_common_footer({}, { locale }))}</p>
</body>
</html>`
}

/** The account-verification email, in the reader's language. */
export function renderVerificationEmail(input: {
  name: string
  url: string
  locale: Locale
}): RenderedEmail {
  const { name, url, locale } = input
  const heading = m.email_verify_heading({}, { locale })
  const intro = m.email_verify_intro({ name }, { locale })
  const cta = m.email_verify_cta({}, { locale })
  const fallback = m.email_verify_fallback({}, { locale })
  const ignore = m.email_verify_ignore({}, { locale })
  const signoff = m.email_common_signoff({}, { locale })
  const footer = m.email_common_footer({}, { locale })

  const body = `
    <p style="margin:0 0 20px;font-size:15px;line-height:1.6">${escapeHtml(intro)}</p>
    <p style="margin:0 0 20px">
      <a href="${escapeHtml(url)}" style="display:inline-block;background:#1b3fa0;color:#ffffff;text-decoration:none;padding:11px 20px;border-radius:4px;font-size:15px;font-weight:600">${escapeHtml(cta)}</a>
    </p>
    <p style="margin:0 0 6px;font-size:13px;color:#4a5462">${escapeHtml(fallback)}</p>
    <p style="margin:0 0 20px;font-size:13px;word-break:break-all"><a href="${escapeHtml(url)}" style="color:#1b3fa0">${escapeHtml(url)}</a></p>
    <p style="margin:0;font-size:13px;color:#727d8c">${escapeHtml(ignore)}</p>`

  const text = [
    heading,
    '',
    intro,
    '',
    cta + ':',
    url,
    '',
    ignore,
    '',
    signoff,
    footer,
  ].join('\n')

  return {
    subject: m.email_verify_subject({}, { locale }),
    html: layout(locale, escapeHtml(heading), body),
    text,
  }
}
