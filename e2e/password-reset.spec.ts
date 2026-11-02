import { expect, type Page, test } from '@playwright/test'
import { ACCOUNTS, DEMO_PASSWORD, signIn, waitForInteractive } from './helpers'

/**
 * Password recovery, through the link a person actually receives.
 *
 * The mail itself is not read: `db:seed:demo` stores a known reset token for
 * `forgetful` and `lostmail`, the way Better Auth stores one, and the tests
 * follow `/api/auth/reset-password/<token>` exactly as a click in the mail
 * would. Each test owns its account; the seed restores both passwords.
 */
test.skip(!process.env.E2E_DATABASE, 'requires E2E_DATABASE and seeded accounts')

const NEW_PASSWORD = 'a-new-password-for-e2e'

function resetLink(token: string, page: string): string {
  return `/api/auth/reset-password/${token}?callbackURL=${encodeURIComponent(page)}`
}

async function chooseNewPassword(page: Page, password: string, confirm = password) {
  await page.getByLabel('Nouveau mot de passe').fill(password)
  await page.getByLabel('Confirmez le mot de passe').fill(confirm)
  await page.getByRole('button', { name: /enregistrer le mot de passe/i }).click()
}

test('the sign-in page leads to recovery', async ({ page }) => {
  await page.goto('/fr/auth/login')
  await waitForInteractive(page)
  await page.getByRole('link', { name: /mot de passe oublié/i }).click()
  await expect(page).toHaveURL(/\/fr\/auth\/reset-password$/)
  await expect(page.getByRole('heading', { name: /mot de passe oublié/i })).toBeVisible()
})

/**
 * "No such account" would tell anybody whether an address belongs to a member
 * of the movement. The answer reads the same either way.
 */
test('a request is answered the same whether the account exists or not', async ({
  page,
}) => {
  const answers: Array<string> = []
  for (const email of [ACCOUNTS.reader, 'nobody-by-this-name@kleayiti.test']) {
    await page.goto('/fr/auth/reset-password')
    await waitForInteractive(page)
    await page.getByLabel(/courriel/i).fill(email)
    await page.getByRole('button', { name: /envoyer le lien/i }).click()
    const answer = page.getByRole('status')
    await expect(answer).toContainText(email)
    answers.push(((await answer.textContent()) ?? '').replace(email, '<address>'))
  }
  expect(answers[0]).toBe(answers[1])
})

test('a dead link comes back to the request form, in the language of the mail', async ({
  page,
}) => {
  await page.goto(resetLink('not-a-real-token', '/ht/auth/reset-password'))
  const landed = new URL(page.url())
  expect(landed.pathname).toBe('/ht/auth/reset-password')
  expect(landed.searchParams.get('error')).toBe('INVALID_TOKEN')
  await expect(page.getByText(/Lyen sa a fini/)).toBeVisible()
  await expect(page.getByRole('button', { name: /voye lyen an/i })).toBeVisible()
})

test('a reset link sets a new password once and signs every session out', async ({
  browser,
  page,
}) => {
  // The account is signed in somewhere else — the case where a reset matters
  // most is the one where that somewhere else is not the owner.
  const elsewhere = await browser.newContext()
  const intruder = await elsewhere.newPage()
  await signIn(intruder, ACCOUNTS.forgetful)
  await intruder.goto('/fr/apply')
  await expect(intruder).toHaveURL(/\/fr\/apply$/)

  const link = resetLink('e2e-forgetful-reset-token', '/fr/auth/reset-password')
  await page.goto(link)
  await waitForInteractive(page)
  await expect(page).toHaveURL(/\/fr\/auth\/reset-password\?token=/)

  // Asked twice, because a typo here would lock the person out again.
  await chooseNewPassword(page, NEW_PASSWORD, `${NEW_PASSWORD}-typo`)
  await expect(page.getByText(/ne correspondent pas/i)).toBeVisible()
  await chooseNewPassword(page, NEW_PASSWORD)
  await expect(page.getByRole('heading', { name: /mot de passe changé/i })).toBeVisible()

  // The other session is gone: the page that needs an account sends it to sign in.
  await intruder.goto('/fr/apply')
  await expect(intruder).toHaveURL(/\/fr\/auth\/login/)
  await elsewhere.close()

  // The old password no longer opens the account; the new one does.
  await page.goto('/fr/auth/login')
  await waitForInteractive(page)
  await page.getByLabel(/courriel/i).fill(ACCOUNTS.forgetful)
  await page.getByLabel(/mot de passe/i).fill(DEMO_PASSWORD)
  await page.getByRole('button', { name: /^se connecter$/i }).click()
  await expect(page.getByText(/identifiants invalides/i)).toBeVisible()
  await signIn(page, ACCOUNTS.forgetful, NEW_PASSWORD)

  // And the link was spent.
  await page.goto(link)
  expect(new URL(page.url()).searchParams.get('error')).toBe('INVALID_TOKEN')
})

/**
 * The link proves the address as well as a verification mail would. Somebody
 * whose verification never arrived must not reset their password and still be
 * refused for an unverified address.
 */
test('following a reset link verifies the address it was sent to', async ({ page }) => {
  await page.goto('/fr/auth/login')
  await waitForInteractive(page)
  await page.getByLabel(/courriel/i).fill(ACCOUNTS.lostmail)
  await page.getByLabel(/mot de passe/i).fill(DEMO_PASSWORD)
  await page.getByRole('button', { name: /^se connecter$/i }).click()
  await expect(page.getByText(/vérifier votre adresse/i)).toBeVisible()

  await page.goto(resetLink('e2e-lostmail-reset-token', '/fr/auth/reset-password'))
  await waitForInteractive(page)
  await chooseNewPassword(page, NEW_PASSWORD)
  await expect(page.getByRole('heading', { name: /mot de passe changé/i })).toBeVisible()

  await signIn(page, ACCOUNTS.lostmail, NEW_PASSWORD)
})

/**
 * Only the server functions may ask Better Auth for a reset; they are the ones
 * behind the per-address limit. Open, the endpoint would mail any address.
 */
test('the reset endpoints refuse direct requests', async ({ request }) => {
  const asked = await request.post('/api/auth/request-password-reset', {
    data: { email: ACCOUNTS.reader },
  })
  expect(asked.status()).toBe(404)
  const set = await request.post('/api/auth/reset-password', {
    data: { token: 'e2e-forgetful-reset-token', newPassword: 'chosen-by-a-stranger' },
  })
  expect(set.status()).toBe(404)
})
