import { randomUUID } from 'node:crypto'
import { eq, sql } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { startTestDatabase, type TestDatabase } from '../../test/postgres'

/**
 * Data migrations, run against data — in the shape it had before them.
 *
 * The harness normally applies every migration to an empty database, which
 * proves the schema changes apply and proves nothing about an `UPDATE` or an
 * `INSERT … SELECT` that fills something in: against no rows it does nothing,
 * right or wrong. Each test here stops the schema just *before* the migration it
 * tests, puts in rows the way they looked then, applies the migration, and
 * checks what came out. Tables whose shape has changed since are written with
 * raw SQL, because the Drizzle schema describes them as they are now.
 *
 * These migrations decide what every reader sees the moment they run: a wrong
 * backfill here takes every published article off the site.
 */

let schema: typeof import('./schema')

beforeAll(async () => {
  schema = await import('./schema')
})

const doc = (text: string) =>
  JSON.stringify({
    type: 'doc',
    content: [{ type: 'paragraph', content: [{ type: 'text', text }] }],
  })

const DOCUMENTATION = `'d', 's', 'r', 'r', 'i'`

async function author(harness: TestDatabase): Promise<string> {
  const id = randomUUID()
  await harness.db.insert(schema.user).values({
    id,
    name: 'Auteur',
    email: `${id}@kleayiti.test`,
    emailVerified: true,
    role: 'member',
    memberStatus: 'active',
  })
  return id
}

async function anArticle(
  harness: TestDatabase,
  authorId: string,
  status: 'published' | 'in_review',
): Promise<string> {
  const id = randomUUID()
  await harness.db
    .insert(schema.article)
    .values({ id, slug: `a-${id.slice(0, 8)}`, authorId, status })
  return id
}

/** Revisions `ancien` then `actuel`, a day apart; returns their ids in order. */
async function twoRevisions(
  harness: TestDatabase,
  articleId: string,
  authorId: string,
): Promise<[string, string]> {
  const ids: Array<string> = []
  for (const [n, text] of ['ancien', 'actuel'].entries()) {
    const id = randomUUID()
    await harness.db.insert(schema.articleRevision).values({
      id,
      articleId,
      lang: 'fr',
      title: text,
      summary: text,
      contentJson: JSON.parse(doc(text)),
      createdBy: authorId,
      createdAt: new Date(Date.UTC(2026, 0, 1 + n)),
    })
    ids.push(id)
  }
  return ids as [string, string]
}

const raw = (harness: TestDatabase, statement: string) =>
  harness.db.execute(sql.raw(statement))

describe('0011_protected_text', () => {
  let harness: TestDatabase

  beforeAll(async () => {
    harness = await startTestDatabase({ upTo: '0010_companion_review' })
  })
  afterAll(async () => {
    await harness?.stop()
  })

  it('pins what readers were seeing, and snapshots what open rounds were reading', async () => {
    const authorId = await author(harness)
    const live = await anArticle(harness, authorId, 'published')
    const inReview = await anArticle(harness, authorId, 'in_review')
    const [, liveNewest] = await twoRevisions(harness, live, authorId)
    const [, reviewNewest] = await twoRevisions(harness, inReview, authorId)

    await raw(
      harness,
      `INSERT INTO article_translation (article_id, lang, title, summary, content_json, status)
       VALUES ('${live}', 'fr', 'actuel', 'actuel', '${doc('actuel')}', 'published'),
              ('${inReview}', 'fr', 'actuel', 'actuel', '${doc('actuel')}', 'draft')`,
    )
    const openRound = randomUUID()
    const decidedRound = randomUUID()
    await raw(
      harness,
      `INSERT INTO article_submission (id, article_id, langs, status, diagnosis, solutions, resources, risks, indicators)
       VALUES ('${openRound}', '${inReview}', '["fr"]', 'in_review', ${DOCUMENTATION}),
              ('${decidedRound}', '${live}', '["fr"]', 'decided', ${DOCUMENTATION})`,
    )

    await harness.migrateTo('0011_protected_text')

    const translations = await raw(
      harness,
      `SELECT article_id, published_revision_id FROM article_translation`,
    )
    const pin = (id: string) =>
      (translations as unknown as Array<Record<string, string | null>>).find(
        (row) => row.article_id === id,
      )?.published_revision_id
    expect(pin(live)).toBe(liveNewest)
    expect(pin(inReview)).toBeNull()

    const rounds = (await raw(
      harness,
      `SELECT id, revision_ids FROM article_submission`,
    )) as unknown as Array<{ id: string; revision_ids: Record<string, string> | null }>
    expect(rounds.find((r) => r.id === openRound)?.revision_ids).toEqual({
      fr: reviewNewest,
    })
    // Decided rounds are history: nothing is invented for them.
    expect(rounds.find((r) => r.id === decidedRound)?.revision_ids).toBeNull()
  })
})

