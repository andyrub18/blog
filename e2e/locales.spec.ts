import { expect, test } from '@playwright/test'

/**
 * The four interface languages, and what a reader gets in each.
 *
 * Phase 6 added English and Spanish for the diaspora. The thing worth testing
 * is not that the strings exist — the parity test in `src/i18n/messages.test.ts`
 * covers that — but that the site tells the truth about what it publishes. KLE
 * deliberates in Creole and French; the diaspora locales are an interface, not
 * a promise of translated articles, and the page says so in different words
 * depending on which of the two situations the reader is in.
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
  await expect(page.getByText(/KLE publishes in Creole and French/i)).toBeVisible()
})

test('the Spanish prefix serves the Spanish interface', async ({ page }) => {
  await page.goto('/es/articles')
  await expect(page.getByRole('heading', { name: 'Artículos' })).toBeVisible()
  await expect(page.getByText(/KLE publica en criollo y en francés/i)).toBeVisible()
})

/**
 * The distinction the phase exists for.
 *
 * A Creole reader on a French-only article is looking at a gap an author may
 * close, and is told so. A Spanish reader is not: no translation is pending,
 * and saying "not yet available in Spanish" on every article forever would
 * promise something nobody has decided to do.
 */
test('a diaspora reader is told what KLE publishes in, not that a translation is pending', async ({
  page,
}) => {
  await page.goto(`/es/articles/${FRENCH_ONLY}`)
  await expect(page.getByText(/KLE publica en criollo y en francés/i)).toBeVisible()
  await expect(page.getByText(/Todavía no disponible/i)).toHaveCount(0)
  // The article itself is served, in the language it was written in.
  await expect(
    page.getByRole('heading', { name: /L'éducation comme priorité/i }),
  ).toBeVisible()
})

test('a Creole reader on a French-only article is still told it is a gap', async ({
  page,
}) => {
  await page.goto(`/ht/articles/${FRENCH_ONLY}`)
  await expect(page.getByText(/Poko disponib an Kreyòl/i)).toBeVisible()
  await expect(page.getByText(/KLE pibliye an kreyòl ak an fransè/i)).toHaveCount(0)
})

test('an article written in both languages still falls back for a diaspora reader', async ({
  page,
}) => {
  await page.goto(`/en/articles/${BOTH_LANGUAGES}`)
  await expect(page.getByText(/KLE publishes in Creole and French/i)).toBeVisible()
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
 * which is the one real cost of the phase — but it is text in a chunk the page
 * already loads, not a new script. Nothing about a diaspora locale may pull the
 * editor or the forum onto the page a reader arrives on.
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
