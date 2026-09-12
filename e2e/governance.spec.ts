import { type Browser, expect, test } from '@playwright/test'
import { ACCOUNTS, DEMO_PASSWORD, signIn, waitForInteractive } from './helpers'

/**
 * Blocking, promotion by qualified majority, and cooptation — against a real
 * database. Run `npm run db:seed:demo` against the same database first.
 */
test.skip(!process.env.E2E_DATABASE, 'requires E2E_DATABASE and seeded accounts')

const REASON = 'Motif ecrit, assez long pour etre un motif et pour figurer au journal.'

test('a senior member blocks an account and the person is refused at sign-in', async ({
  page,
}) => {
  await signIn(page, ACCOUNTS.senior)
  await page.goto('/fr/review/members')
  await waitForInteractive(page)

  const card = page.getByRole('listitem').filter({ hasText: ACCOUNTS.blockable })
  await expect(card).toBeVisible()
  await card.getByRole('textbox').fill(REASON)
  await card.getByRole('button', { name: /^Bloquer$/i }).click()
  await expect(card.getByText(/Compte bloqué/i)).toBeVisible()

  // The refusal has to reach the door, not just the database. A block that
  // still lets the person sign in is not a block.
  const context = await page.context().browser()?.newContext()
  const fresh = await (context as NonNullable<typeof context>).newPage()
  await fresh.goto('/fr/auth/login')
  await waitForInteractive(fresh)
  await fresh.getByLabel(/courriel/i).fill(ACCOUNTS.blockable)
  await fresh.getByLabel(/mot de passe/i).fill(DEMO_PASSWORD)
  await fresh.getByRole('button', { name: /^se connecter$/i }).click()
  await expect(fresh.getByText(/compte a été bloqué/i)).toBeVisible()
  await context?.close()
})

test('a promotion needs three senior members, not one', async ({ browser }) => {
  const nominator = await browser.newContext()
  const page = await nominator.newPage()
  await signIn(page, ACCOUNTS.senior)
  await page.goto('/fr/review/members')
  await waitForInteractive(page)

  const card = page.getByRole('listitem').filter({ hasText: ACCOUNTS.confirmed })
  await card.getByRole('textbox').fill(REASON)
  await card.getByRole('button', { name: /Proposer comme membre sénior/i }).click()
  await expect(card.getByText(/Proposition ouverte/i)).toBeVisible()

  // The nominator's own approval is one voice, and one voice is not enough.
  await page.goto('/fr/review/promotions')
  await waitForInteractive(page)
  const nomination = page.getByRole('listitem').filter({ hasText: ACCOUNTS.confirmed })
  await nomination.getByRole('textbox').fill(REASON)
  await nomination.getByRole('button', { name: /^Approuver$/i }).click()
  await expect(nomination.getByText(/Le vote reste ouvert/i)).toBeVisible()

  // A second approval still leaves it open — two is not three.
  await approveAs(browser, ACCOUNTS.senior2, /Le vote reste ouvert/i)
  // The third reaches the floor and two thirds at once, and carries.
  await approveAs(browser, ACCOUNTS.senior3, /Proposition adoptée/i)
  await nominator.close()
})

/** Sign a senior member in, approve the open nomination, assert the outcome. */
async function approveAs(
  browser: Browser,
  email: string,
  expected: RegExp,
): Promise<void> {
  const context = await browser.newContext()
  const voter = await context.newPage()
  await signIn(voter, email)
  await voter.goto('/fr/review/promotions')
  await waitForInteractive(voter)
  const row = voter.getByRole('listitem').filter({ hasText: ACCOUNTS.confirmed })
  await row.getByRole('textbox').fill(REASON)
  await row.getByRole('button', { name: /^Approuver$/i }).click()
  await expect(row.getByText(expected)).toBeVisible()
  await context.close()
}

test('a senior member issues an invitation and is shown the link once', async ({
  page,
  browser,
}) => {
  await signIn(page, ACCOUNTS.senior)
  await page.goto('/fr/review/invitations')
  await waitForInteractive(page)

  const address = `invite-${Date.now()}@kle.test`
  await page.locator('[name="email"]').fill(address)
  await page.locator('[name="note"]').fill(REASON)
  await page.getByRole('button', { name: /Émettre l'invitation/i }).click()

  const panel = page
    .locator('div')
    .filter({ hasText: /Invitation émise/ })
    .last()
  await expect(panel).toBeVisible()
  // Scoped to the panel: the router devtools put <code> elements on the page too.
  const link = panel.locator('code')
  await expect(link).toContainText('/auth/register/invited?token=')

  // A separate context, signed out: the registration layout sends an
  // authenticated visitor home, so opening the link as the sponsor would only
  // ever test the redirect.
  const url = (await link.textContent()) ?? ''
  const guest = await browser.newContext()
  const invited = await guest.newPage()
  await invited.goto(url.replace(/^https?:\/\/[^/]+/, ''))
  await waitForInteractive(invited)
  await expect(invited.getByText(/Inscription sur invitation/i)).toBeVisible()
  await expect(invited.locator('input[readonly]')).toHaveValue(address)

  // And it can actually be completed: account, approved application and the
  // probation clock all land together, or none of them do.
  await invited.locator('[name="name"]').fill('Nouvo Manm')
  await invited.locator('[name="password"]').fill(DEMO_PASSWORD)
  await invited.locator('[name="dateOfBirth"]').fill('1995-04-12')
  await invited
    .locator('[name="essay"]')
    .fill(
      'Je lis KLE depuis plusieurs mois et je veux participer au Cercle Economie, ' +
        'ou je pense pouvoir apporter une lecture chiffree des projets publics ' +
        'et aider a documenter ce qui est reellement finance.',
    )
  await invited
    .locator('[name="contributionPlan"]')
    .fill(
      'Produire une note trimestrielle sur le financement des projets publics, ' +
        'animer un cycle de lectures ouvert aux lecteurs du cercle, et mettre ' +
        'mes competences en analyse de donnees au service des enquetes que le ' +
        'mouvement voudra mener sur les fonds publics.',
    )
  await invited.getByRole('button', { name: /Créer mon compte/i }).click()
  await expect(invited.getByText(/Compte créé/i)).toBeVisible({
    timeout: 20_000,
  })
  await guest.close()
})

test('a spent or unknown invitation link refuses instead of showing a form', async ({
  page,
}) => {
  await page.goto('/fr/auth/register/invited?token=not-a-real-token')
  await waitForInteractive(page)
  await expect(page.getByText(/Invitation inutilisable/i)).toBeVisible()
  await expect(page.locator('[name="contributionPlan"]')).toHaveCount(0)
})

test.describe('reader', () => {
  /** Authorisation, not just a hidden link. */
  test('cannot reach the roster', async ({ page }) => {
    await signIn(page, ACCOUNTS.reader)
    await page.goto('/fr/review/members')
    await expect(page.getByText(/Registre des comptes/i)).not.toBeVisible()
  })

  test('cannot reach the promotions page', async ({ page }) => {
    await signIn(page, ACCOUNTS.reader)
    await page.goto('/fr/review/promotions')
    await expect(page.getByText(/Propositions au rang/i)).not.toBeVisible()
  })
})
