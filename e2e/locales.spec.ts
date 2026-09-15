import { expect, test } from '@playwright/test'

/**
 * The four interface languages, and what a reader gets in each.
 *
 * English and Spanish were added for the diaspora. They are full languages of
 * the site, not a lesser tier: an article may be written in them, and a reader
 * who lands on one nobody has written yet gets the same honest banner a Creole
 * reader gets on a French-only article.
 *
 * Skipped unless E2E_DATABASE is set, so the suite stays green in CI without
 * Postgres. Run `npm run db:seed:demo` against the same database first.
 */
test.skip(!process.env.E2E_DATABASE, 'requires E2E_DATABASE and seeded accounts')

const BOTH_LANGUAGES = 'sitiyasyon-ekonomik-nan-peyi-a'
const FRENCH_ONLY = 'leducation-comme-priorite'

test('the English prefix serves the English interface', async ({ page }) => {
  await page.goto('/en/articles')
  await expect(page.getByRole('heading', { name: 'Articles', exact: true })).toBeVisible()
  await expect(page.getByRole('link', { name: /La situation économique/i })).toBeVisible()
})

test('the Spanish prefix serves the Spanish interface', async ({ page }) => {
  await page.goto('/es/articles')
  await expect(page.getByRole('heading', { name: 'Artículos' })).toBeVisible()
})

/**
 * The same sentence in every language.
 *
 * A reader asking for a language this article does not have is looking at a gap
 * an author may close, whichever language it is. Nothing in the platform says
 * English and Spanish articles will not be written, so nothing on this page
 * should imply it.
 */
test('a missing language falls back with the same honest banner in English', async ({
  page,
}) => {
  await page.goto(`/en/articles/${FRENCH_ONLY}`)
  await expect(page.getByText(/Not yet available in English/i)).toBeVisible()
  await expect(
    page.getByRole('heading', { name: /L'éducation comme priorité/i }),
  ).toBeVisible()
})

test('and in Spanish', async ({ page }) => {
  await page.goto(`/es/articles/${FRENCH_ONLY}`)
  await expect(page.getByText(/Todavía no disponible en Español/i)).toBeVisible()
})

test('a Creole reader on a French-only article gets it in Creole', async ({ page }) => {
  await page.goto(`/ht/articles/${FRENCH_ONLY}`)
  await expect(page.getByText(/Poko disponib an Kreyòl/i)).toBeVisible()
})

test('an article written in both languages falls back to the base locale', async ({
  page,
}) => {
  await page.goto(`/en/articles/${BOTH_LANGUAGES}`)
  await expect(page.getByText(/Not yet available in English/i)).toBeVisible()
  // French, the base locale, not the first translation that happens to exist.
  await expect(
    page.getByRole('heading', { name: /La situation économique/i }),
  ).toBeVisible()
})

test('every interface language is reachable from the switcher', async ({ page }) => {
  await page.goto(`/fr/articles/${BOTH_LANGUAGES}`)
  const switcher = page.getByRole('group', { name: /Changer de langue/i })
  for (const label of ['Français', 'Kreyòl', 'English', 'Español']) {
    await expect(switcher.getByRole('button', { name: label })).toBeVisible()
  }
})

/**
 * The budget is written for this page, and four locales do not change that.
 *
 * Every message the reading view uses now ships four strings instead of two,
 * which is the one real cost of adding them — but it is text in a chunk the
 * page already loads, not a new script. Nothing about a diaspora locale may
 * pull the editor or the forum onto the page a reader arrives on.
 */
test('a Spanish article page loads no editor and no forum script', async ({ page }) => {
  const scripts: Array<string> = []
  page.on('request', (request) => {
    if (request.resourceType() === 'script') scripts.push(request.url())
  })
  await page.goto(`/es/articles/${BOTH_LANGUAGES}`)
  expect(scripts.filter((url) => /ArticleEditor/i.test(url))).toEqual([])
  expect(scripts.filter((url) => /DiscussionThread|PostComposer/i.test(url))).toEqual([])
})
