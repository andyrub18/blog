import { expect, test } from '@playwright/test'
import { ACCOUNTS, signIn, waitForInteractive } from './helpers'

/**
 * Writing and publishing, against a real database.
 *
 * Separate from `articles.spec.ts` because these sign in, and the mobile project
 * ignores this file: running the same sign-ins twice is enough to trip our own
 * per-IP throttle, which buckets every local caller together when no proxy sets
 * `x-forwarded-for`.
 *
 * Skipped unless E2E_DATABASE is set. Run `npm run db:seed:demo` against the
 * same database first — it resets the demo articles, so the draft this suite
 * edits and the article it publishes do not carry into the next run.
 */
test.skip(!process.env.E2E_DATABASE, 'requires E2E_DATABASE and seeded accounts')

test('a member writes a draft, and cannot publish it themselves', async ({ page }) => {
  await signIn(page, ACCOUNTS.confirmed)
  await page.goto('/fr/write')
  await waitForInteractive(page)

  await page
    .getByRole('listitem')
    .filter({ hasText: /Note de travail du Cercle Économie/i })
    .getByRole('link', { name: /^Ouvrir$/i })
    .click()

  // The editor arrives in its own chunk, so wait for it rather than the page.
  const surface = page.locator('.ProseMirror')
  await surface.waitFor({ timeout: 30_000 })
  await surface.click()
  await page.keyboard.type('Un paragraphe ajouté par le test.')

  await page.getByRole('button', { name: /^Enregistrer$/i }).click()
  await expect(page.getByText(/Enregistré à/i)).toBeVisible({ timeout: 15_000 })

  // Nobody validates their own proposal, and since phase 3 nobody publishes one
  // with a button either. What the author gets is the way in to the circle.
  await expect(page.getByRole('button', { name: /Publier cette langue/i })).toHaveCount(0)
  await expect(page.getByRole('heading', { name: /Soumettre au cercle/i })).toBeVisible()
})

test('a senior member writes, and the article is not published by writing it', async ({
  page,
  browser,
}) => {
  const title = `Une proposition sur les transports ${Date.now()}`

  await signIn(page, ACCOUNTS.senior)
  await page.goto('/fr/write')
  await waitForInteractive(page)

  await page.locator('[name="title"]').fill(title)
  await page
    .locator('[name="summary"]')
    .fill(
      'Ce que le réseau de transport ne couvre pas, et les trois questions que ' +
        'le cercle propose de poser avant le prochain exercice.',
    )
  await page.getByRole('button', { name: /Créer le brouillon/i }).click()

  const surface = page.locator('.ProseMirror')
  await surface.waitFor({ timeout: 30_000 })
  await surface.click()
  await page.keyboard.type('Le premier constat porte sur la couverture réelle.')

  await page.getByRole('button', { name: /^Enregistrer$/i }).click()
  await expect(page.getByText(/Enregistré à/i)).toBeVisible({ timeout: 15_000 })

  // A senior member has no publish button either. Since phase 3 an article goes
  // up because the circle decided it does, and leaving one person able to skip
  // that would be a way around the whole deliberation.
  await expect(page.getByRole('button', { name: /Publier cette langue/i })).toHaveCount(0)
  await expect(page.getByRole('heading', { name: /Soumettre au cercle/i })).toBeVisible()

  // And nobody without an account can read it.
  const anonymous = await browser.newContext()
  try {
    const visitor = await anonymous.newPage()
    await visitor.goto('/fr/articles')
    await expect(visitor.getByRole('link', { name: title })).toHaveCount(0)
  } finally {
    await anonymous.close()
  }
})
