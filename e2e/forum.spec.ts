import { expect, test } from '@playwright/test'
import { ACCOUNTS, signIn, waitForInteractive } from './helpers'

/**
 * The forum, against a real database.
 *
 * The first two tests need no account — reading a public discussion must not,
 * any more than reading the article does. The posting test signs in, so it runs
 * on chromium alone: the suite shares one per-IP throttle bucket, and a second
 * sign-in per browser project is how one run locks out the next.
 *
 * Skipped unless E2E_DATABASE is set. Run `npm run db:seed:demo` first — it
 * seeds the discussion these tests read.
 */
test.skip(!process.env.E2E_DATABASE, 'requires E2E_DATABASE and seeded accounts')

const PUBLISHED = 'sitiyasyon-ekonomik-nan-peyi-a'
const INTERNAL_DRAFT = 'note-interne-cercle-economie'

test('the article page shows the discussion without shipping it', async ({ page }) => {
  const scripts: Array<string> = []
  page.on('request', (request) => {
    if (request.resourceType() === 'script') scripts.push(request.url())
  })

  await page.goto(`/fr/articles/${PUBLISHED}`)
  await waitForInteractive(page)

  // The tail is server-rendered: the count, at least one post and the way in
  // are all there before anything runs.
  //
  // Deliberately not asserting *which* post. The tail holds the last three, so
  // naming one makes this test depend on nothing else having been posted since
  // the seed — which the posting test below does, in parallel. That the seeded
  // conversation is readable is asserted on the discussion page, which shows
  // the whole thread.
  await expect(page.getByText(/réponses/i).first()).toBeVisible()
  await expect(page.locator('section li').first()).toBeVisible()
  await expect(page.getByRole('link', { name: /discussion|répondre/i })).toBeVisible()

  // And the thread's own code is not. The poller, the composer and the
  // moderation controls belong to the page a reader chooses to open; a reader
  // on metered mobile data who only wanted the article pays for none of it.
  expect(scripts.filter((url) => /DiscussionThread|PostComposer/i.test(url))).toEqual([])
})

test('anyone can read the discussion, and is told plainly they cannot answer', async ({
  page,
}) => {
  await page.goto(`/fr/articles/${PUBLISHED}/discussion`)
  await waitForInteractive(page)

  await expect(page.getByText(/il ne dit rien de l'agriculture/i)).toBeVisible()
  await expect(page.getByText(/Connectez-vous pour participer/i)).toBeVisible()
  await expect(page.getByRole('button', { name: /^publier$/i })).toHaveCount(0)
})

test('a members-only article has no discussion for an anonymous reader', async ({
  page,
}) => {
  // The replies quote the article. Answering here would be a way around the
  // article's own visibility.
  await page.goto(`/fr/articles/${INTERNAL_DRAFT}/discussion`)
  await waitForInteractive(page)
  await expect(page.getByText(/introuvable|ne pouvez pas participer/i)).toBeVisible()
})

/**
 * Posting runs on the phone as well as the desktop, and that is deliberate.
 *
 * Most of KLE's readers arrive on a phone, so the composer on a narrow screen
 * is the case that matters most, not a variant of the real one. It costs a
 * second sign-in per run, which is well inside the per-IP limit — that limit is
 * loose on purpose, because one Haitian address is routinely one cybercafé, and
 * a successful sign-in clears it.
 */
test.describe('posting', () => {
  test('a reader posts and sees it appear', async ({ page }) => {
    await signIn(page, ACCOUNTS.reader)
    await page.goto(`/fr/articles/${PUBLISHED}/discussion`)
    await waitForInteractive(page)

    const said = `La question du transport manque aussi (${Date.now()}).`
    await page.locator('[name="body"]').first().fill(said)
    await page
      .getByRole('button', { name: /^publier$/i })
      .first()
      .click()

    await expect(page.getByText(said)).toBeVisible({ timeout: 15_000 })

    // It is really stored, not only painted: a fresh load of the article page
    // shows it in the tail. Matched on the whole line, timestamp included —
    // every run of this test leaves one behind, and a loose match would find
    // all of them.
    await page.goto(`/fr/articles/${PUBLISHED}`)
    await expect(page.getByText(said)).toBeVisible()
  })
})
