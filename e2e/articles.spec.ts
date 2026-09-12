import { expect, test } from '@playwright/test'
import { waitForInteractive } from './helpers'

/**
 * Reading articles, against a real database.
 *
 * Reading only — no sign-in, which is the point: every test here passes with no
 * account at all. Authoring lives in `write.spec.ts`, which runs on chromium
 * alone so the sign-ins do not trip our own per-IP rate limit.
 *
 * Skipped unless E2E_DATABASE is set, so the suite stays green in CI without
 * Postgres. Run `npm run db:seed:demo` against the same database first.
 */
test.skip(!process.env.E2E_DATABASE, 'requires E2E_DATABASE and seeded accounts')

const PUBLISHED = 'sitiyasyon-ekonomik-nan-peyi-a'
const FRENCH_ONLY = 'leducation-comme-priorite'
const INTERNAL_DRAFT = 'note-interne-cercle-economie'

test('a public article is readable with no account at all', async ({ page }) => {
  // Reach is the point (DECISIONS.md, D1). If this ever needs a session, the
  // movement has quietly put its output behind a signup wall.
  await page.goto(`/fr/articles/${PUBLISHED}`)
  await expect(
    page.getByRole('heading', { name: /La situation économique/i }),
  ).toBeVisible()
  await expect(page.getByText(/le diagnostic d'abord/i)).toBeVisible()
})

test('the index lists published articles and not drafts', async ({ page }) => {
  await page.goto('/fr/articles')
  await expect(page.getByRole('link', { name: /La situation économique/i })).toBeVisible()
  await expect(
    page.getByRole('link', { name: /L'éducation comme priorité/i }),
  ).toBeVisible()
  await expect(page.getByText(/Note de travail du Cercle Économie/i)).toHaveCount(0)
})

test('the Creole URL serves the Creole translation', async ({ page }) => {
  await page.goto(`/ht/articles/${PUBLISHED}`)
  await expect(page.getByRole('heading', { name: /Sitiyasyon ekonomik/i })).toBeVisible()
  // No banner: this language exists.
  await expect(page.getByText(/Poko disponib/i)).toHaveCount(0)
})

test('a missing language falls back with an honest banner, not a 404', async ({
  page,
}) => {
  await page.goto(`/ht/articles/${FRENCH_ONLY}`)
  await expect(page.getByText(/Poko disponib an Kreyòl/i)).toBeVisible()
  await expect(
    page.getByRole('heading', { name: /L'éducation comme priorité/i }),
  ).toBeVisible()
})

test('a members-only article refuses an anonymous reader and offers the way in', async ({
  page,
}) => {
  // A refusal, not a 404: somebody who was linked to this can act on it.
  await page.goto(`/fr/articles/${INTERNAL_DRAFT}`)
  await expect(page.getByText(/n'existe pas|réservé aux membres/i)).toBeVisible()
})

test('an article page carries no editor', async ({ page }) => {
  const scripts: Array<string> = []
  page.on('request', (request) => {
    if (request.resourceType() === 'script') scripts.push(request.url())
  })
  await page.goto(`/fr/articles/${PUBLISHED}`)
  await waitForInteractive(page)
  // The budget's largest single win: TipTap is 100+ KB gzipped and a reader on
  // metered Haitian mobile data must never download it.
  expect(scripts.filter((url) => /ArticleEditor/i.test(url))).toEqual([])
})
