import { describe, expect, it } from 'vitest'
import {
  type AssignedReviewer,
  evaluateLanguage,
  type LanguageTally,
  MIN_LANGUAGE_SUPPORT,
  meetsQuorum,
} from './deliberation'

/**
 * The arithmetic of the deliberation, on its own.
 *
 * Kept apart from the database for the same reason `promotion.test.ts` is: this
 * is the rule the whole flow exists to enforce, it is the part most likely to be
 * quietly wrong, and it is the part somebody will one day be asked to justify to
 * a member whose article was not published.
 */

const tally = (partial: Partial<LanguageTally> = {}): LanguageTally => ({
  supports: 0,
  objections: 0,
  abstentions: 0,
  contradicted: true,
  ...partial,
})

describe('meetsQuorum', () => {
  const panel = (
    ...stances: Array<AssignedReviewer['stance']>
  ): Array<AssignedReviewer> => stances.map((stance, i) => ({ userId: `u${i}`, stance }))

  it('accepts three reviewers with a contradictor among them', () => {
    expect(meetsQuorum(panel('contradictor', 'reviewer', 'reviewer'))).toBe(true)
  })

  it('refuses a panel of two, however it is composed', () => {
    expect(meetsQuorum(panel('contradictor', 'reviewer'))).toBe(false)
    expect(meetsQuorum(panel('contradictor', 'contradictor'))).toBe(false)
  })

  it('refuses three reviewers with nobody assigned to argue against', () => {
    // This is the case worth guarding: a full panel that is not a deliberation,
    // because nobody has been named to find what is wrong with the proposal.
    expect(meetsQuorum(panel('reviewer', 'reviewer', 'reviewer'))).toBe(false)
  })

  it('accepts a panel that is all contradictors', () => {
    // Unusual, not invalid. A proposal everybody was asked to attack and which
    // survived is better tested, not worse.
    expect(meetsQuorum(panel('contradictor', 'contradictor', 'contradictor'))).toBe(true)
  })
})

describe('evaluateLanguage', () => {
  it('refuses a language no contradictor has spoken on, however strong the support', () => {
    const result = evaluateLanguage(tally({ supports: 9, contradicted: false }))
    expect(result.accepted).toBe(false)
    expect(result.reason).toBe('no_contradictor')
  })

  it('refuses a language carried by a single voice', () => {
    const result = evaluateLanguage(tally({ supports: 1 }))
    expect(result.accepted).toBe(false)
    expect(result.reason).toBe('too_few_supports')
  })

  it('accepts unopposed support as consensus', () => {
    const result = evaluateLanguage(tally({ supports: MIN_LANGUAGE_SUPPORT }))
    expect(result).toEqual({ accepted: true, method: 'consensus', reason: 'accepted' })
  })

  it('accepts exactly two thirds of the votes cast', () => {
    const result = evaluateLanguage(tally({ supports: 4, objections: 2 }))
    expect(result.accepted).toBe(true)
    expect(result.method).toBe('qualified_majority')
  })

  it('refuses a simple majority, which is the whole point', () => {
    // Three to two carries a simple majority and is refused. The manifesto
    // rejects simple majority for consequential decisions, and publishing under
    // the movement's name is one.
    const result = evaluateLanguage(tally({ supports: 3, objections: 2 }))
    expect(result.accepted).toBe(false)
    expect(result.reason).toBe('below_threshold')
  })

  it('does not let abstentions block a text', () => {
    // An abstention is "I read it and I will not take a side", not opposition.
    // Counting it in the denominator would let a busy member veto by silence.
    const withAbstentions = evaluateLanguage(tally({ supports: 2, abstentions: 5 }))
    expect(withAbstentions.accepted).toBe(true)

    const withObjections = evaluateLanguage(tally({ supports: 2, objections: 5 }))
    expect(withObjections.accepted).toBe(false)
  })

  it('does not let abstentions turn a consensus into a majority', () => {
    // Nobody objected, so it was a consensus — the people who abstained did not
    // disagree, they declined to judge.
    expect(evaluateLanguage(tally({ supports: 3, abstentions: 2 })).method).toBe(
      'consensus',
    )
  })

  it('reports the method even when the language is refused', () => {
    // The record has to say how it was being decided, not only that it failed.
    const result = evaluateLanguage(tally({ supports: 1, objections: 3 }))
    expect(result.accepted).toBe(false)
    expect(result.method).toBe('qualified_majority')
  })

  it('refuses a language nobody supported at all', () => {
    expect(evaluateLanguage(tally({ objections: 3 })).accepted).toBe(false)
    expect(evaluateLanguage(tally()).accepted).toBe(false)
  })
})
