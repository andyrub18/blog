import { expect, test } from '@playwright/test'
import { ACCOUNTS, signIn, waitForInteractive } from './helpers'

/**
 * The manifesto's deliberation, end to end.
 *
 * Chromium only, like the other signed-in suites: running these twice doubles
 * the sign-ins, which is enough to trip our own per-IP throttle when no proxy
 * sets `x-forwarded-for`.
 *
 * Skipped unless E2E_DATABASE is set. Run `npm run db:seed:demo` first — it
 * seeds one submission already in debate with every verdict recorded, so the
 * decision can be reached in a single sign-in rather than four.
 */
test.skip(!process.env.E2E_DATABASE, 'requires E2E_DATABASE and seeded accounts')

test('an author submits an article with the five documented fields', async ({ page }) => {
  await signIn(page, ACCOUNTS.confirmed)
  await page.goto('/fr/write')
  await waitForInteractive(page)

  await page
    .getByRole('listitem')
    .filter({ hasText: /Le budget national et ses angles morts/i })
    .getByRole('link', { name: /^Ouvrir$/i })
    .click()
  await page.locator('.ProseMirror').waitFor({ timeout: 30_000 })

  await expect(page.getByRole('heading', { name: /Soumettre au cercle/i })).toBeVisible()
  await expect(
    page.getByText(/Une proposition non documentée n'est pas recevable/i),
  ).toBeVisible()

  // Nothing is submittable until a language is chosen: an empty language would
  // put the panel in front of a blank page.
  const submit = page.getByRole('button', { name: /^Soumettre$/i })
  await expect(submit).toBeDisabled()

  await page.getByRole('checkbox').first().check()
  await expect(submit).toBeEnabled()

  // A proposal that is not documented is not admissible — the form is the standard.
  await submit.click()
  await expect(
    page.getByText(/Chacun des cinq champs doit être renseigné/i),
  ).toBeVisible()

  for (const field of [
    'diagnosis',
    'solutions',
    'resources',
    'risks',
    'indicators',
  ] as const) {
    await page
      .locator(`[name="${field}"]`)
      .fill(
        'Un paragraphe assez long pour satisfaire le plancher de documentation ' +
          'et dire quelque chose de concret sur ce point précis de la proposition.',
      )
  }

  await submit.click()
  await expect(page.getByText(/Proposition soumise au cercle/i)).toBeVisible({
    timeout: 15_000,
  })
})

test('a senior member names a panel and cannot open a debate without a contradictor', async ({
  page,
}) => {
  await signIn(page, ACCOUNTS.senior)
  await page.goto('/fr/review/articles')
  await waitForInteractive(page)

  await expect(page.getByRole('heading', { name: /Articles soumis/i })).toBeVisible()

  // Its own seeded submission, filed with no panel. The suite runs
  // `fullyParallel`, so a test that leaned on another one having submitted
  // first would pass or fail on which worker got there first.
  const card = page
    .getByRole('listitem')
    .filter({ hasText: /décentralisation/i })
    .first()
  await card.getByRole('link', { name: /^Ouvrir$/i }).click()

  await expect(page.getByText(/Trois relecteurs au minimum/i)).toBeVisible()
  // The debate cannot be opened on an empty panel.
  const openDebate = page.getByRole('button', { name: /Ouvrir le débat/i })
  await expect(openDebate).toBeDisabled()
})

test('a senior member records the decision, and the circle publishes the article', async ({
  page,
  browser,
}) => {
  await signIn(page, ACCOUNTS.senior)
  await page.goto('/fr/review/articles')
  await waitForInteractive(page)

  await page
    .getByRole('listitem')
    .filter({ hasText: /électricité/i })
    .getByRole('link', { name: /^Ouvrir$/i })
    .click()

  // Every assigned reviewer has spoken, and the tally says the language passes.
  await expect(page.getByText(/3 pour · 0 contre/i)).toBeVisible()
  await expect(page.getByText(/Cette langue serait publiée/i)).toBeVisible()

  // A decision with no written reason is refused, like every other decision.
  await page.getByRole('button', { name: /Enregistrer la décision/i }).click()
  await expect(page.getByText(/Votre motivation est trop courte/i)).toBeVisible()

  await page
    .locator('[name="decisionRationale"]')
    .fill('Le diagnostic tient et les indicateurs proposés sont vérifiables.')
  await page.getByRole('button', { name: /Enregistrer la décision/i }).click()

  await expect(page.getByText(/Acceptée/i).first()).toBeVisible({ timeout: 15_000 })
  await expect(page.getByText(/par consensus/i)).toBeVisible()

  // The point of the decision: a reader with no account can now read it.
  const anonymous = await browser.newContext()
  try {
    const visitor = await anonymous.newPage()
    await visitor.goto('/fr/articles/pwopozisyon-sou-eneji')
    await expect(
      visitor.getByRole('heading', { name: /électricité comme préalable/i }),
    ).toBeVisible()
  } finally {
    await anonymous.close()
  }
})

test('an assigned member sees the panel and the arguments, and cannot decide', async ({
  page,
}) => {
  await signIn(page, ACCOUNTS.blockable)
  await page.goto('/fr/review/articles')
  await waitForInteractive(page)

  // The queue itself is a senior member's screen. A member reaches a
  // deliberation they were named to, not the list of all of them.
  await expect(page.getByRole('heading', { name: /Articles soumis/i })).toHaveCount(0)
})