describe('0012_article_versions and 0013_versions_replace_pins', () => {
  let harness: TestDatabase

  beforeAll(async () => {
    harness = await startTestDatabase({ upTo: '0011_protected_text' })
  })
  afterAll(async () => {
    await harness?.stop()
  })

  it('turns every live language into version 1 and every open round into the next version', async () => {
    const authorId = await author(harness)

    // A live article, published at `actuel` by a decided round, with the PDF
    // that round approved.
    const live = await anArticle(harness, authorId, 'published')
    const [, liveText] = await twoRevisions(harness, live, authorId)
    const decided = randomUUID()
    const livePdf = randomUUID()
    await raw(
      harness,
      `INSERT INTO article_submission (id, article_id, langs, revision_ids, status, submitted_at, diagnosis, solutions, resources, risks, indicators)
       VALUES ('${decided}', '${live}', '["fr"]', '{"fr":"${liveText}"}', 'decided', '2026-01-03', ${DOCUMENTATION})`,
    )
    await raw(
      harness,
      `INSERT INTO article_translation (article_id, lang, title, summary, content_json, status, published_at, published_revision_id)
       VALUES ('${live}', 'fr', 'actuel', 'actuel', '${doc('actuel')}', 'published', '2026-01-04', '${liveText}')`,
    )
    await raw(
      harness,
      `INSERT INTO article_companion (id, article_id, lang, revision_id, storage_path, byte_size, page_count, sha256, uploaded_at, approved_in_submission_id, approved_at)
       VALUES ('${livePdf}', '${live}', 'fr', '${liveText}', 'companions/x.pdf', 10, 2, 'aa', '2026-01-02', '${decided}', '2026-01-04')`,
    )

    // An article in review, with the PDF the round had from the start.
    const inReview = await anArticle(harness, authorId, 'in_review')
    const [, reviewText] = await twoRevisions(harness, inReview, authorId)
    const open = randomUUID()
    const reviewPdf = randomUUID()
    await raw(
      harness,
      `INSERT INTO article_translation (article_id, lang, title, summary, content_json, status)
       VALUES ('${inReview}', 'fr', 'actuel', 'actuel', '${doc('actuel')}', 'draft')`,
    )
    await raw(
      harness,
      `INSERT INTO article_companion (id, article_id, lang, revision_id, storage_path, byte_size, page_count, sha256, uploaded_at)
       VALUES ('${reviewPdf}', '${inReview}', 'fr', '${reviewText}', 'companions/y.pdf', 10, 3, 'bb', '2026-01-02')`,
    )
    await raw(
      harness,
      `INSERT INTO article_submission (id, article_id, langs, revision_ids, status, submitted_at, diagnosis, solutions, resources, risks, indicators)
       VALUES ('${open}', '${inReview}', '["fr"]', '{"fr":"${reviewText}"}', 'in_review', '2026-01-05', ${DOCUMENTATION})`,
    )

    await harness.migrateTo()

    const versions = await harness.db.select().from(schema.articleVersion)
    const liveVersion = versions.find((v) => v.articleId === live)
    expect(liveVersion).toMatchObject({
      number: 1,
      outcome: 'approved',
      submissionId: decided,
      revisionId: liveText,
      companionId: livePdf,
    })
    const [liveTranslation] = await harness.db
      .select()
      .from(schema.articleTranslation)
      .where(eq(schema.articleTranslation.articleId, live))
    expect(liveTranslation.publishedVersionId).toBe(liveVersion?.id)

    expect(versions.find((v) => v.articleId === inReview)).toMatchObject({
      number: 1,
      outcome: 'pending',
      submissionId: open,
      revisionId: reviewText,
      companionId: reviewPdf,
    })
    expect(versions).toHaveLength(2)
  })
})
