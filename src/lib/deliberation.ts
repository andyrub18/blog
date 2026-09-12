import type { DecisionMethod, ReviewerStance } from './db/schema'

/**
 * The rules of the deliberation, with no IO and no framework.
 *
 * Split out of `article-review.ts` so the screens can read them. That module
 * imports `node:crypto` and the database, and a route that reaches it drags the
 * whole server into the browser bundle — a build-time trap this project has
 * paid for before (see the note at the top of `session.server.ts`). It is the
 * same split as `validation.ts` and `prosemirror.ts`: the numbers the UI shows
 * a senior member and the numbers the server enforces must be the same numbers,
 * and the only way to be sure is to run the same code.
 */

/** A written reason, long enough to actually be one. Same floor as every other decision. */
export const MIN_RATIONALE_CHARS = 20

/**
 * The floor for each of the five documentation fields.
 *
 * A floor, not a target. The manifesto's test is that a proposal states its
 * diagnosis, the solutions considered, the resources required, the risks
 * identified and how success will be measured; this only stops a field being
 * filled with a word. Whether the content is *adequate* is the contradictor's
 * job, and no character count can do it for them.
 */
export const MIN_DOCUMENTATION_CHARS = 60

/**
 * Quorum: three assigned reviewers, at least one of them a contradictor.
 *
 * Straight from the phase document. Three stops a proposal being waved through
 * by one friend; the contradictor is the part that makes it a deliberation
 * rather than a vote, because somebody has been named to find what is wrong
 * with it.
 */
export const MIN_REVIEWERS = 3
export const MIN_CONTRADICTORS = 1

/**
 * The support a single language needs before it is published.
 *
 * **This threshold is not in the manifesto and should be confirmed by KLE.** The
 * manifesto sets the quorum for the deliberation as a whole; it does not say
 * what one language of a multilingual article needs on its own. The rule chosen
 * here is the least that keeps the process honest:
 *
 * - a contradictor must have spoken on *that language*, because publishing a
 *   text nobody argued against is exactly what the adversarial stage exists to
 *   prevent — and an argument can be sound in French and badly rendered in
 *   Creole;
 * - at least two members must support it, so no language is carried by one
 *   voice;
 * - and supports must reach two thirds of the votes cast on it.
 *
 * Requiring the full quorum of three *per language* was the alternative. It was
 * rejected because it would make a Creole translation unpublishable whenever
 * only two of the assigned reviewers read Creole, which would quietly turn the
 * movement's second language into its optional one.
 */
export const MIN_LANGUAGE_SUPPORT = 2
export const SUPPORT_NUMERATOR = 2
export const SUPPORT_DENOMINATOR = 3

export type LanguageTally = {
  supports: number
  objections: number
  /**
   * Counted, reported, and deliberately kept out of the denominator.
   *
   * An abstention is a reviewer saying they read it and will not take a side.
   * Counting it as opposition would let a busy or undecided member block a
   * text without ever arguing against it — the same reasoning that makes the
   * promotion denominator votes cast rather than the electorate.
   */
  abstentions: number
  /** Whether somebody assigned to argue against it has spoken on this language. */
  contradicted: boolean
}

export type LanguageOutcome = {
  accepted: boolean
  method: DecisionMethod
  reason: 'accepted' | 'no_contradictor' | 'too_few_supports' | 'below_threshold'
}

/**
 * Decide one language from its tally.
 *
 * `consensus` when nobody objected and the support is there; otherwise the
 * qualified majority. Both are recorded, because "we all agreed" and "seven of
 * nine agreed" are different facts about the same article and the second is the
 * one somebody will later want to check.
 */
export function evaluateLanguage(tally: LanguageTally): LanguageOutcome {
  const cast = tally.supports + tally.objections
  const method: DecisionMethod =
    tally.objections === 0 ? 'consensus' : 'qualified_majority'

  if (!tally.contradicted) {
    return { accepted: false, method, reason: 'no_contradictor' }
  }
  if (tally.supports < MIN_LANGUAGE_SUPPORT) {
    return { accepted: false, method, reason: 'too_few_supports' }
  }
  if (tally.supports * SUPPORT_DENOMINATOR < cast * SUPPORT_NUMERATOR) {
    return { accepted: false, method, reason: 'below_threshold' }
  }
  return { accepted: true, method, reason: 'accepted' }
}

export type AssignedReviewer = { userId: string; stance: ReviewerStance }

/** Whether the assigned panel is big enough, and adversarial. */
export function meetsQuorum(reviewers: Array<AssignedReviewer>): boolean {
  const contradictors = reviewers.filter((r) => r.stance === 'contradictor').length
  return reviewers.length >= MIN_REVIEWERS && contradictors >= MIN_CONTRADICTORS
}

/** The five fields the manifesto requires. The form *is* the standard. */
export type Documentation = {
  diagnosis: string
  solutions: string
  resources: string
  risks: string
  indicators: string
}

const DOCUMENTATION_FIELDS: Array<keyof Documentation> = [
  'diagnosis',
  'solutions',
  'resources',
  'risks',
  'indicators',
]

/**
 * The five fields, trimmed, or null if any of them is too thin to be an answer.
 *
 * Shared with the form so the author is told before they submit, and with the
 * server function because that is the copy that counts.
 */
export function trimDocumentation(input: Documentation): Documentation | null {
  const trimmed = {} as Documentation
  for (const field of DOCUMENTATION_FIELDS) {
    const value = (input[field] ?? '').trim()
    if (value.length < MIN_DOCUMENTATION_CHARS) return null
    trimmed[field] = value
  }
  return trimmed
}
