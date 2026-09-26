import { expect, test } from '@playwright/test'
import { ACCOUNTS, signIn, waitForInteractive } from './helpers'

/**
 * A published text changes only through the circle (D30).
 *
 * The author edits a live article and saves. The save is kept — as a draft the
 * editor names as such — and readers go on seeing the approved text. Chromium
 * only, like every signed-in suite: our own per-IP throttle buckets every local
 * caller together.
 *
 * Skipped unless E2E_DATABASE is set. Run `npm run db:seed:demo` first; the
 * seed resets the working copy this test leaves behind.
 */
test.skip(!process.env.E2E_DATABASE, 'requires E2E_DATABASE and seeded accounts')

const LIVE = 'leducation-comme-priorite'

test('an edit to a published article is a draft until the circle accepts it', async ({
  page,
  browser,
}) => {
  const unreviewed = `Une phrase que le cercle n’a pas relue (${Date.now()}).`

  await signIn(page, ACCOUNTS.confirmed)
  await page.goto('/fr/write')
  await waitForInteractive(page)
  await page
    .getByRole('listitem')
    .filter({ hasText: /L'éducation comme priorité vérifiable/i })
    .getByRole('link', { name: /^Ouvrir$/i })
    .click()
  const surface = page.locator('.ProseMirror')
  await surface.waitFor({ timeout: 30_000 })
  await waitForInteractive(page)

  // Said before anything is typed: saving here does not change the live text.
  await expect(page.getByText(/Les lecteurs voient le texte approuvé/i)).toBeVisible()

  await surface.click()
  await page.keyboard.press('End')
  await page.keyboard.type(` ${unreviewed}`)
  await page.getByRole('button', { name: /^Enregistrer$/i }).click()
  await expect(page.getByText(/Enregistré à/i)).toBeVisible({ timeout: 15_000 })
  await expect(page.getByText(/Ce brouillon diffère du texte publié/i)).toBeVisible({
    timeout: 15_000,
  })

  // A reader with no account sees the approved text, and only that.
  const visitorContext = await browser.newContext()
  try {
    const visitor = await visitorContext.newPage()
    await visitor.goto(`/fr/articles/${LIVE}`)
    await expect(
      visitor.getByText(/Une priorité que personne ne peut vérifier/i),
    ).toBeVisible()
    await expect(visitor.getByText(unreviewed)).toHaveCount(0)
  } finally {
    await visitorContext.close()
  }
})
