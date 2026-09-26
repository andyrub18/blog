import { randomUUID } from 'node:crypto'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { eq } from 'drizzle-orm'
import { PDFDocument } from 'pdf-lib'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { startTestDatabase, type TestDatabase } from '../../test/postgres'
import type { Documentation } from '../deliberation/article-review'
import type { Viewer } from './articles'

/**
 * Versions against a real PostgreSQL, through real rounds (D31).
 *
 * The rules: a version is made when a language is submitted, numbered per
 * language whatever becomes of it; the published version is the highest
 * approved one; the circle compares each version with the one before it
 * whatever its outcome; readers see approved versions only, each compared with
 * the previous *approved* one — so no refused text ever reaches a reader.
 */

let harness: TestDatabase
let uploads: string
let articles: typeof import('./articles')
let review: typeof import('../deliberation/article-review')
let versions: typeof import('./versions')
let companion: typeof import('./companion/companion')
let schema: typeof import('../db/schema')

beforeAll(async () => {
  harness = await startTestDatabase()
  process.env.DATABASE_URL = harness.url
  uploads = await mkdtemp(join(tmpdir(), 'klea-versions-'))
  process.env.UPLOAD_ROOT = uploads
  articles = await import('./articles')
  review = await import('../deliberation/article-review')
  versions = await import('./versions')
  companion = await import('./companion/companion')
  schema = await import('../db/schema')
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

async function makeUser(role = 'member'): Promise<Viewer> {
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

const TITLE = 'Un budget national lisible par tous'
const SUMMARY =
  'Pourquoi le budget doit être publié sous une forme que chacun peut vérifier.'
const RATIONALE = 'Le diagnostic tient et les indicateurs sont vérifiables.'
// Each field clears the circle's 60-character floor, as a real submission must.
const DOCUMENTATION: Documentation = {
  diagnosis:
    'Le budget national est publié en entier, mais sous une forme que personne ne peut lire ni vérifier.',
  solutions:
    'Une synthèse par ministère, avec les montants votés, les montants dépensés et leur évolution sur trois ans.',
  resources:
    'Deux membres du Cercle Économie à mi-temps pendant un trimestre, et l’accès aux documents officiels.',
  risks:
    'Le principal risque est de publier un chiffre faux et de perdre la crédibilité que la proposition cherche.',
  indicators:
    'Le nombre de ministères couverts par la synthèse, publié chaque trimestre et vérifiable par tous.',
}
const LABELS = { unchanged: (n: number) => `${n} inchangés`, reformatted: '(forme)' }

const body = (...paragraphs: Array<string>) => ({
  type: 'doc',
  content: paragraphs.map((text) => ({
    type: 'paragraph',
    content: [{ type: 'text', text }],
  })),
})

type People = { author: Viewer; senior: Viewer; members: Array<Viewer> }

async function people(): Promise<People> {
  return {
    author: await makeUser(),
    senior: await makeUser('senior_member'),
    members: [await makeUser(), await makeUser(), await makeUser()],
  }
}

async function start(author: Viewer) {
  const created = await articles.createArticle({
    author,
    lang: 'fr',
    title: TITLE,
    summary: SUMMARY,
  })
  if (!created.ok) throw new Error(created.code)
  return created.value
}

async function write(
  author: Viewer,
  articleId: string,
  paragraphs: Array<string>,
  lang = 'fr',
) {
  const saved = await articles.saveTranslation({
    actor: author,
    articleId,
    lang,
    title: TITLE,
    summary: SUMMARY,
    content: body(...paragraphs),
  })
  if (!saved.ok) throw new Error(saved.code)
}

async function submit(author: Viewer, articleId: string, langs = ['fr']) {
  const result = await review.submitForReview({
    actor: author,
    articleId,
    langs,
    documentation: DOCUMENTATION,
  })
  if (!result.ok) throw new Error(`submit: ${result.code}`)
  return result.value.submissionId
}

async function decide(
  { senior, members }: People,
  submissionId: string,
  verdict: 'support' | 'object',
  langs = ['fr'],
) {
  for (const [i, member] of members.entries()) {
    await review.assignReviewer({
      actor: senior,
      submissionId,
      userId: member.id,
      stance: i === 0 ? 'contradictor' : 'reviewer',
    })
  }
  await review.openDeliberation({ actor: senior, submissionId })
  for (const lang of langs) {
    for (const member of members) {
      const said = await review.recordVerdict({
        actor: member,
        submissionId,
        lang,
        verdict,
        rationale: RATIONALE,
      })
      if (!said.ok) throw new Error(`verdict: ${said.code}`)
    }
  }
  const decided = await review.decide({
    actor: senior,
    submissionId,
    rationale: RATIONALE,
    unresolved: 'rejected',
  })
  if (!decided.ok) throw new Error(`decide: ${decided.code}`)
}

async function numbers(articleId: string, lang = 'fr') {
  const rows = await harness.db
    .select({
      number: schema.articleVersion.number,
      outcome: schema.articleVersion.outcome,
    })
    .from(schema.articleVersion)
    .where(eq(schema.articleVersion.articleId, articleId))
  return rows
    .filter((row) => row !== undefined)
    .sort((a, b) => a.number - b.number)
    .map((row) => `${lang}${row.number}:${row.outcome}`)
}

/**
 * The story most of these tests share: version 1 approved, version 2 refused,
 * version 3 approved — each with a sentence of its own, so a comparison can be
 * checked for the text it must and must not contain.
 */
async function threeVersions() {
  const circle = await people()
  const { articleId, slug } = await start(circle.author)
  await write(circle.author, articleId, ['Le texte approuvé en premier.'])
  await decide(circle, await submit(circle.author, articleId), 'support')

  await write(circle.author, articleId, ['Une version que le cercle a refusée.'])
  await decide(circle, await submit(circle.author, articleId), 'object')

  await write(circle.author, articleId, ['Le texte approuvé ensuite.'])
  const third = await submit(circle.author, articleId)
  await decide(circle, third, 'support')
  return { ...circle, articleId, slug, third }
}

describe('numbering', () => {
  it('numbers each submission of a language, whatever became of it', async () => {
    const { articleId } = await threeVersions()
    expect(await numbers(articleId)).toEqual([
      'fr1:approved',
      'fr2:refused',
      'fr3:approved',
    ])
  })

  it('numbers each language on its own', async () => {
    const circle = await people()
    const { articleId } = await start(circle.author)
    await write(circle.author, articleId, ['Le texte.'])
    await write(circle.author, articleId, ['Tèks la.'], 'ht')
    await decide(
      circle,
      await submit(circle.author, articleId, ['fr', 'ht']),
      'support',
      ['fr', 'ht'],
    )
    await write(circle.author, articleId, ['Le texte, revu.'])
    await decide(circle, await submit(circle.author, articleId, ['fr']), 'support')

    const rows = await harness.db
      .select({ lang: schema.articleVersion.lang, number: schema.articleVersion.number })
      .from(schema.articleVersion)
      .where(eq(schema.articleVersion.articleId, articleId))
    const of = (lang: string) =>
      rows
        .filter((row) => row.lang === lang)
        .map((row) => row.number)
        .sort()
    expect(of('fr')).toEqual([1, 2])
    expect(of('ht')).toEqual([1])
  })

  /** A number given out stays given out: the history has no gap nobody can explain. */
  it('keeps the number of a version whose round was withdrawn', async () => {
    const circle = await people()
    const { articleId } = await start(circle.author)
    await write(circle.author, articleId, ['Le texte.'])
    const first = await submit(circle.author, articleId)
    await review.withdrawSubmission({ actor: circle.author, submissionId: first })
    await submit(circle.author, articleId)

    expect(await numbers(articleId)).toEqual(['fr1:withdrawn', 'fr2:pending'])
  })
})

describe('the published version', () => {
  it('is the highest approved version', async () => {
    const { slug } = await threeVersions()
    const read = await articles.getReadableArticle({ slug, lang: 'fr', viewer: null })
    if (!read.ok) throw new Error(read.code)
    expect(read.value.version).toBe(3)
    expect(read.value.html).toContain('Le texte approuvé ensuite.')
  })

  it('stays the last approved version when a later one is refused', async () => {
    const circle = await people()
    const { articleId, slug } = await start(circle.author)
    await write(circle.author, articleId, ['Le texte approuvé.'])
    await decide(circle, await submit(circle.author, articleId), 'support')
    await write(circle.author, articleId, ['La version refusée.'])
    await decide(circle, await submit(circle.author, articleId), 'object')

    const read = await articles.getReadableArticle({ slug, lang: 'fr', viewer: null })
    if (!read.ok) throw new Error(read.code)
    expect(read.value.version).toBe(1)
    expect(read.value.html).not.toContain('refusée')
  })

  it('tells readers which version they are reading, and where its history is', async () => {
    const { slug } = await threeVersions()
    const read = await articles.getReadableArticle({ slug, lang: 'fr', viewer: null })
    if (!read.ok) throw new Error(read.code)
    expect(read.value.html).toMatch(
      /<p class="article-version">Version 3 · approuvée le /,
    )
    expect(read.value.html).toContain(`href="/fr/articles/${slug}/versions"`)
  })
})

describe('what the circle compares', () => {
  /**
   * Against the previous version whatever became of it: the contradictor of
   * round 3 needs to see what changed since the version they refused.
   */
  it('compares a version with the one before it, even a refused one', async () => {
    const { articleId, third } = await threeVersions()
    const [round] = await versions.roundLanguages(
      { id: third, articleId, langs: ['fr'] },
      LABELS,
    )
    expect(round.number).toBe(3)
    expect(round.comparison.previous).toEqual({ number: 2, outcome: 'refused' })
    expect(round.comparison.body.html).toContain('refusée')
    expect(round.comparison.body.html).toContain('ensuite')
  })

  it('has nothing to compare for a first version', async () => {
    const circle = await people()
    const { articleId } = await start(circle.author)
    await write(circle.author, articleId, ['Le texte.'])
    const first = await submit(circle.author, articleId)
    const [round] = await versions.roundLanguages(
      { id: first, articleId, langs: ['fr'] },
      LABELS,
    )
    expect(round.comparison.previous).toBeNull()
    expect(round.comparison.body.changed).toBe(false)
  })

  it('says whether the PDF changed', async () => {
    const circle = await people()
    const { articleId } = await start(circle.author)
    await write(circle.author, articleId, ['Le texte.'])
    const doc = await PDFDocument.create()
    doc.addPage([300, 300])
    const attached = await companion.attachCompanion({
      actor: circle.author,
      articleId,
      lang: 'fr',
      file: new File([new Uint8Array(await doc.save())], 'budget.pdf'),
    })
    if (!attached.ok) throw new Error(attached.code)
    await decide(circle, await submit(circle.author, articleId), 'support')

    await write(circle.author, articleId, ['Le texte, revu, sans PDF à jour.'])
    const second = await submit(circle.author, articleId)
    const [round] = await versions.roundLanguages(
      { id: second, articleId, langs: ['fr'] },
      LABELS,
    )
    expect(round.comparison.pdf).toBe('removed')
  })
})

describe('what readers are shown', () => {
  it('lists approved versions only, newest first', async () => {
    const { slug } = await threeVersions()
    const history = await versions.readerHistory({
      slug,
      lang: 'fr',
      viewer: null,
      labels: LABELS,
    })
    if (!history.ok) throw new Error(history.code)
    expect(history.value.entries.map((entry) => entry.number)).toEqual([3, 1])
  })

  /**
   * The property this page exists under: the refused version's text was never
   * published, and a comparison against it would publish it as the removed side
   * of a change. Readers compare approved with approved.
   */
  it('compares each approved version with the previous approved one, never with a refused one', async () => {
    const { slug } = await threeVersions()
    const history = await versions.readerHistory({
      slug,
      lang: 'fr',
      viewer: null,
      labels: LABELS,
    })
    if (!history.ok) throw new Error(history.code)
    const [latest, first] = history.value.entries
    expect(latest.comparison.previous?.number).toBe(1)
    expect(latest.comparison.body.html).toContain('en premier')
    expect(latest.comparison.body.html).not.toContain('refusée')
    expect(JSON.stringify(history.value)).not.toContain('refusée')
    expect(first.comparison.previous).toBeNull()
  })

  it('refuses the history of a members-only article to an anonymous reader', async () => {
    const { articleId, slug } = await threeVersions()
    await harness.db
      .update(schema.article)
      .set({ visibility: 'members' })
      .where(eq(schema.article.id, articleId))
    expect(
      await versions.readerHistory({ slug, lang: 'fr', viewer: null, labels: LABELS }),
    ).toEqual({ ok: false, code: 'FORBIDDEN' })
  })
})
