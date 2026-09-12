import { expect, test } from '@playwright/test'
import { waitForInteractive } from './helpers'

/**
 * Sign-in and registration form behaviour.
 *
 * Client-side validation is asserted here; anything that needs a real account
 * is skipped unless E2E_DATABASE is set, so the suite is useful locally and
 * safe in CI without a database.
 */
const needsDb = !process.env.E2E_DATABASE

test.describe('login form', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/fr/auth/login')
    // Every test below submits the form, and a submission sent before the
    // client has taken over is lost rather than validated.
    await waitForInteractive(page)
  })

  test('shows the sign-in form', async ({ page }) => {
    await expect(page.getByLabel(/courriel/i)).toBeVisible()
    await expect(page.getByLabel(/mot de passe/i)).toBeVisible()
  })

  test('refuses an empty submission without calling the server', async ({ page }) => {
    let serverCalled = false
    await page.route('**/_serverFn/**', (route) => {
      serverCalled = true
      return route.continue()
    })
    await page.getByRole('button', { name: /^se connecter$/i }).click()
    await expect(page.locator('[aria-invalid="true"]')).not.toHaveCount(0)
    expect(serverCalled).toBe(false)
  })

  test('rejects a malformed email address', async ({ page }) => {
    await page.getByLabel(/courriel/i).fill('not-an-email')
    await page.getByLabel(/mot de passe/i).fill('averylongpassword')
    await page.getByRole('button', { name: /^se connecter$/i }).click()
    await expect(page.getByLabel(/courriel/i)).toHaveAttribute('aria-invalid', 'true')
  })

  test('rejects a password below the minimum length', async ({ page }) => {
    await page.getByLabel(/courriel/i).fill('lektè@kle.ht')
    await page.getByLabel(/mot de passe/i).fill('short')
    await page.getByRole('button', { name: /^se connecter$/i }).click()
    await expect(page.getByLabel(/mot de passe/i)).toHaveAttribute('aria-invalid', 'true')
  })

  test('announces status changes politely', async ({ page }) => {
    await expect(page.locator('#login-status')).toHaveAttribute('aria-live', 'polite')
  })

  test(
    needsDb ? 'rejects bad credentials' : 'rejects bad credentials',
    async ({ page }) => {
      test.skip(needsDb, 'requires E2E_DATABASE')
      await page.getByLabel(/courriel/i).fill('nobody@example.ht')
      await page.getByLabel(/mot de passe/i).fill('wrongpassword123')
      await page.getByRole('button', { name: /^se connecter$/i }).click()
      await expect(page.locator('#login-status')).not.toBeEmpty()
    },
  )
})

test.describe('reader registration', () => {
  test('validates every required field before submitting', async ({ page }) => {
    await page.goto('/fr/auth/register/reader')
    await waitForInteractive(page)
    await page.getByRole('button', { name: /Créer mon compte/i }).click()
    await expect(page.locator('[aria-invalid="true"]')).not.toHaveCount(0)
  })
})
