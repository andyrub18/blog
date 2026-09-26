import { createServerFn } from '@tanstack/solid-start'
import { isLocale } from '../i18n'
import type { CompanionError, CompanionState } from './companion'
import type { PdfCleaning } from './pdf'

/**
 * The companion PDF's server functions, for the author's editor.
 *
 * Each one re-checks the caller: these are public HTTP endpoints whatever page
 * happens to call them. The permission is the one for editing the text,
 * because a companion is a rendering of that text and whoever may change the
 * one may change the other.
 *
 * `./companion` is imported dynamically, never statically — it reaches the
 * filesystem, the database and pdf-lib, and the write page imports this file.
 */

export type CompanionActionError = CompanionError | 'RATE_LIMITED' | 'INVALID_LANGUAGE'

export type AttachResult =
  | {
      ok: true
      state: CompanionState
      cleaning: PdfCleaning
    }
  | { ok: false; code: CompanionActionError }

export type StateResult =
  | { ok: true; state: CompanionState }
  | { ok: false; code: CompanionActionError }

async function requireActor() {
  const { requireUser } = await import('./session.server')
  const user = await requireUser()
  return { id: user.id, role: user.role, memberStatus: user.memberStatus }
}

export const attachCompanionPdf = createServerFn({ method: 'POST' })
  .validator((formData: FormData) => {
    if (!(formData instanceof FormData)) throw new Error('Invalid payload.')
    const file = formData.get('file')
    return {
      articleId: String(formData.get('articleId') ?? ''),
      lang: String(formData.get('lang') ?? ''),
      file: file instanceof File ? file : null,
    }
  })
  .handler(async ({ data }): Promise<AttachResult> => {
    const actor = await requireActor()
    if (!isLocale(data.lang)) return { ok: false, code: 'INVALID_LANGUAGE' }

    const { consume, RULES } = await import('./rate-limit')
    const gate = await consume(`companionUpload:user:${actor.id}`, RULES.companionUpload)
    if (!gate.allowed) return { ok: false, code: 'RATE_LIMITED' }

    const { attachCompanion } = await import('./companion')
    const result = await attachCompanion({
      actor,
      articleId: data.articleId,
      lang: data.lang,
      file: data.file,
    })
    if (!result.ok) return result
    const { cleaning, ...summary } = result.value
    return { ok: true, state: { state: 'current', ...summary }, cleaning }
  })

export const removeCompanionPdf = createServerFn({ method: 'POST' })
  .validator((data: { articleId: string; lang: string }) => ({
    articleId: String(data?.articleId ?? ''),
    lang: String(data?.lang ?? ''),
  }))
  .handler(async ({ data }): Promise<StateResult> => {
    const actor = await requireActor()
    if (!isLocale(data.lang)) return { ok: false, code: 'INVALID_LANGUAGE' }
    const { removeCompanion } = await import('./companion')
    const result = await removeCompanion({ actor, ...data })
    if (!result.ok) return result
    return { ok: true, state: { state: 'none' } }
  })

export const fetchCompanionState = createServerFn({ method: 'GET' })
  .validator((data: { articleId: string; lang: string }) => ({
    articleId: String(data?.articleId ?? ''),
    lang: String(data?.lang ?? ''),
  }))
  .handler(async ({ data }): Promise<StateResult> => {
    const actor = await requireActor()
    if (!isLocale(data.lang)) return { ok: false, code: 'INVALID_LANGUAGE' }
    const { companionState } = await import('./companion')
    const result = await companionState({ actor, ...data })
    if (!result.ok) return result
    return { ok: true, state: result.value }
  })
