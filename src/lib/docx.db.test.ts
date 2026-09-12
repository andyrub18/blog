import { randomUUID } from 'node:crypto'
import { eq } from 'drizzle-orm'
import JSZip from 'jszip'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { startTestDatabase, type TestDatabase } from '../test/postgres'
import type { Viewer } from './articles'

/**
 * An imported Word file, all the way into the database and back out.
 *
 * The conversion itself is tested in `docx.test.ts`. What is tested here is the
 * part a mock would have agreed with whatever it did: that a document with a
 * nested table survives a round trip through a `jsonb` column and renders on
 * the other side, and that an import lands as a draft rather than putting
 * somebody's half-converted file in front of readers.
 */

let harness: TestDatabase
let articles: typeof import('./articles')
let docx: typeof import('./docx')
let prosemirror: typeof import('./prosemirror')
let schema: typeof import('./db/schema')

beforeAll(async () => {
  harness = await startTestDatabase()
  process.env.DATABASE_URL = harness.url
  articles = await import('./articles')
  docx = await import('./docx')
  prosemirror = await import('./prosemirror')
  schema = await import('./db/schema')
})

afterAll(async () => {
  await harness?.stop()
})

beforeEach(async () => {
  await harness.db.delete(schema.articleRevision)
  await harness.db.delete(schema.articleTranslation)
  await harness.db.delete(schema.article)
  await harness.db.delete(schema.user)
})

async function makeUser(role = 'member'): Promise<Viewer> {
  const id = randomUUID()
  await harness.db.insert(schema.user).values({
    id,
    name: role,
    email: `${id}@kle.ht`,
    emailVerified: true,
    role: role as 'member',
    memberStatus: 'active',
  })
  return { id, role: role as Viewer['role'], memberStatus: 'active' }
}

const CONTENT_TYPES = `<?xml version="1.0" encoding="UTF-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="xml" ContentType="application/xml"/>
</Types>`

const RELS = `<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1"
    Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument"
    Target="word/document.xml"/>
</Relationships>`

const para = (text: string) =>
  `<w:p><w:r><w:t xml:space="preserve">${text}</w:t></w:r></w:p>`

async function wordFile(body: string): Promise<File> {
  const zip = new JSZip()
  zip.file('[Content_Types].xml', CONTENT_TYPES)
  zip.file('_rels/.rels', RELS)
  zip.file(
    'word/document.xml',
    `<?xml version="1.0" encoding="UTF-8"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>${body}</w:body>
</w:document>`,
  )
  const bytes = await zip.generateAsync({ type: 'nodebuffer' })
  return new File([bytes as unknown as BlobPart], 'article.docx')
}

const TITLE = 'La situation économique en Haïti'
const SUMMARY = 'Un diagnostic de la crise et les réponses que le mouvement propose.'

describe('an imported document, stored', () => {
  it('survives a round trip through jsonb, table and all', async () => {
    const author = await makeUser()
    const created = await articles.createArticle({
      author,
      lang: 'fr',
      title: TITLE,
      summary: SUMMARY,
    })
    if (!created.ok) throw new Error(created.code)

    const converted = await docx.convertDocx(
      await wordFile(
        `<w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>Diagnostic</w:t></w:r></w:p>` +
          para('Le premier constat porte sur les recettes.') +
          `<w:tbl><w:tr><w:tc>${para('Année')}</w:tc><w:tc>${para('Recettes')}</w:tc></w:tr>` +
          `<w:tr><w:tc>${para('2025')}</w:tc><w:tc>${para('inconnu')}</w:tc></w:tr></w:tbl>`,
      ),
    )
    expect(converted.ok).toBe(true)
    if (!converted.ok) return

    const saved = await articles.saveTranslation({
      actor: author,
      articleId: created.value.articleId,
      lang: 'fr',
      title: TITLE,
      summary: SUMMARY,
      content: converted.doc,
    })
    expect(saved.ok).toBe(true)

    const [row] = await harness.db
      .select({
        content: schema.articleTranslation.contentJson,
        status: schema.articleTranslation.status,
      })
      .from(schema.articleTranslation)
      .where(eq(schema.articleTranslation.articleId, created.value.articleId))

    // Landed as a draft, never as a submission: the author reads the report and
    // fixes what the conversion lost before anybody else sees it.
    expect(row.status).toBe('draft')

    const parsed = prosemirror.parseDocument(row.content)
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    const html = prosemirror.renderDocumentToHtml(parsed.doc)
    expect(html).toContain('<h2>Diagnostic</h2>')
    expect(html).toContain('<div class="article-table">')
    expect(html).toContain('Année')
    expect(html).toContain('inconnu')
  })

  it('keeps the revision an import creates, like any other save', async () => {
    const author = await makeUser()
    const created = await articles.createArticle({
      author,
      lang: 'fr',
      title: TITLE,
      summary: SUMMARY,
    })
    if (!created.ok) throw new Error(created.code)

    const converted = await docx.convertDocx(await wordFile(para('Un premier jet.')))
    if (!converted.ok) throw new Error(converted.code)
    await articles.saveTranslation({
      actor: author,
      articleId: created.value.articleId,
      lang: 'fr',
      title: TITLE,
      summary: SUMMARY,
      content: converted.doc,
    })

    const revisions = await harness.db
      .select()
      .from(schema.articleRevision)
      .where(eq(schema.articleRevision.articleId, created.value.articleId))
    // An import is a save. Re-importing over a draft has to be undoable, and
    // the revision is the only thing that makes it so.
    expect(revisions).toHaveLength(1)
  })

  it('refuses to store a document the schema would not accept', async () => {
    const author = await makeUser()
    const created = await articles.createArticle({
      author,
      lang: 'fr',
      title: TITLE,
      summary: SUMMARY,
    })
    if (!created.ok) throw new Error(created.code)

    // A Word file with nothing but an image in it converts to nothing storable.
    const converted = await docx.convertDocx(await wordFile(''))
    expect(converted.ok).toBe(false)
    if (!converted.ok) expect(converted.code).toBe('EMPTY_DOCUMENT')

    const rows = await harness.db
      .select({ content: schema.articleTranslation.contentJson })
      .from(schema.articleTranslation)
      .where(eq(schema.articleTranslation.articleId, created.value.articleId))
    // The translation is still the empty one `createArticle` made.
    expect(prosemirror.parseDocument(rows[0].content).ok).toBe(false)
  })
})
