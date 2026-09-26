import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { eq, sql } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { startTestDatabase, type TestDatabase } from '../test/postgres'

/**
 * Data migrations, run against data.
 *
 * The harness applies every migration to an empty database, which proves the
 * schema changes apply and proves nothing about an `UPDATE` that fills columns
 * in — it runs against no rows. `0011_protected_text` is such a migration, and
 * if it pinned the wrong revision, or none, every published article would drop
 * off the site the moment it ran (D30). So its backfill statements are run here,
 * verbatim from the file, against rows shaped the way they were before it.
 */

let harness: TestDatabase
let schema: typeof import('./db/schema')

beforeAll(async () => {
  harness = await startTestDatabase()
  process.env.DATABASE_URL = harness.url
  schema = await import('./db/schema')
})

afterAll(async () => {
  await harness?.stop()
})

/** The data statements of a migration: everything after its schema changes. */
async function backfillOf(file: string): Promise<Array<string>> {
  const text = await readFile(join(process.cwd(), 'drizzle', file), 'utf8')
  return text
    .split('--> statement-breakpoint')
    .map((statement) => statement.trim())
    .filter((statement) => /^(--[^\n]*\n)*UPDATE/i.test(statement))
}

const doc = (text: string) => ({
  type: 'doc',
  content: [{ type: 'paragraph', content: [{ type: 'text', text }] }],
})

describe('0011_protected_text', () => {
  it('pins what readers were seeing, and snapshots what open rounds were reading', async () => {
    const authorId = randomUUID()
    await harness.db.insert(schema.user).values({
      id: authorId,
      name: 'Auteur',
      email: `${authorId}@kleayiti.test`,
      emailVerified: true,
      role: 'member',
      memberStatus: 'active',
    })

    const live = randomUUID()
    const inReview = randomUUID()
    for (const [id, slug, status] of [
      [live, 'publie', 'published'],
      [inReview, 'en-examen', 'in_review'],
    ] as const) {
      await harness.db.insert(schema.article).values({ id, slug, authorId, status })
    }

    // Two revisions each, the newer one being the text as it stood.
    const newest: Record<string, string> = {}
    for (const articleId of [live, inReview]) {
      for (const [n, text] of ['ancien', 'actuel'].entries()) {
        const id = randomUUID()
        await harness.db.insert(schema.articleRevision).values({
          id,
          articleId,
          lang: 'fr',
          title: text,
          summary: text,
          contentJson: doc(text),
          createdBy: authorId,
          createdAt: new Date(Date.UTC(2026, 0, 1 + n)),
        })
        newest[articleId] = id
      }
    }
    await harness.db.insert(schema.articleTranslation).values([
      {
        articleId: live,
        lang: 'fr',
        title: 'actuel',
        summary: 'actuel',
        contentJson: doc('actuel'),
        status: 'published',
      },
      {
        articleId: inReview,
        lang: 'fr',
        title: 'actuel',
        summary: 'actuel',
        contentJson: doc('actuel'),
        status: 'draft',
      },
    ])
    const openRound = randomUUID()
    const decidedRound = randomUUID()
    const documentation = {
      diagnosis: 'd',
      solutions: 's',
      resources: 'r',
      risks: 'r',
      indicators: 'i',
    }
    await harness.db.insert(schema.articleSubmission).values([
      {
        id: openRound,
        articleId: inReview,
        langs: ['fr'],
        status: 'in_review',
        ...documentation,
      },
      {
        id: decidedRound,
        articleId: live,
        langs: ['fr'],
        status: 'decided',
        ...documentation,
      },
    ])

    const statements = await backfillOf('0011_protected_text.sql')
    expect(statements).toHaveLength(2)
    for (const statement of statements) await harness.db.execute(sql.raw(statement))

    const [published] = await harness.db
      .select()
      .from(schema.articleTranslation)
      .where(eq(schema.articleTranslation.articleId, live))
    expect(published.publishedRevisionId).toBe(newest[live])

    const [draft] = await harness.db
      .select()
      .from(schema.articleTranslation)
      .where(eq(schema.articleTranslation.articleId, inReview))
    expect(draft.publishedRevisionId).toBeNull()

    const rounds = await harness.db.select().from(schema.articleSubmission)
    expect(rounds.find((r) => r.id === openRound)?.revisionIds).toEqual({
      fr: newest[inReview],
    })
    // Decided rounds are history: nothing is invented for them.
    expect(rounds.find((r) => r.id === decidedRound)?.revisionIds).toBeNull()
  })
})
