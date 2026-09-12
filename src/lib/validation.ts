/**
 * Shared validation rules.
 *
 * These are pure functions with no framework or IO dependencies so that the
 * client forms and the server actions enforce exactly the same rules, and so
 * the rules can be unit-tested directly. Client-side validation is a courtesy
 * to the user; the server copy in `auth-actions.ts` is the one that counts.
 */

export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export const MIN_PASSWORD_LENGTH = 8
export const MIN_NAME_LENGTH = 2
export const MIN_ESSAY_CHARS = 50

/**
 * The contribution plan is what the six-month probation review is measured
 * against, so it has to say something concrete enough to evaluate.
 */
export const MIN_CONTRIBUTION_PLAN_CHARS = 200

/** Minimum age to hold any account. Not adulthood — a safeguarding floor. */
export const MIN_ACCOUNT_AGE_YEARS = 13

export const MAX_PDF_BYTES = 5 * 1024 * 1024

export function isValidEmail(value: string): boolean {
  return EMAIL_RE.test(value.trim().toLowerCase())
}

export function isValidName(value: string): boolean {
  return value.trim().length >= MIN_NAME_LENGTH
}

export function isValidPassword(value: string): boolean {
  return typeof value === 'string' && value.length >= MIN_PASSWORD_LENGTH
}

export function isValidEssay(value: string): boolean {
  return value.trim().length >= MIN_ESSAY_CHARS
}

export function parseDateOfBirth(value: string | null | undefined): Date | null {
  if (!value) return null
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? null : date
}

/**
 * Whole years elapsed between `birth` and `now`.
 *
 * Compared in UTC on purpose. A date of birth is a calendar date, and an
 * `<input type="date">` value like `2000-09-12` parses as UTC midnight. Reading
 * it back with local getters shifts it a day in any timezone behind UTC —
 * including Haiti's — which silently changes the computed age around a
 * birthday. Staying in UTC on both sides keeps the comparison stable wherever
 * the server happens to run.
 */
export function ageInYears(birth: Date, now: Date = new Date()): number {
  let age = now.getUTCFullYear() - birth.getUTCFullYear()
  const beforeBirthdayThisYear =
    now.getUTCMonth() < birth.getUTCMonth() ||
    (now.getUTCMonth() === birth.getUTCMonth() && now.getUTCDate() < birth.getUTCDate())
  if (beforeBirthdayThisYear) age -= 1
  return age
}

/**
 * Whether the account holder clears the minimum age floor.
 *
 * Deliberately not called `isAdult`: the floor is 13, which is a safeguarding
 * minimum, not majority. Naming it `isAdult` previously made the rule read as
 * something it is not.
 */
export function meetsMinimumAge(birth: Date, now: Date = new Date()): boolean {
  return ageInYears(birth, now) >= MIN_ACCOUNT_AGE_YEARS
}

/**
 * Article titles, summaries and slugs.
 *
 * The summary is required rather than optional: it is what a reader sees in the
 * index and what a link preview shows, and an article that arrives in a Haitian
 * WhatsApp group with no description is an article nobody opens.
 */
export const MIN_ARTICLE_TITLE_CHARS = 8
export const MAX_ARTICLE_TITLE_CHARS = 160
export const MIN_ARTICLE_SUMMARY_CHARS = 40
export const MAX_ARTICLE_SUMMARY_CHARS = 400
export const MAX_SLUG_CHARS = 80

export function isValidArticleTitle(value: string): boolean {
  const length = value.trim().length
  return length >= MIN_ARTICLE_TITLE_CHARS && length <= MAX_ARTICLE_TITLE_CHARS
}

export function isValidArticleSummary(value: string): boolean {
  const length = value.trim().length
  return length >= MIN_ARTICLE_SUMMARY_CHARS && length <= MAX_ARTICLE_SUMMARY_CHARS
}

export const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

export function isValidSlug(value: string): boolean {
  return value.length > 0 && value.length <= MAX_SLUG_CHARS && SLUG_RE.test(value)
}

/**
 * A URL-safe slug from a title in French or Creole.
 *
 * Accents are folded to their base letters — `sitiyasyon-ekonomik`, not a
 * percent-encoded mess — because these URLs get pasted into WhatsApp and read
 * aloud on the radio. Creole's `è`, `ò`, `à` and French's `é`, `ç`, `û` all
 * decompose under NFD, so one pass over the combining marks handles both
 * languages without a transliteration table.
 */
export function slugify(title: string): string {
  return title
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, MAX_SLUG_CHARS)
    .replace(/-+$/g, '')
}

/**
 * Forum posts.
 *
 * A post is plain text. It is not a document: the ProseMirror format exists so
 * that an article can carry structure and diff between review rounds, and a
 * reply needs neither. Keeping it text is also what lets the forum render
 * without `innerHTML` anywhere — the component emits text nodes, so there is no
 * escaping to get wrong on content written by whoever registered five minutes
 * ago.
 *
 * The minimum is deliberately low. "Wi." is a complete answer in Creole, and a
 * length floor borrowed from the membership essays would be a rule about how
 * people are allowed to talk.
 */
export const MIN_FORUM_POST_CHARS = 2
export const MAX_FORUM_POST_CHARS = 4000

/**
 * What is actually stored: newlines normalised, the ends trimmed, and runs of
 * blank lines collapsed to one.
 *
 * The collapse is not tidiness. Without it a post of forty blank lines pushes
 * every other reply off a phone screen, which is a denial of the page achieved
 * with the Enter key and no rule broken.
 */
export function normalizeForumPost(value: string): string {
  return value
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t]+$/gm, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

export function isValidForumPost(value: string): boolean {
  const length = normalizeForumPost(value).length
  return length >= MIN_FORUM_POST_CHARS && length <= MAX_FORUM_POST_CHARS
}

/**
 * A post split into paragraphs, on blank lines.
 *
 * Here rather than in the component so that the rule the server normalises by
 * and the rule the browser renders by are the same function. Single newlines
 * stay inside a paragraph and are rendered as line breaks by CSS, not by markup.
 */
export function forumParagraphs(value: string): Array<string> {
  return normalizeForumPost(value)
    .split('\n\n')
    .filter((block) => block.length > 0)
}

/**
 * A moderation reason, long enough to actually be one.
 *
 * Here rather than in `forum.ts` because both sides need it: the moderator's
 * form checks it as they type, and `moderatePost` refuses without it. Importing
 * the value from `forum.ts` would pull `node:crypto` and the database into the
 * browser — the same trap as importing the review rules from
 * `article-review.ts` instead of `deliberation.ts`.
 */
export const MIN_MODERATION_RATIONALE_CHARS = 20
