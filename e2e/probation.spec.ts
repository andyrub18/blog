import { expect, test } from '@playwright/test'
import { ACCOUNTS, signIn, waitForInteractive } from './helpers'

/**
 * Closing the manifesto's six-month probation, against a real database.
 *
 * Skipped unless E2E_DATABASE is set. Run `npm run db:seed:demo` against the
 * same database first — it seeds a member whose probation elapsed a month ago.
 */
test.skip(!process.env.E2E_DATABASE, 'requires E2E_DATABASE and seeded accounts')

test('a senior member confirms a probationary member', async ({ page }) => {
  await signIn(page, ACCOUNTS.senior)
  await page.goto('/fr/review')
  await waitForInteractive(page)

  // The confirmation queue is reachable from the review queue, not only by URL.
  await page.getByRole('link', { name: /Confirmations de stage/i }).click()
  await expect(page).toHaveURL(/\/fr\/review\/probation\/?$/)

  const card = page.getByRole('listitem').filter({ hasText: ACCOUNTS.probationer })
  await expect(card).toBeVisible()

  // The plan the member is judged against is on the page, not a click away.
  await expect(card.getByText(/note de position par trimestre/i)).toBeVisible()

  // A decision with no written reason is refused.
  await card.getByRole('button', { name: /Confirmer le membre/i }).click()
  await expect(card.getByText(/motif est trop court/i)).toBeVisible()

  await card
    .getByRole('textbox')
    .fill('A tenu son plan : trois notes de position et un cycle de lectures anime.')
  await card.getByRole('button', { name: /Confirmer le membre/i }).click()
  await expect(card.getByText(/Membre confirmé/i)).toBeVisible()

  // A confirmed member leaves the queue.
  await page.goto('/fr/review/probation')
  await waitForInteractive(page)
  await expect(page.getByText(ACCOUNTS.probationer)).not.toBeVisible()
})

/** Authorisation, not just a hidden link: the URL must refuse them too. */
test('a reader cannot reach the confirmation queue', async ({ page }) => {
  await signIn(page, ACCOUNTS.reader)
  await page.goto('/fr/review/probation')
  await waitForInteractive(page)
  await expect(page.getByText(/Confirmations de stage/i)).not.toBeVisible()
})
