import { expect, test } from '@playwright/test'
import JSZip from 'jszip'
import { ACCOUNTS, signIn, waitForInteractive } from './helpers'

/**
 * Importing a Word file, through the form a member actually uses.
 *
 * Chromium only, like the other signed-in suites: doubling the sign-ins is
 * enough to trip our own per-IP throttle when no proxy sets `x-forwarded-for`.
 *
 * Skipped unless E2E_DATABASE is set. Run `npm run db:seed:demo` first.
 */
test.skip(!process.env.E2E_DATABASE, 'requires E2E_DATABASE and seeded accounts')

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

/** A real `.docx`, built here so the fixture says what it is testing. */
async function wordFile(body: string): Promise<Buffer> {
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
  return zip.generateAsync({ type: 'nodebuffer' })
}

/**
 * Open the seeded draft this suite owns.
 *
 * Its own, not one shared with the deliberation tests: the suite runs
 * `fullyParallel`, so a draft another spec submits mid-run would make this pass
 * or fail on which worker got there first.
 */
async function openDraft(page: import('@playwright/test').Page) {
  await page.goto('/fr/write')
  await waitForInteractive(page)
  await page
    .getByRole('listitem')
    .filter({ hasText: /Un brouillon prêt pour l'import/i })
    .getByRole('link', { name: /^Ouvrir$/i })
    .click()
  await page.locator('.ProseMirror').waitFor({ timeout: 30_000 })
}

test('a member imports a Word file and is told what survived it', async ({ page }) => {
  await signIn(page, ACCOUNTS.confirmed)
  await openDraft(page)

  await expect(
    page.getByRole('heading', { name: /Importer un document Word/i }),
  ).toBeVisible()
  // The sentence that prevents the predictable complaint.
  await expect(page.getByText(/La mise en page ne l'est pas/i)).toBeVisible()

  const file = await wordFile(
    `<w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>Diagnostic</w:t></w:r></w:p>` +
      para('Le premier constat porte sur les recettes déclarées.') +
      `<w:tbl><w:tr><w:tc>${para('Année')}</w:tc><w:tc>${para('Recettes')}</w:tc></w:tr>` +
      `<w:tr><w:tc>${para('2025')}</w:tc><w:tc>${para('inconnu')}</w:tc></w:tr></w:tbl>`,
  )

  await page.locator('[name="file"]').setInputFiles({
    name: 'budget.docx',
    mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    buffer: file,
  })
  await page.getByRole('button', { name: /^Importer$/i }).click()

  await expect(page.getByText(/Document importé/i)).toBeVisible({ timeout: 30_000 })
  // The report names what came through, by kind.
  await expect(page.getByText(/tableaux/i)).toBeVisible()
  await expect(page.getByText(/Rien n'a été soumis au cercle/i)).toBeVisible()

  // And the text is in the editor, table included.
  await expect(page.locator('.ProseMirror').getByText('Diagnostic')).toBeVisible()
  await expect(page.locator('.ProseMirror table')).toBeVisible()
})

test('a file that is not a Word document is refused', async ({ page }) => {
  await signIn(page, ACCOUNTS.confirmed)
  await page.goto('/fr/write')
  await waitForInteractive(page)

  // A throwaway article of its own to import into, so nothing this test does
  // reaches the draft the test above is using.
  await page.locator('[name="title"]').fill(`Un import qui doit échouer ${Date.now()}`)
  await page
    .locator('[name="summary"]')
    .fill(
      'Un brouillon créé uniquement pour vérifier que le mauvais fichier est refusé proprement.',
    )
  await page.getByRole('button', { name: /Créer le brouillon/i }).click()
  await page.locator('.ProseMirror').waitFor({ timeout: 30_000 })

  // `file.type` is set by the client and is trivially spoofed, so claim to be a
  // Word file while being a PDF.
  await page.locator('[name="file"]').setInputFiles({
    name: 'article.docx',
    mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    buffer: Buffer.from('%PDF-1.4 not a word file at all'),
  })
  await page.getByRole('button', { name: /^Importer$/i }).click()

  await expect(page.getByText(/n'est pas un document Word/i)).toBeVisible({
    timeout: 20_000,
  })
})
