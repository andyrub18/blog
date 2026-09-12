import type { Page } from '@playwright/test'

export const DEMO_PASSWORD = 'demo-password-123'

export const ACCOUNTS = {
  /** Senior member — reviews applications. */
  senior: 'senior@kle.test',
  /** Reader with no application; used by tests that only read the UI. */
  reader: 'reader@kle.test',
  /** Reader with a pending application, seeded; the reviewer tests decide it. */
  applicant: 'applicant@kle.test',
  /** Reader used by the test that actually submits an application. */
  newcomer: 'newcomer@kle.test',
} as const

/** Sign in through the real form, so the session cookie is set the way it is in life. */
export async function signIn(page: Page, email: string): Promise<void> {
  await page.goto('/fr/auth/login')
  await page.getByLabel(/courriel/i).fill(email)
  await page.getByLabel(/mot de passe/i).fill(DEMO_PASSWORD)
  await page.getByRole('button', { name: /^se connecter$/i }).click()
  await page.waitForURL(/\/fr\/?$/, { timeout: 15_000 })
}

/** A byte-valid PDF, so the server's magic-byte check accepts it. */
export const PDF_BYTES = Buffer.from(
  '%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n',
  'latin1',
)

/** File the membership application as the signed-in reader. */
export async function submitApplication(page: Page): Promise<void> {
  await page.goto('/fr/apply')
  await page
    .locator('[name="contributionPlan"]')
    .fill(
      'Je propose de coordonner un cycle de lectures sur les politiques ' +
        'educatives haitiennes et de produire une note de position par trimestre, ' +
        'puis de mettre mes competences en analyse de donnees au service du cercle.',
    )
  for (const field of ['cv', 'vision', 'contribution']) {
    await page.locator(`[name="${field}"]`).setInputFiles({
      name: `${field}.pdf`,
      mimeType: 'application/pdf',
      buffer: PDF_BYTES,
    })
  }
  await page.getByRole('button', { name: /Déposer ma candidature/i }).click()
  await page.getByText(/Candidature déposée/i).waitFor({ timeout: 15_000 })
}
