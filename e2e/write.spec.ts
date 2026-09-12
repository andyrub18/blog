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

  // Nobody validates their own proposal: the author gets the explanation, not
  // a button.
  await expect(page.getByRole('button', { name: /Publier cette langue/i })).toHaveCount(0)
  await expect(page.getByText(/membre sénior publie/i)).toBeVisible()
})

test('a senior member writes, publishes, and the article reaches an anonymous reader', async ({
  page,
  browser,
}) => {
  const title = `Le budget national et ses angles morts ${Date.now()}`

  await signIn(page, ACCOUNTS.senior)
  await page.goto('/fr/write')
  await waitForInteractive(page)

  await page.locator('[name="title"]').fill(title)
  await page
    .locator('[name="summary"]')
    .fill(
      'Ce que le budget publié ne dit pas, et les trois questions que le cercle ' +
        'propose de poser avant le prochain exercice.',
    )
  await page.getByRole('button', { name: /Créer le brouillon/i }).click()

  const surface = page.locator('.ProseMirror')
  await surface.waitFor({ timeout: 30_000 })
  await surface.click()
  await page.keyboard.type('Le premier constat porte sur les recettes déclarées.')

  await page.getByRole('button', { name: /^Enregistrer$/i }).click()
  await expect(page.getByText(/Enregistré à/i)).toBeVisible({ timeout: 15_000 })

  await page.getByRole('button', { name: /Publier cette langue/i }).click()
  await expect(page.getByRole('link', { name: /Voir l'article publié/i })).toBeVisible({
    timeout: 15_000,
  })

  // The point of publishing: somebody with no account, in a fresh browser
  // context with no cookies, can read it.
  const anonymous = await browser.newContext()
  try {
    const visitor = await anonymous.newPage()
    await visitor.goto('/fr/articles')
    await expect(visitor.getByRole('link', { name: title })).toBeVisible()
    await visitor.getByRole('link', { name: title }).click()
    await expect(
      visitor.getByText(/premier constat porte sur les recettes/i),
    ).toBeVisible()
  } finally {
    await anonymous.close()
  }
})
