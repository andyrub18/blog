import { randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import { mkdtemp, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { eq } from 'drizzle-orm'
import { PDFDocument } from 'pdf-lib'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { startTestDatabase, type TestDatabase } from '../../../test/postgres'
import type { Documentation } from '../../deliberation/article-review'
import type { Viewer } from '../articles'

/**
 * Companion PDFs against a real PostgreSQL and a real (temporary) disk.
 *
 * Two properties, both enforced in SQL and both worth nothing if a mock agreed
 * with them:
 *
 * - **Readers get only a PDF the circle approved** (D29): one attached before a
 *   round was submitted, still matching the text, in a language that round
 *   accepted. Everything else waits.
 * - **Readers never get a PDF of text that has since changed** (D26).
 *
 * The rounds here are real ones — submitted, paneled, argued and decided —
 * because approval is a side effect of `decide()`, and a test that stamped the
 * row by hand would be testing the stamp.
 */

let harness: TestDatabase
let uploads: string
let articles: typeof import('../articles')
let review: typeof import('../../deliberation/article-review')
let companion: typeof import('./companion')
let schema: typeof import('../../db/schema')

beforeAll(async () => {
  harness = await startTestDatabase()
  process.env.DATABASE_URL = harness.url
  uploads = await mkdtemp(join(tmpdir(), 'klea-companion-'))
  process.env.UPLOAD_ROOT = uploads
  articles = await import('../articles')
  review = await import('../../deliberation/article-review')
  companion = await import('./companion')
  schema = await import('../../db/schema')
})

afterAll(async () => {
  await harness?.stop()
  if (uploads) await rm(uploads, { recursive: true, force: true })
})

beforeEach(async () => {
  await harness.db.delete(schema.articleVersion)
  await harness.db.delete(schema.articleCompanion)
  await harness.db.delete(schema.articleDecision)
  await harness.db.delete(schema.articleReview)
  await harness.db.delete(schema.articleReviewer)
  await harness.db.delete(schema.articleSubmission)
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
const RATIONALE = 'Le diagnostic tient, et le PDF dit ce que dit le texte.'
const DOCUMENTATION: Documentation = {
  diagnosis: 'Les concours ne sont pas publiés et les nominations ne sont pas motivées.',
  solutions: 'Publier les résultats des concours, motiver chaque nomination, les deux.',
  resources: 'Deux membres à mi-temps pendant un trimestre, et les journaux officiels.',
  risks:
    'Publier un chiffre faux et perdre la crédibilité que la proposition veut bâtir.',
  indicators:
    'Le nombre de postes techniques pourvus par concours, publié chaque trimestre.',
}

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

async function draft(author: Viewer, text = 'Le texte soumis au cercle.') {
  const created = await articles.createArticle({
    author,
    lang: 'fr',
    title: TITLE,
    summary: SUMMARY,
  })
  if (!created.ok) throw new Error(`create failed: ${created.code}`)
  await save(author, created.value.articleId, text)
  return created.value
}

async function pdfFile(pages = 3): Promise<File> {
  const doc = await PDFDocument.create()
  for (let i = 0; i < pages; i += 1) doc.addPage([300, 300])
  return new File([new Uint8Array(await doc.save())], 'proposition.pdf')
}

async function attach(actor: Viewer, articleId: string, pages = 3) {
  const result = await companion.attachCompanion({
    actor,
    articleId,
    lang: 'fr',
    file: await pdfFile(pages),
  })
  if (!result.ok) throw new Error(`attach failed: ${result.code}`)
  return result.value
}

type Circle = { senior: Viewer; members: Array<Viewer> }

async function circle(): Promise<Circle> {
  return {
    senior: await makeUser('senior_member'),
    members: [await makeUser(), await makeUser(), await makeUser()],
  }
}

async function submit(author: Viewer, articleId: string): Promise<string> {
  const submitted = await review.submitForReview({
    actor: author,
    articleId,
    langs: ['fr'],
    documentation: DOCUMENTATION,
  })
  if (!submitted.ok) throw new Error(`submit failed: ${submitted.code}`)
  return submitted.value.submissionId
}

/** Panel, debate, verdicts and decision on a submitted round. */
async function decideRound(
  { senior, members }: Circle,
  submissionId: string,
  verdict: 'support' | 'object' = 'support',
) {
  for (const [i, member] of members.entries()) {
    const assigned = await review.assignReviewer({
      actor: senior,
      submissionId,
      userId: member.id,
      stance: i === 0 ? 'contradictor' : 'reviewer',
    })
    if (!assigned.ok) throw new Error(`assign failed: ${assigned.code}`)
  }
  const opened = await review.openDeliberation({ actor: senior, submissionId })
  if (!opened.ok) throw new Error(`open failed: ${opened.code}`)
  for (const member of members) {
    const said = await review.recordVerdict({
      actor: member,
      submissionId,
      lang: 'fr',
      verdict,
      rationale: RATIONALE,
    })
    if (!said.ok) throw new Error(`verdict failed: ${said.code}`)
  }
  const decided = await review.decide({
    actor: senior,
    submissionId,
    rationale: RATIONALE,
    unresolved: 'rejected',
  })
  if (!decided.ok) throw new Error(`decide failed: ${decided.code}`)
  return decided.value
}

/** An article the circle published together with its PDF. */
async function liveWithPdf(pages = 3) {
  const author = await makeUser()
  const people = await circle()
  const { articleId, slug } = await draft(author)
  await attach(author, articleId, pages)
  const submissionId = await submit(author, articleId)
  await decideRound(people, submissionId)
  return { author, people, articleId, slug, submissionId }
}

/** Where the author's working PDF stands. */
async function stateOf(actor: Viewer, articleId: string) {
  const result = await companion.companionState({ actor, articleId, lang: 'fr' })
  if (!result.ok) throw new Error(result.code)
  return result.value.working.state
}

/** The version readers are shown, and the PDF it carries. */
async function publishedVersion(articleId: string) {
  const [row] = await harness.db
    .select({
      number: schema.articleVersion.number,
      submissionId: schema.articleVersion.submissionId,
      companionId: schema.articleVersion.companionId,
    })
    .from(schema.articleTranslation)
    .innerJoin(
      schema.articleVersion,
      eq(schema.articleVersion.id, schema.articleTranslation.publishedVersionId),
    )
    .where(eq(schema.articleTranslation.articleId, articleId))
    .limit(1)
  return row ?? null
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
    const { articleId } = await draft(author)
    const result = await attach(author, articleId)
    expect(result.pageCount).toBe(3)
  })

  /** Whoever may change the text may change its rendering; nobody else. */
  it('refuses another member, and reads nothing of their file', async () => {
    const author = await makeUser()
    const { articleId } = await draft(author)
    const result = await companion.attachCompanion({
      actor: await makeUser(),
      articleId,
      lang: 'fr',
      file: await pdfFile(),
    })
    expect(result).toEqual({ ok: false, code: 'FORBIDDEN' })
    expect(await storedFiles(articleId)).toEqual([])
  })

  it('refuses a blocked author', async () => {
    const author = await makeUser()
    const { articleId } = await draft(author)
    const result = await companion.attachCompanion({
      actor: { ...author, memberStatus: 'blocked' },
      articleId,
      lang: 'fr',
      file: await pdfFile(),
    })
    expect(result).toEqual({ ok: false, code: 'FORBIDDEN' })
  })

  /** A PDF with no article text behind it would be the PDF-only publication D24 refused. */
  it('refuses a language with no text', async () => {
    const author = await makeUser()
    const { articleId } = await draft(author)
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
    const { articleId } = await draft(author)
    const notPdf = new File([new TextEncoder().encode('PK\x03\x04 a zip')], 'x.pdf')
    const result = await companion.attachCompanion({
      actor: author,
      articleId,
      lang: 'fr',
      file: notPdf,
    })
    expect(result).toEqual({ ok: false, code: 'NOT_A_PDF' })
    expect(await harness.db.select().from(schema.articleCompanion)).toEqual([])
    expect(await storedFiles(articleId)).toEqual([])
  })
})

describe('a PDF goes to readers inside an approved version (D29, D31)', () => {
  it('is offered to readers once the version it belongs to is approved', async () => {
    const { articleId, submissionId } = await liveWithPdf()
    const servable = await companion.servableCompanion(articleId, 'fr')
    const version = await publishedVersion(articleId)
    expect(version?.submissionId).toBe(submissionId)
    expect(servable?.id).toBe(version?.companionId)
    expect(servable?.version).toBe(1)
  })

  /** Nobody publishes a PDF alone. */
  it('is not offered when attached to an article that is already live', async () => {
    const author = await makeUser()
    const { articleId } = await draft(author)
    await decideRound(await circle(), await submit(author, articleId))

    await attach(author, articleId)

    expect(await companion.servableCompanion(articleId, 'fr')).toBeNull()
    expect(await stateOf(author, articleId)).toBe('awaitingReview')
  })

  it('goes into the version when it was attached before the language was submitted', async () => {
    const author = await makeUser()
    const { articleId } = await draft(author)
    await attach(author, articleId)
    await submit(author, articleId)
    expect(await stateOf(author, articleId)).toBe('inReview')
  })

  /**
   * The circle can only vouch for a file it was given. One attached after the
   * language was submitted is not in that version, so that decision cannot
   * publish it.
   */
  it('stays out of a version submitted before it was attached', async () => {
    const author = await makeUser()
    const people = await circle()
    const { articleId } = await draft(author)
    const submissionId = await submit(author, articleId)
    await attach(author, articleId)

    expect(await stateOf(author, articleId)).toBe('nextRound')
    await decideRound(people, submissionId)

    expect(await companion.servableCompanion(articleId, 'fr')).toBeNull()
    expect(await stateOf(author, articleId)).toBe('awaitingReview')
  })

  it('goes to readers with the next version instead', async () => {
    const author = await makeUser()
    const people = await circle()
    const { articleId } = await draft(author)
    await decideRound(people, await submit(author, articleId))
    await attach(author, articleId)

    const second = await submit(author, articleId)
    await decideRound(people, second)

    const version = await publishedVersion(articleId)
    expect(version).toMatchObject({ number: 2, submissionId: second })
    expect(version?.companionId).not.toBeNull()
  })

  /**
   * The circle reviewed text A with PDF A. The author drafting B meanwhile
   * changes neither: the version carries A and its PDF, and that is what goes
   * live (D30, D31).
   */
  it('goes live with the text it was reviewed with, whatever was drafted since', async () => {
    const author = await makeUser()
    const people = await circle()
    const { articleId } = await draft(author)
    await attach(author, articleId)
    const submissionId = await submit(author, articleId)
    await save(author, articleId, 'Le texte, modifié pendant l’examen.')

    await decideRound(people, submissionId)

    expect((await publishedVersion(articleId))?.submissionId).toBe(submissionId)
    expect(await companion.servableCompanion(articleId, 'fr')).not.toBeNull()
  })

  /**
   * The mirror case: a PDF made from an earlier text than the one submitted
   * describes something the circle is not being asked to approve, so the
   * version does not carry it.
   */
  it('is left out of a version whose text it does not describe', async () => {
    const author = await makeUser()
    const people = await circle()
    const { articleId } = await draft(author)
    await attach(author, articleId)
    await save(author, articleId, 'Le texte, révisé avant la soumission.')
    await decideRound(people, await submit(author, articleId))

    expect(await companion.servableCompanion(articleId, 'fr')).toBeNull()
    expect((await publishedVersion(articleId))?.companionId).toBeNull()
    expect(await stateOf(author, articleId)).toBe('stale')
  })

  it('is not published with a version the circle refused', async () => {
    const author = await makeUser()
    const { articleId } = await draft(author)
    await attach(author, articleId)
    await decideRound(await circle(), await submit(author, articleId), 'object')

    expect(await companion.servableCompanion(articleId, 'fr')).toBeNull()
    const [version] = await harness.db.select().from(schema.articleVersion)
    expect(version.outcome).toBe('refused')
  })

  /**
   * The published version keeps its own file. A better-typeset PDF attached
   * afterwards is a new file nobody has reviewed: it goes with the next
   * version, and until that version is approved readers keep the one they had.
   */
  it('keeps serving the published PDF when the author attaches a new one', async () => {
    const { author, people, articleId } = await liveWithPdf(3)
    await attach(author, articleId, 5)
    expect((await companion.servableCompanion(articleId, 'fr'))?.pageCount).toBe(3)

    await decideRound(people, await submit(author, articleId))
    expect((await companion.servableCompanion(articleId, 'fr'))?.pageCount).toBe(5)
  })
})

describe('the published text moves on, the PDF with it', () => {
  it('stays with readers while the author drafts changes', async () => {
    const { author, articleId } = await liveWithPdf()
    await save(author, articleId, 'Le texte, corrigé après la publication.')
    expect(await companion.servableCompanion(articleId, 'fr')).not.toBeNull()
  })

  it('is withdrawn when a version with a new text and no new PDF is approved', async () => {
    const { author, people, articleId } = await liveWithPdf()
    await save(author, articleId, 'Le texte, corrigé après la publication.')
    await decideRound(people, await submit(author, articleId))

    expect(await companion.servableCompanion(articleId, 'fr')).toBeNull()
    expect(await stateOf(author, articleId)).toBe('stale')
  })
})

describe('the record', () => {
  /**
   * A file a version carries is part of the record — reviewers of a later
   * round compare against it, and the published one is being served — so its
   * bytes stay when the author replaces it.
   */
  it('keeps a replaced PDF, closed, while a version carries it', async () => {
    const { author, articleId } = await liveWithPdf()
    await attach(author, articleId, 5)

    const rows = await harness.db
      .select()
      .from(schema.articleCompanion)
      .where(eq(schema.articleCompanion.articleId, articleId))
    expect(rows).toHaveLength(2)
    const [closed] = rows.filter((row) => row.supersededAt !== null)
    expect(closed.supersededBy).toBe(author.id)
    expect(closed.storagePath).not.toBeNull()
    expect(closed.sha256).toMatch(/^[0-9a-f]{64}$/)
    expect(await storedFiles(articleId)).toHaveLength(2)
  })

  it('lets go of a replaced PDF no version carries', async () => {
    const author = await makeUser()
    const { articleId } = await draft(author)
    await attach(author, articleId, 3)
    await attach(author, articleId, 5)
    expect(await storedFiles(articleId)).toHaveLength(1)
  })

  it('removing the working PDF leaves the published one where it is', async () => {
    const { author, articleId } = await liveWithPdf()
    expect(
      await companion.removeCompanion({ actor: author, articleId, lang: 'fr' }),
    ).toEqual({ ok: true, value: null })
    expect(await companion.servableCompanion(articleId, 'fr')).not.toBeNull()
    expect(await stateOf(author, articleId)).toBe('none')
    expect(await storedFiles(articleId)).toHaveLength(1)
  })
})

describe('what a reviewer downloads', () => {
  async function inReview() {
    const author = await makeUser()
    const { articleId } = await draft(author)
    await attach(author, articleId)
    const submissionId = await submit(author, articleId)
    return { author, articleId, submissionId }
  }

  it('gives a member the PDF under review', async () => {
    const { submissionId } = await inReview()
    const download = await companion.openCompanionForReview({
      submissionId,
      lang: 'fr',
      viewer: await makeUser(),
    })
    if (!download.ok) throw new Error(`expected a file, got ${download.status}`)
    const bytes = await bodyBytes(download.body)
    expect(bytes.byteLength).toBe(download.byteSize)
  })

  /** The same audience as the submission page: members, not readers. */
  it('refuses a reader and an anonymous visitor', async () => {
    const { submissionId } = await inReview()
    for (const viewer of [await makeUser('reader'), null]) {
      expect(
        await companion.openCompanionForReview({ submissionId, lang: 'fr', viewer }),
      ).toEqual({ ok: false, status: 403 })
    }
  })

  it('does not offer a PDF attached after the round as though it were under review', async () => {
    const author = await makeUser()
    const { articleId } = await draft(author)
    const submissionId = await submit(author, articleId)
    await attach(author, articleId)

    expect(
      await companion.openCompanionForReview({
        submissionId,
        lang: 'fr',
        viewer: await makeUser(),
      }),
    ).toEqual({ ok: false, status: 404 })
  })
})

describe('what a reader downloads', () => {
  it('serves the approved file for a published, public article', async () => {
    const { slug } = await liveWithPdf()
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

  it('gives nobody a stale PDF, even from a link forwarded before the text changed', async () => {
    const { author, people, articleId, slug } = await liveWithPdf()
    await save(author, articleId, 'Corrigé.')
    await decideRound(people, await submit(author, articleId))
    expect(
      await companion.openCompanionDownload({ slug, lang: 'fr', viewer: null }),
    ).toEqual({
      ok: false,
      status: 404,
    })
  })

  it('refuses an anonymous reader a members-only article’s PDF', async () => {
    const { articleId, slug } = await liveWithPdf()
    await harness.db
      .update(schema.article)
      .set({ visibility: 'members' })
      .where(eq(schema.article.id, articleId))

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

  it('tells a reader who already has the file that they have it', async () => {
    const { slug } = await liveWithPdf()
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
  it('links the approved PDF, with its size, until a new text is published', async () => {
    const { author, people, articleId, slug } = await liveWithPdf()
    const read = async () => {
      const result = await articles.getReadableArticle({ slug, lang: 'fr', viewer: null })
      if (!result.ok) throw new Error(result.code)
      return result.value.html
    }

    const withPdf = await read()
    expect(withPdf).toContain(`href="/api/companion/${slug}/fr"`)
    expect(withPdf).toMatch(/3 pages · 0,\d Mo/)

    // A draft changes nothing a reader sees, the link included.
    await save(author, articleId, 'Corrigé.')
    expect(await read()).toContain('/api/companion/')

    await decideRound(people, await submit(author, articleId))
    expect(await read()).not.toContain('/api/companion/')
  })
})
