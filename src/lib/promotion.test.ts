import { describe, expect, it } from 'vitest'
import { evaluate, MIN_APPROVALS } from './promotion'

/**
 * The qualified majority, on its own.
 *
 * This is the rule the whole promotion flow exists to enforce — three approvals
 * and two thirds of the votes cast — and the part most likely to be quietly
 * wrong, because every case looks plausible until the arithmetic is written
 * down. Kept pure so it can be checked without a database.
 */
const tally = (approvals: number, rejections: number, electorate: number) => ({
  approvals,
  rejections,
  electorate,
})

describe('evaluate — approval', () => {
  it('carries on three unanimous approvals', () => {
    expect(evaluate(tally(3, 0, 3))).toBe('approved')
  })

  it('carries at exactly two thirds', () => {
    // 4 of 6 is 2/3 exactly, and the threshold is "at least".
    expect(evaluate(tally(4, 2, 9))).toBe('approved')
  })

  it('does not carry on a bare majority', () => {
    // 3 of 5 is 60%: a majority, and not enough. This is the case the whole
    // rule exists for.
    expect(evaluate(tally(3, 2, 9))).toBe('open')
  })

  it('does not carry on two approvals however lopsided', () => {
    expect(evaluate(tally(2, 0, 9))).toBe('open')
  })

  it('needs the floor even when everyone who voted agreed', () => {
    // A tiny circle: two enthusiastic members cannot promote a third.
    expect(evaluate(tally(MIN_APPROVALS - 1, 0, MIN_APPROVALS - 1))).toBe('rejected')
  })
})

describe('evaluate — while the vote is still live', () => {
  it('stays open when nobody has voted', () => {
    expect(evaluate(tally(0, 0, 9))).toBe('open')
  })

  it('stays open when the remaining voters could still carry it', () => {
    // 1 for, 3 against, 5 yet to vote: 6 of 9 is exactly two thirds.
    expect(evaluate(tally(1, 3, 9))).toBe('open')
  })
})

describe('evaluate — impossibility', () => {
  it('closes once two thirds is out of reach', () => {
    // 0 for, 4 against, 5 yet to vote: at best 5 of 9, short of two thirds.
    expect(evaluate(tally(0, 4, 9))).toBe('rejected')
  })

  it('closes once three approvals is out of reach', () => {
    // Three of five have rejected; only two could still approve.
    expect(evaluate(tally(0, 3, 5))).toBe('rejected')
  })

  it('closes when the best remaining outcome is still short of two thirds', () => {
    // 0 for, 2 against, 3 yet to vote. Even unanimous support from all three
    // gives 3 of 5 — a clear majority, and still not two thirds.
    expect(evaluate(tally(0, 2, 5))).toBe('rejected')
  })

  it('stays open while one objection can still be outvoted', () => {
    // 0 for, 1 against, 4 yet to vote: 4 of 5 would carry it comfortably.
    expect(evaluate(tally(0, 1, 5))).toBe('open')
  })

  it('cannot pass in a circle too small to reach the floor', () => {
    expect(evaluate(tally(0, 0, 2))).toBe('rejected')
  })
})

describe('evaluate — abstention', () => {
  it('counts votes cast, not the whole electorate', () => {
    // Six of nine never voted; the three who did were unanimous.
    expect(evaluate(tally(3, 0, 9))).toBe('approved')
  })

  it('treats a silent member as neither support nor opposition', () => {
    // Same votes, a much larger circle: the outcome does not move.
    expect(evaluate(tally(4, 2, 40))).toBe('approved')
  })
})
