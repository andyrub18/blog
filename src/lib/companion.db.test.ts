import { randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import { mkdtemp, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { eq } from 'drizzle-orm'
import { PDFDocument } from 'pdf-lib'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { startTestDatabase, type TestDatabase } from '../test/postgres'
import type { Viewer } from './articles'

/**
 * Companion PDFs against a real PostgreSQL and a real (temporary) disk.
 *
 * The property everything here protects: a reader is offered a companion only
 * while it was made from the text on the page. That is a subquery comparing
 * revision ids, a transaction that supersedes one row and inserts another, and
 * a file written before the row and deleted after it — none of which a mock
 * could be wrong about in the way the real thing can.
 */

let harness: TestDatabase
let uploads: string
let articles: typeof import('./articles')
let companion: typeof import('./companion')
let schema: typeof import('./db/schema')

beforeAll(async () => {
  harness = await startTestDatabase()
  process.env.DATABASE_URL = harness.url
  uploads = await mkdtemp(join(tmpdir(), 'klea-companion-'))
  process.env.UPLOAD_ROOT = uploads
  articles = await import('./articles')
  companion = await import('./companion')
  schema = await import('./db/schema')
})

afterAll(async () => {
  await harness?.stop()
  if (uploads) await rm(uploads, { recursive: true, force: true })
})

beforeEach(async () => {
  await harness.db.delete(schema.articleCompanion)
  await harness.db.delete(schema.articleRevision)
  await harness.db.delete(schema.articleTranslation)
  await harness.db.delete(schema.article)
  await harness.db.delete(schema.user)
})

async function makeUser(role: string = 'member'): Promise<Viewer> {
  const id = randomUUID()
  await harness.db.insert(schema.user).values({
    id,
    name: `${role}-${id.slice(0, 4)}`,
    email: `${id}@kleayiti.test`,
    emailVerified: true,
    role: role as 'member',
    memberStatus: 'active',
  })
  return { id, role: role as Viewer['role'], memberStatus: 'active' }
}

const TITLE = 'Réforme de l’administration publique'
const SUMMARY = 'Un diagnostic de la fonction publique et ce que le mouvement propose.'

const body = (text: string) => ({
  type: 'doc',
  content: [{ type: 'paragraph', content: [{ type: 'text', text }] }],
})

async function save(author: Viewer, articleId: string, text: string, lang = 'fr') {
  const saved = await articles.saveTranslation({
    actor: author,
    articleId,
    lang,
    title: TITLE,
    summary: SUMMARY,
    content: body(text),
  })
  if (!saved.ok) throw new Error(`save failed: ${saved.code}`)
}

async function publishedArticle(author: Viewer, senior: Viewer) {
  const created = await articles.createArticle({
    author,
    lang: 'fr',
    title: TITLE,
    summary: SUMMARY,
  })
  if (!created.ok) throw new Error(`create failed: ${created.code}`)
  const { articleId, slug } = created.value
  await save(author, articleId, 'Le texte revu par le cercle.')
  const published = await articles.publishTranslation({
    actor: senior,
    articleId,
    lang: 'fr',
  })
  if (!published.ok) throw new Error(`publish failed: ${published.code}`)
  return { articleId, slug }
}

async function pdfFile(pages = 3): Promise<File> {
  const doc = await PDFDocument.create()
  for (let i = 0; i < pages; i += 1) doc.addPage([300, 300])
  return new File([new Uint8Array(await doc.save())], 'proposition.pdf')
}

async function attach(actor: Viewer, articleId: string, file?: File) {
  return companion.attachCompanion({
    actor,
    articleId,
    lang: 'fr',
    file: file ?? (await pdfFile()),
  })
}

async function storedFiles(articleId: string): Promise<Array<string>> {
  const dir = join(uploads, 'companions', articleId)
  return existsSync(dir) ? readdir(dir) : []
}

async function bodyBytes(stream: ReadableStream<Uint8Array>): Promise<Uint8Array> {
  return new Uint8Array(await new Response(stream).arrayBuffer())
}

describe('who may attach one', () => {
  it('lets the author attach a PDF to their own text', async () => {
    const author = await makeUser()
    const { articleId } = await publishedArticle(author, await makeUser('senior_member'))
    const result = await attach(author, articleId)
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.value.pageCount).toBe(3)
  })

  /** Whoever may change the text may change its rendering; nobody else. */
  it('refuses another member, and reads nothing of their file', async () => {
    const author = await makeUser()
    const { articleId } = await publishedArticle(author, await makeUser('senior_member'))
    const stranger = await makeUser()
    expect(await attach(stranger, articleId)).toEqual({ ok: false, code: 'FORBIDDEN' })
    expect(await storedFiles(articleId)).toEqual([])
  })

  it('refuses a blocked author', async () => {
    const author = await makeUser()
    const { articleId } = await publishedArticle(author, await makeUser('senior_member'))
    const blocked = { ...author, memberStatus: 'blocked' }
    expect(await attach(blocked, articleId)).toEqual({ ok: false, code: 'FORBIDDEN' })
  })

  /** A PDF with no article text behind it would be the PDF-only publication D24 refused. */
  it('refuses a language with no text', async () => {
    const author = await makeUser()
    const { articleId } = await publishedArticle(author, await makeUser('senior_member'))
    const result = await companion.attachCompanion({
      actor: author,
      articleId,
      lang: 'ht',
      file: await pdfFile(),
    })
    expect(result).toEqual({ ok: false, code: 'NO_TEXT' })
  })

  it('stores nothing when the file is refused', async () => {
    const author = await makeUser()
    const { articleId } = await publishedArticle(author, await makeUser('senior_member'))
    const notPdf = new File([new TextEncoder().encode('PK\x03\x04 a zip')], 'x.pdf')
    expect(await attach(author, articleId, notPdf)).toEqual({
      ok: false,
      code: 'NOT_A_PDF',
    })
    expect(await harness.db.select().from(schema.articleCompanion)).toEqual([])
    expect(await storedFiles(articleId)).toEqual([])
  })
})

describe('the text moves on, the PDF stops', () => {
  it('is offered while it matches the published text', async () => {
    const author = await makeUser()
    const { articleId } = await publishedArticle(author, await makeUser('senior_member'))
    await attach(author, articleId)
    expect(await companion.servableCompanion(articleId, 'fr')).not.toBeNull()
  })

  /**
   * The central rule. A PDF is a statement in the movement's name, and one that
   * no longer matches the reviewed text is a position nobody decided on.
   */
  it('is withdrawn from readers the moment the text is saved again', async () => {
    const author = await makeUser()
    const { articleId } = await publishedArticle(author, await makeUser('senior_member'))
    await attach(author, articleId)

    await save(author, articleId, 'Le texte, corrigé après la publication.')

    expect(await companion.servableCompanion(articleId, 'fr')).toBeNull()
    const state = await companion.companionState({ actor: author, articleId, lang: 'fr' })
    expect(state.ok && state.value.state).toBe('stale')
  })

  it('is offered again once a PDF of the new text is attached', async () => {
    const author = await makeUser()
    const { articleId } = await publishedArticle(author, await makeUser('senior_member'))
    await attach(author, articleId)
    await save(author, articleId, 'Le texte, corrigé.')
    await attach(author, articleId, await pdfFile(4))

    const servable = await companion.servableCompanion(articleId, 'fr')
    expect(servable?.pageCount).toBe(4)
  })

  /**
   * Attached to the draft the circle reviewed, it goes live with that draft —
   * publication writes no revision, so it does not retire the PDF.
   */
  it('survives publication when the text did not change', async () => {
    const author = await makeUser()
    const created = await articles.createArticle({
      author,
      lang: 'fr',
      title: TITLE,
      summary: SUMMARY,
    })
    if (!created.ok) throw new Error('create failed')
    const { articleId } = created.value
    await save(author, articleId, 'Le texte soumis au cercle.')
    await attach(author, articleId)

    const senior = await makeUser('senior_member')
    await articles.publishTranslation({ actor: senior, articleId, lang: 'fr' })

    expect(await companion.servableCompanion(articleId, 'fr')).not.toBeNull()
  })
})

describe('the record', () => {
  it('keeps a replaced PDF’s row, closed, and deletes its bytes', async () => {
    const author = await makeUser()
    const { articleId } = await publishedArticle(author, await makeUser('senior_member'))
    await attach(author, articleId)
    await attach(author, articleId, await pdfFile(5))

    const rows = await harness.db
      .select()
      .from(schema.articleCompanion)
      .where(eq(schema.articleCompanion.articleId, articleId))
    expect(rows).toHaveLength(2)
    const [closed] = rows.filter((row) => row.supersededAt !== null)
    const [open] = rows.filter((row) => row.supersededAt === null)
    expect(closed.storagePath).toBeNull()
    expect(closed.supersededBy).toBe(author.id)
    expect(closed.sha256).toMatch(/^[0-9a-f]{64}$/)
    expect(open.pageCount).toBe(5)
    // Only the current file is on disk.
    expect(await storedFiles(articleId)).toHaveLength(1)
  })

  it('closes the row on removal and stops serving it', async () => {
    const author = await makeUser()
    const { articleId } = await publishedArticle(author, await makeUser('senior_member'))
    await attach(author, articleId)

    expect(
      await companion.removeCompanion({ actor: author, articleId, lang: 'fr' }),
    ).toEqual({
      ok: true,
      value: null,
    })
    expect(await companion.servableCompanion(articleId, 'fr')).toBeNull()
    expect(await storedFiles(articleId)).toEqual([])
    const rows = await harness.db.select().from(schema.articleCompanion)
    expect(rows).toHaveLength(1)
    expect(rows[0].supersededAt).not.toBeNull()
  })
})

describe('what a reader downloads', () => {
  it('serves the cleaned file for a published, public article', async () => {
    const author = await makeUser()
    const { articleId, slug } = await publishedArticle(
      author,
      await makeUser('senior_member'),
    )
    await attach(author, articleId)

    const download = await companion.openCompanionDownload({
      slug,
      lang: 'fr',
      viewer: null,
    })
    if (!download.ok || 'notModified' in download) throw new Error('expected a file')
    const bytes = await bodyBytes(download.body)
    expect(bytes.byteLength).toBe(download.byteSize)
    expect(download.filename).toBe(`${slug}-fr.pdf`)
    const reloaded = await PDFDocument.load(bytes, { updateMetadata: false })
    expect(reloaded.getTitle()).toBe(TITLE)
  })

  it('gives nobody a stale PDF, even from a link forwarded before the edit', async () => {
    const author = await makeUser()
    const { articleId, slug } = await publishedArticle(
      author,
      await makeUser('senior_member'),
    )
    await attach(author, articleId)
    await save(author, articleId, 'Corrigé.')
    expect(
      await companion.openCompanionDownload({ slug, lang: 'fr', viewer: null }),
    ).toEqual({
      ok: false,
      status: 404,
    })
  })

  it('refuses an anonymous reader a members-only article’s PDF', async () => {
    const author = await makeUser()
    const { articleId, slug } = await publishedArticle(
      author,
      await makeUser('senior_member'),
    )
    await harness.db
      .update(schema.article)
      .set({ visibility: 'members' })
      .where(eq(schema.article.id, articleId))
    await attach(author, articleId)

    expect(
      await companion.openCompanionDownload({ slug, lang: 'fr', viewer: null }),
    ).toEqual({
      ok: false,
      status: 403,
    })
    const reader = await makeUser('reader')
    const allowed = await companion.openCompanionDownload({
      slug,
      lang: 'fr',
      viewer: reader,
    })
    expect(allowed.ok).toBe(true)
  })

  it('serves nothing for a language that is not published', async () => {
    const author = await makeUser()
    const created = await articles.createArticle({
      author,
      lang: 'fr',
      title: TITLE,
      summary: SUMMARY,
    })
    if (!created.ok) throw new Error('create failed')
    await save(author, created.value.articleId, 'Brouillon.')
    await attach(author, created.value.articleId)
    expect(
      await companion.openCompanionDownload({
        slug: created.value.slug,
        lang: 'fr',
        viewer: null,
      }),
    ).toEqual({ ok: false, status: 404 })
  })

  it('tells a reader who already has the file that they have it', async () => {
    const author = await makeUser()
    const { articleId, slug } = await publishedArticle(
      author,
      await makeUser('senior_member'),
    )
    await attach(author, articleId)
    const first = await companion.openCompanionDownload({
      slug,
      lang: 'fr',
      viewer: null,
    })
    if (!first.ok) throw new Error('expected a file')

    const again = await companion.openCompanionDownload({
      slug,
      lang: 'fr',
      viewer: null,
      ifNoneMatch: `"${first.sha256}"`,
    })
    expect(again.ok && 'notModified' in again).toBe(true)
  })
})

describe('the reading view', () => {
  it('links the PDF, with its size, while it matches — and not after', async () => {
    const author = await makeUser()
    const { articleId, slug } = await publishedArticle(
      author,
      await makeUser('senior_member'),
    )
    await attach(author, articleId)

    const read = async () => {
      const result = await articles.getReadableArticle({ slug, lang: 'fr', viewer: null })
      if (!result.ok) throw new Error(result.code)
      return result.value.html
    }

    const withPdf = await read()
    expect(withPdf).toContain(`href="/api/companion/${slug}/fr"`)
    expect(withPdf).toMatch(/3 pages · 0,\d Mo/)

    await save(author, articleId, 'Corrigé.')
    expect(await read()).not.toContain('/api/companion/')
  })
})
