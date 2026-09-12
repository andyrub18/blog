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
