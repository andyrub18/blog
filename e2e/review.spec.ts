import { expect, test } from '@playwright/test'
import { ACCOUNTS, signIn, submitApplication } from './helpers'

/**
 * The review flow against a real database.
 *
 * Skipped unless E2E_DATABASE is set, so the suite stays green in CI without
 * Postgres. Run `npm run db:seed:demo` against the same database first.
 */
test.skip(!process.env.E2E_DATABASE, 'requires E2E_DATABASE and seeded accounts')

/**
 * Each test owns its account.
 *
 * The flow is stateful — an approved application leaves the queue, and a reader
 * with an open application can no longer see the form — so sharing one account
 * across tests makes them pass or fail on the order they happened to run in.
 */
test('a reader can file a membership application', async ({ page }) => {
  await signIn(page, ACCOUNTS.newcomer)
  await submitApplication(page)
})

test('a senior member reviews a dossier and approves it', async ({ page }) => {
  await signIn(page, ACCOUNTS.senior)
  await page.goto('/fr/review')
  await expect(page.getByText(ACCOUNTS.applicant)).toBeVisible()

  await page
    .getByRole('listitem')
    .filter({ hasText: ACCOUNTS.applicant })
    .getByRole('link', { name: /Examiner/i })
    .click()
  await expect(page.getByText(/Plan de contribution/i)).toBeVisible()

  // The dossier is downloadable, and only as an attachment.
  const href = await page
    .getByRole('link', { name: /Télécharger le CV/i })
    .getAttribute('href')
  const file = await page.request.get(href as string)
  expect(file.status()).toBe(200)
  expect(file.headers()['content-type']).toContain('application/pdf')
  // A PDF rendered inline can carry active content.
  expect(file.headers()['content-disposition']).toContain('attachment')
  expect(file.headers()['x-content-type-options']).toBe('nosniff')
  expect(file.headers()['cache-control']).toContain('no-store')

  // A decision with no written reason is refused.
  await page.getByRole('button', { name: /^Approuver$/i }).click()
  await expect(page.getByText(/motif est trop court/i)).toBeVisible()

  await page
    .getByRole('textbox')
    .fill('Dossier complet, plan de contribution concret et verifiable.')
  await page.getByRole('button', { name: /^Approuver$/i }).click()
  await expect(page.getByText(/Décision enregistrée/i)).toBeVisible()

  // Approved applications leave the queue.
  await page.goto('/fr/review')
  await expect(page.getByText(ACCOUNTS.applicant)).not.toBeVisible()
})

test.describe('reader', () => {
  test('is offered the membership application', async ({ page }) => {
    await signIn(page, ACCOUNTS.reader)
    await expect(page.getByRole('link', { name: /Devenir membre/i })).toBeVisible()
  })

  test('can reach the application form and is asked for the dossier', async ({
    page,
  }) => {
    await signIn(page, ACCOUNTS.reader)
    await page.getByRole('link', { name: /Devenir membre/i }).click()
    await expect(page).toHaveURL(/\/fr\/apply\/?$/)
    await expect(page.locator('[name="cv"]')).toBeVisible()
    await expect(page.locator('[name="vision"]')).toBeVisible()
    await expect(page.locator('[name="contribution"]')).toBeVisible()
    await expect(page.locator('[name="contributionPlan"]')).toBeVisible()
  })

  /** Authorisation, not just a hidden link: the URL must refuse them too. */
  test('cannot reach the review queue', async ({ page }) => {
    await signIn(page, ACCOUNTS.reader)
    await page.goto('/fr/review')
    await expect(page.getByText(/File d'examen/i)).not.toBeVisible()
  })

  test('cannot download a dossier directly', async ({ page }) => {
    await signIn(page, ACCOUNTS.reader)
    // maxRedirects: 0 on purpose — following a refusal to the home page would
    // report 200 and hide the fact that access was denied.
    const response = await page.request.get('/api/dossier/any-id/cv', {
      maxRedirects: 0,
    })
    expect(response.status()).toBe(403)
    expect(response.headers()['content-type'] ?? '').not.toContain('application/pdf')
  })
})
