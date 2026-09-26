import { expect, type Page, test } from '@playwright/test'
import { PDFDocument, PDFName, PDFString } from 'pdf-lib'
import { ACCOUNTS, signIn, waitForInteractive } from './helpers'

/**
 * The companion PDF, from the author's editor to a reader's download (D26).
 *
 * One test, deliberately, walking the whole life of a companion: refused when
 * it can act, attached and cleaned, offered on the reading view, served as an
 * attachment, retired by the next save, removed. Splitting it would multiply
 * the sign-ins, and chromium-only for the same reason as the other signed-in
 * suites: our own per-IP throttle buckets every local caller together.
 *
 * It uses the French-only seeded article and saves its text *unchanged*. A save
 * writes a new revision whatever it contains — which is exactly what retires a
 * companion — and leaves the page other specs read identical.
 *
 * Skipped unless E2E_DATABASE is set. Run `npm run db:seed:demo` first.
 */
test.skip(!process.env.E2E_DATABASE, 'requires E2E_DATABASE and seeded accounts')

const SLUG = 'leducation-comme-priorite'

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

test('an author attaches a PDF, readers get it, and the next save takes it away', async ({
  page,
}) => {
  await signIn(page, ACCOUNTS.confirmed)
  await openEditor(page)
  const panel = page.getByTestId('companion')

  // Refused, and said why: a PDF that runs code on open is not offered to anyone.
  await upload(page, await pdf({ script: true }))
  await expect(panel.getByText(/éléments actifs/i)).toBeVisible({ timeout: 15_000 })

  // Attached, and the author is told what was taken out of their file.
  await upload(page, await pdf())
  await expect(panel.getByText(/Proposé aux lecteurs : 2 pages/i)).toBeVisible({
    timeout: 15_000,
  })
  await expect(panel.getByText(/propriétés du document/i)).toBeVisible()

  // The reading view links it, with its size, as plain markup.
  await page.goto(`/fr/articles/${SLUG}`)
  const link = page.getByRole('link', { name: /Télécharger le PDF/i })
  await expect(link).toBeVisible()
  await expect(page.getByText(/2 pages · 0,1 Mo/)).toBeVisible()
  const href = await link.getAttribute('href')
  expect(href).toBe(`/api/companion/${SLUG}/fr`)

  // Clicked, the way a reader gets it: the browser must treat it as a download
  // and name the file. (Opening the same URL as a page is covered by
  // `api-routes.spec.ts`; the `download` attribute means a click is not sent as
  // a page navigation, so this click alone would not have caught that bug.)
  const [download] = await Promise.all([page.waitForEvent('download'), link.click()])
  expect(download.suggestedFilename()).toBe(`${SLUG}-fr.pdf`)
  expect(await download.failure()).toBeNull()

  // Served as an attachment, never inline, and without the author's name in it.
  const response = await page.request.get(href as string)
  expect(response.status()).toBe(200)
  expect(response.headers()['content-disposition']).toMatch(/^attachment;/)
  expect(response.headers()['x-content-type-options']).toBe('nosniff')
  const served = await PDFDocument.load(await response.body(), { updateMetadata: false })
  expect(served.getAuthor()).toBeUndefined()
  expect(served.getTitle()).toBe("L'éducation comme priorité vérifiable")

  // Asked again with the hash it already has, the reader downloads nothing.
  const etag = response.headers().etag
  const again = await page.request.get(href as string, {
    headers: { 'if-none-match': etag },
  })
  expect(again.status()).toBe(304)

  // The author saves — the same text, but a new revision — and the PDF no longer
  // describes the text readers see. The editor says so.
  await openEditor(page)
  await page.getByRole('button', { name: /^Enregistrer$/i }).click()
  await expect(page.getByText(/Enregistré à/i)).toBeVisible({ timeout: 15_000 })
  await expect(panel.getByText(/n'est plus proposé aux lecteurs/i)).toBeVisible({
    timeout: 15_000,
  })

  // And readers no longer get it, by the link or by the URL.
  await page.goto(`/fr/articles/${SLUG}`)
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
  await expect(page.getByRole('link', { name: /Télécharger le PDF/i })).toHaveCount(0)
  expect((await page.request.get(href as string)).status()).toBe(404)

  // Removed, so the next run starts from nothing even without a re-seed.
  await openEditor(page)
  await panel.getByRole('button', { name: /Retirer le PDF/i }).click()
  await expect(panel.getByRole('button', { name: /Joindre le PDF/i })).toBeVisible({
    timeout: 15_000,
  })
})
