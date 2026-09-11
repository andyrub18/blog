import { expect, test } from '@playwright/test'

/**
 * Language routing. These run without a database: they only exercise the
 * public shell, so they stay green in CI without Postgres credentials.
 */
test.describe('language routing', () => {
  test('serves the French home page', async ({ page }) => {
    await page.goto('/fr')
    await expect(page.getByRole('heading', { level: 1 })).toContainText('KLE')
  })

  test('serves the Creole home page', async ({ page }) => {
    await page.goto('/ht')
    await expect(page.getByRole('heading', { level: 1 })).toContainText('KLE')
  })

  test('switching language keeps you on the same page', async ({ page }) => {
    await page.goto('/fr/auth/login')
    await page.getByRole('button', { name: 'Kreyòl' }).click()
    await expect(page).toHaveURL(/\/ht\/auth\/login$/)
  })

  test('the language choice survives a reload', async ({ page }) => {
    await page.goto('/fr')
    await page.getByRole('button', { name: 'Kreyòl' }).click()
    await expect(page).toHaveURL(/\/ht$/)
    await page.reload()
    await expect(page).toHaveURL(/\/ht$/)
  })

  test('an unknown language code does not 500', async ({ page }) => {
    const response = await page.goto('/de')
    expect(response?.status()).toBeLessThan(500)
  })

  test('declares alternate language links for search engines', async ({ page }) => {
    await page.goto('/fr')
    await expect(page.locator('link[hreflang="ht"]')).toHaveCount(1)
    await expect(page.locator('link[hreflang="x-default"]')).toHaveCount(1)
  })
})
