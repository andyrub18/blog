import { createHmac } from 'node:crypto'
import type { Page } from '@playwright/test'

export const DEMO_PASSWORD = 'demo-password-123'

export const ACCOUNTS = {
  /** Senior member — reviews applications. */
  senior: 'senior@kleayiti.test',
  /** Reader with no application; used by tests that only read the UI. */
  reader: 'reader@kleayiti.test',
  /** Reader with a pending application, seeded; the reviewer tests decide it. */
  applicant: 'applicant@kleayiti.test',
  /** Reader used by the test that actually submits an application. */
  newcomer: 'newcomer@kleayiti.test',
  /** Member admitted seven months ago; their probation is due for a decision. */
  probationer: 'probationer@kleayiti.test',
  /** Two more senior members, so three approvals — the floor — are reachable. */
  senior2: 'senior2@kleayiti.test',
  senior3: 'senior3@kleayiti.test',
  /** Member past their probation: the only kind who may be nominated. */
  confirmed: 'confirmed@kleayiti.test',
  /** Reserved for the blocking test, so it does not lock another test out. */
  blockable: 'blockable@kleayiti.test',
  /** The reset test changes this password; the seed puts it back. */
  forgetful: 'forgetful@kleayiti.test',
  /** Never verified its address; following a reset link does that. */
  lostmail: 'lostmail@kleayiti.test',
  /** Senior member the two-factor test turns codes on and off for. */
  guarded: 'guarded@kleayiti.test',
} as const

/**
 * Wait until the client has taken over the page.
 *
 * Server-rendered markup is visible and clickable before the bundle runs, and a
 * click sent in that window is simply lost. In dev the route's module may still
 * be compiling, which is how this bites. No real person outruns hydration, so
 * waiting here asserts the same behaviour a user sees.
 */
export async function waitForInteractive(page: Page): Promise<void> {
  await page
    .locator('html[data-hydrated="true"]')
    .waitFor({ state: 'attached', timeout: 30_000 })
}

/**
 * Open the header's language menu. The languages sit inside a `<details>`, so
 * they are in the page but not on screen until it opens. Waits for the bundle
 * first: choosing a language runs a handler, and a click before hydration is
 * lost (see `waitForInteractive`).
 */
export async function openLanguageMenu(page: Page): Promise<void> {
  await waitForInteractive(page)
  await page.locator('summary', { hasText: /Changer de langue/i }).click()
}

/** Sign in through the real form, so the session cookie is set the way it is in life. */
export async function signIn(
  page: Page,
  email: string,
  password: string = DEMO_PASSWORD,
): Promise<void> {
  await page.goto('/fr/auth/login')
  await waitForInteractive(page)
  await page.getByLabel(/courriel/i).fill(email)
  await page.getByLabel(/mot de passe/i).fill(password)
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
  await waitForInteractive(page)
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

/**
 * The code an authenticator app would show now for a base32 key (RFC 6238:
 * HMAC-SHA1, 30-second steps, six digits), so the two-factor test can do what
 * a person does with their phone.
 */
export function totp(base32Key: string, at: number = Date.now()): string {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'
  let bits = ''
  for (const char of base32Key.replace(/[\s=]/g, '').toUpperCase()) {
    bits += alphabet.indexOf(char).toString(2).padStart(5, '0')
  }
  const key = Buffer.from(
    bits.match(/.{8}/g)?.map((byte) => Number.parseInt(byte, 2)) ?? [],
  )
  const counter = Buffer.alloc(8)
  counter.writeBigUInt64BE(BigInt(Math.floor(at / 1000 / 30)))
  const mac = createHmac('sha1', key).update(counter).digest()
  const offset = (mac.at(-1) ?? 0) & 0xf
  const value = (mac.readUInt32BE(offset) & 0x7fffffff) % 1_000_000
  return String(value).padStart(6, '0')
}
