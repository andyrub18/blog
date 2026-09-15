import { createServerFn } from '@tanstack/solid-start'
import { isLocale, type Locale } from '../i18n'
import type { DocxError } from './docx'
import { resolveRequestLocale } from './email/locale'
import type { ImportReport } from './html-to-prosemirror'
import type { DocNode } from './prosemirror'

/**
 * The DOCX import endpoint.
 *
 * Rate-limited, because it is the most expensive thing a signed-in member can
 * ask the server to do: unzip an archive, walk an XML document and build a tree
 * from it. The zip-bomb limits in `docx.ts` cap what one request can cost; the
 * throttle caps how many of them one account can send.
 */

export type ImportErrorCode =
  | DocxError
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'RATE_LIMITED'
  | 'UNEXPECTED'

export type ImportResult =
  | {
      ok: true
      report: ImportReport
      warnings: Array<string>
      words: number
      /**
       * The converted document, sent back so the open editor can show it.
       *
       * It is already stored by the time this returns; the copy is here because
       * the editor is built once and deliberately does not follow its props —
       * without this the author would read "imported successfully" above the
       * text they had before, and would have to reload to find out it worked.
       */
      doc: DocNode
    }
  | { ok: false; code: ImportErrorCode }

export const importDocx = createServerFn({ method: 'POST' })
  .validator((formData: FormData) => {
    if (!(formData instanceof FormData)) throw new Error('Invalid payload.')
    const file = formData.get('file')
    const lang = String(formData.get('lang') ?? '')
    const articleId = String(formData.get('articleId') ?? '')
    if (!articleId) throw new Error('articleId is required')
    return {
      articleId,
      lang: isLocale(lang) ? (lang as Locale) : null,
      file: file instanceof File ? file : null,
    }
  })
  .handler(async ({ data }): Promise<ImportResult> => {
    const { requireUser } = await import('./session.server')
    const user = await requireUser()

    const { consume, RULES } = await import('./rate-limit')
    const gate = await consume(`docxImport:user:${user.id}`, RULES.docxImport)
    if (!gate.allowed) return { ok: false, code: 'RATE_LIMITED' }

    const [{ getEditableArticle, saveTranslation, canWrite }, { convertDocx }] =
      await Promise.all([import('./articles'), import('./docx')])

    const actor = { id: user.id, role: user.role, memberStatus: user.memberStatus }
    if (!canWrite(actor)) return { ok: false, code: 'FORBIDDEN' }

    // An import targets exactly one `(article_id, lang)` variant, and the author
    // is asked which — never guessed. A member publishing the same piece in
    // French and Creole performs two imports against the same article.
    const lang = data.lang ?? resolveRequestLocale()

    // Loaded before the conversion, so an unauthorised caller is refused before
    // we spend anything unzipping their file.
    const existing = await getEditableArticle({ actor, articleId: data.articleId, lang })
    if (!existing.ok) {
      return {
        ok: false,
        code: existing.code === 'FORBIDDEN' ? 'FORBIDDEN' : 'NOT_FOUND',
      }
    }

    const converted = await convertDocx(data.file)
    if (!converted.ok) return { ok: false, code: converted.code }

    /**
     * It lands as a draft, never as a submission.
     *
     * The author sees the import report and fixes what the conversion lost
     * before anybody else reads it. An import that goes straight to the circle
     * with a table missing burns a reviewer's evening and the author's trust,
     * and the author is the only person who can tell that something is gone.
     */
    const saved = await saveTranslation({
      actor,
      articleId: data.articleId,
      lang,
      // The title and summary are the author's, not Word's. A `.docx` has no
      // reliable notion of either, and overwriting what they already typed with
      // a guess would be worse than leaving it alone.
      title: existing.value.title,
      summary: existing.value.summary,
      content: converted.doc,
    })

    if (!saved.ok) {
      return {
        ok: false,
        code: saved.code === 'FORBIDDEN' ? 'FORBIDDEN' : 'UNEXPECTED',
      }
    }

    const { wordCount } = await import('./articles')
    return {
      ok: true,
      doc: converted.doc,
      report: converted.report,
      warnings: converted.warnings,
      words: wordCount(converted.doc),
    }
  })
