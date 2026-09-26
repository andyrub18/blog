import { expect, type Page, test } from '@playwright/test'
import { PDFDocument, PDFName, PDFString } from 'pdf-lib'
import { ACCOUNTS, signIn, waitForInteractive } from './helpers'

/**
 * The companion PDF, from the author's editor through the circle to a reader
 * (D26, D29).
 *
 * Two tests, one per side, each walking its whole half in a single sign-in —
 * chromium-only for the same reason as the other signed-in suites: our own
 * per-IP throttle buckets every local caller together.
 *
 * **The author's side** uses the French-only published article. Attaching a PDF
 * to it must *not* reach readers — the circle has not read it — and a save
 * (of the same text: a save writes a revision whatever it contains, and leaves
 * the page other specs read identical) makes it stale.
 *
 * **The circle's side** uses a seeded round in debate whose PDF was attached
 * before submission. A senior member downloads it from the submission page,
 * decides, and readers then get exactly that file.
 *
 * Skipped unless E2E_DATABASE is set. Run `npm run db:seed:demo` first.
 */
test.skip(!process.env.E2E_DATABASE, 'requires E2E_DATABASE and seeded accounts')

const LIVE = 'leducation-comme-priorite'
const IN_DEBATE = 'pwopozisyon-ak-pdf'

async function pdf(options: { script?: boolean } = {}): Promise<Buffer> {
  const doc = await PDFDocument.create()
  doc.addPage([300, 300])
  doc.addPage([300, 300])
  doc.setAuthor('Jean-E2E-Author')
  if (options.script) {
    doc.catalog.set(
      PDFName.of('OpenAction'),
      doc.context.obj({ S: 'JavaScript', JS: PDFString.of('app.alert(1)') }),
    )
  }
  return Buffer.from(await doc.save())
}

async function openEditor(page: Page) {
  await page.goto('/fr/write')
  await waitForInteractive(page)
  await page
    .getByRole('listitem')
    .filter({ hasText: /L'éducation comme priorité vérifiable/i })
    .getByRole('link', { name: /^Ouvrir$/i })
    .click()
  await page.locator('.ProseMirror').waitFor({ timeout: 30_000 })
  await waitForInteractive(page)
}

async function upload(page: Page, bytes: Buffer) {
  const panel = page.getByTestId('companion')
  await panel.locator('input[type="file"]').setInputFiles({
    name: 'education.pdf',
    mimeType: 'application/pdf',
    buffer: bytes,
  })
  await panel.getByRole('button', { name: /(Joindre|Remplacer) le PDF/i }).click()
}

test('an author’s PDF waits for the circle, and a save makes it stale', async ({
  page,
}) => {
  await signIn(page, ACCOUNTS.confirmed)
  await openEditor(page)
  const panel = page.getByTestId('companion')

  // Refused, and said why: a PDF that runs code on open is not offered to anyone.
  await upload(page, await pdf({ script: true }))
  await expect(panel.getByText(/éléments actifs/i)).toBeVisible({ timeout: 15_000 })

  // Attached and cleaned — and waiting for the circle, not on the site.
  await upload(page, await pdf())
  await expect(
    panel.getByText(/examinera avec le texte quand vous soumettrez/i),
  ).toBeVisible({
    timeout: 15_000,
  })
  await expect(panel.getByText(/propriétés du document/i)).toBeVisible()

  // Readers get nothing: not the link, not the file by URL.
  await page.goto(`/fr/articles/${LIVE}`)
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
  await expect(page.getByRole('link', { name: /Télécharger le PDF/i })).toHaveCount(0)
  expect((await page.request.get(`/api/companion/${LIVE}/fr`)).status()).toBe(404)

  // A save — the same text, a new revision — and the PDF no longer describes it.
  await openEditor(page)
  await page.getByRole('button', { name: /^Enregistrer$/i }).click()
  await expect(page.getByText(/Enregistré à/i)).toBeVisible({ timeout: 15_000 })
  await expect(panel.getByText(/ne correspond plus au texte/i)).toBeVisible({
    timeout: 15_000,
  })

  // Removed, so the next run starts from nothing even without a re-seed.
  await panel.getByRole('button', { name: /Retirer le PDF/i }).click()
  await expect(panel.getByRole('button', { name: /Joindre le PDF/i })).toBeVisible({
    timeout: 15_000,
  })
})

test('the circle reads the PDF with the text, and readers get the file it approved', async ({
  page,
  browser,
}) => {
  await signIn(page, ACCOUNTS.senior)
  await page.goto('/fr/review/articles')
  await waitForInteractive(page)
  await page
    .getByRole('listitem')
    .filter({ hasText: /budget national lisible/i })
    .getByRole('link', { name: /^Ouvrir$/i })
    .click()

  // The reviewer is shown the PDF under review, and can take it home to check.
  const section = page.getByTestId('review-companion')
  await expect(section.getByText(/Français : 4 pages/i)).toBeVisible({ timeout: 15_000 })
  const [reviewCopy] = await Promise.all([
    page.waitForEvent('download'),
    section.getByRole('link', { name: /^Télécharger$/i }).click(),
  ])
  expect(await reviewCopy.failure()).toBeNull()

  // Nobody outside the circle can fetch the file under review.
  const anonymous = await browser.newContext()
  try {
    const reviewHref = await section
      .getByRole('link', { name: /^Télécharger$/i })
      .getAttribute('href')
    const refused = await anonymous.request.get(
      new URL(reviewHref as string, page.url()).href,
    )
    expect(refused.status()).toBe(403)
  } finally {
    await anonymous.close()
  }

  await page
    .locator('[name="decisionRationale"]')
    .fill('Le diagnostic tient, et le PDF dit ce que dit le texte.')
  await page.getByRole('button', { name: /Enregistrer la décision/i }).click()
  await expect(page.getByText(/Acceptée/i).first()).toBeVisible({ timeout: 15_000 })
  await expect(section.getByText(/approuvé par cette décision/i)).toBeVisible()

  // A reader with no account now gets the link, and the approved file.
  const visitorContext = await browser.newContext()
  try {
    const visitor = await visitorContext.newPage()
    await visitor.goto(`/fr/articles/${IN_DEBATE}`)
    const link = visitor.getByRole('link', { name: /Télécharger le PDF/i })
    await expect(link).toBeVisible()
    await expect(visitor.getByText(/4 pages · 0,1 Mo/)).toBeVisible()

    const [download] = await Promise.all([visitor.waitForEvent('download'), link.click()])
    expect(download.suggestedFilename()).toBe(`${IN_DEBATE}-fr.pdf`)

    const response = await visitor.request.get(`/api/companion/${IN_DEBATE}/fr`)
    expect(response.status()).toBe(200)
    expect(response.headers()['content-disposition']).toMatch(/^attachment;/)
    expect(response.headers()['x-content-type-options']).toBe('nosniff')
    const served = await PDFDocument.load(await response.body(), {
      updateMetadata: false,
    })
    expect(served.getPageCount()).toBe(4)
    expect(served.getTitle()).toBe('Un budget national lisible par tous')

    const again = await visitor.request.get(`/api/companion/${IN_DEBATE}/fr`, {
      headers: { 'if-none-match': response.headers().etag },
    })
    expect(again.status()).toBe(304)
  } finally {
    await visitorContext.close()
  }
})
