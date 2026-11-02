import { expect, type Page, test } from '@playwright/test'
import { ACCOUNTS, DEMO_PASSWORD, signIn, totp, waitForInteractive } from './helpers'

/**
 * Codes at sign-in, opt-in (D40), done the way a person does it: the test reads
 * the key off the setup page and computes what their phone would show.
 *
 * One account, `guarded`, reserved for this file; the seed turns its codes off
 * again before every run.
 */
test.skip(!process.env.E2E_DATABASE, 'requires E2E_DATABASE and seeded accounts')

/** Password first; the form then asks for a code instead of signing in. */
async function passwordStep(page: Page): Promise<void> {
  await page.goto('/fr/auth/login')
  await waitForInteractive(page)
  await page.getByLabel(/courriel/i).fill(ACCOUNTS.guarded)
  await page.getByLabel(/mot de passe/i).fill(DEMO_PASSWORD)
  await page.getByRole('button', { name: /^se connecter$/i }).click()
  await expect(page.getByRole('heading', { name: /code de vérification/i })).toBeVisible()
}

async function enterCode(page: Page, code: string): Promise<void> {
  await page.getByLabel('Code', { exact: true }).fill(code)
  await page.getByRole('button', { name: /^vérifier$/i }).click()
}

const securityDoor = (page: Page) =>
  page.getByRole('link', { name: /sécurité du compte/i })

test('a senior turns codes on, signs in with them, and turns them off', async ({
  page,
}) => {
  await signIn(page, ACCOUNTS.guarded)
  await expect(securityDoor(page)).toContainText(/désactivée/i)
  await securityDoor(page).click()
  await waitForInteractive(page)

  // Turning codes on asks for the password again.
  await page.getByLabel('Mot de passe', { exact: true }).fill('not-the-password')
  await page.getByRole('button', { name: /^activer$/i }).click()
  await expect(page.getByText('Mot de passe incorrect.')).toBeVisible()
  await page.getByLabel('Mot de passe', { exact: true }).fill(DEMO_PASSWORD)
  await page.getByRole('button', { name: /^activer$/i }).click()

  // The key, three ways, and ten backup codes.
  await expect(page.locator('img[src^="data:image/svg+xml"]')).toBeVisible()
  await expect(
    page.getByRole('link', { name: /ouvrir dans l'application/i }),
  ).toHaveAttribute('href', /^otpauth:\/\/totp\/KLEA/)
  const key = ((await page.getByTestId('totp-secret').textContent()) ?? '').replace(
    /\s/g,
    '',
  )
  const backupCodes = await page
    .getByTestId('backup-codes')
    .locator('li')
    .allTextContents()
  expect(backupCodes).toHaveLength(10)

  // A wrong first code changes nothing; the right one turns codes on.
  await page.getByLabel(/saisissez le code/i).fill(totp(key, Date.now() - 10 * 60_000))
  await page.getByRole('button', { name: /^confirmer$/i }).click()
  await expect(page.getByText(/ce code n'est pas valable/i)).toBeVisible()
  await page.getByLabel(/saisissez le code/i).fill(totp(key))
  await page.getByRole('button', { name: /^confirmer$/i }).click()
  await expect(page.getByText(/^activée\./i)).toBeVisible()
  // Turning codes on replaces the session; the new one must be the one kept.
  // It used to be expired in the same response, signing the person out.
  await page.reload()
  await expect(page.getByText(/^activée\./i)).toBeVisible()

  // Signing in now takes a code: a wrong one is refused, the right one opens.
  await page.context().clearCookies()
  await passwordStep(page)
  await enterCode(page, totp(key, Date.now() - 10 * 60_000))
  await expect(page.getByText(/ce code n'est pas valable/i)).toBeVisible()
  await enterCode(page, totp(key))
  await expect(page).toHaveURL(/\/fr\/?$/)
  await expect(securityDoor(page)).toContainText(/activée/i)

  // Without the phone, a backup code works — once.
  for (const expected of ['works', 'spent'] as const) {
    await page.context().clearCookies()
    await passwordStep(page)
    await page.getByRole('button', { name: /utiliser un code de secours/i }).click()
    await enterCode(page, backupCodes[0])
    if (expected === 'works') {
      await expect(page).toHaveURL(/\/fr\/?$/)
    } else {
      await expect(page.getByText(/ce code n'est pas valable/i)).toBeVisible()
      await page.getByRole('button', { name: /utiliser l'application/i }).click()
      await enterCode(page, totp(key))
      await expect(page).toHaveURL(/\/fr\/?$/)
    }
  }

  // Turning codes off asks for the password too, and the password alone then signs in.
  await page.goto('/fr/account')
  await waitForInteractive(page)
  await page.getByLabel('Mot de passe', { exact: true }).fill(DEMO_PASSWORD)
  await page.getByRole('button', { name: /^désactiver$/i }).click()
  await expect(page.getByRole('button', { name: /^activer$/i })).toBeVisible()
  await page.reload()
  await expect(page.getByRole('button', { name: /^activer$/i })).toBeVisible()
  await page.context().clearCookies()
  await signIn(page, ACCOUNTS.guarded)
})

test('the security page sends a visitor to sign in', async ({ page }) => {
  await page.goto('/fr/account')
  await expect(page.getByText(/connectez-vous pour gérer/i)).toBeVisible()
})

/**
 * Only the server functions reach Better Auth's two-factor endpoints: they are
 * the ones that refuse a blocked account after its code, as after a password.
 */
test('the two-factor endpoints refuse direct requests', async ({ request }) => {
  for (const path of ['verify-totp', 'verify-backup-code', 'enable', 'disable']) {
    const response = await request.post(`/api/auth/two-factor/${path}`, {
      data: { code: '123456', password: DEMO_PASSWORD },
    })
    expect(response.status(), path).toBe(404)
  }
})
