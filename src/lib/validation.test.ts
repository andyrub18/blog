import { describe, expect, it } from 'vitest'
import {
  ageInYears,
  isValidEmail,
  isValidEssay,
  isValidName,
  isValidPassword,
  MIN_ACCOUNT_AGE_YEARS,
  meetsMinimumAge,
  parseDateOfBirth,
} from './validation'

describe('isValidEmail', () => {
  it.each(['a@b.ht', 'anderson.ruban@unibank.ht', 'x+tag@sub.domain.org'])(
    'accepts %s',
    (email) => expect(isValidEmail(email)).toBe(true),
  )

  it.each(['', 'no-at-sign', 'a@b', 'a b@c.ht', '@b.ht', 'a@.ht'])(
    'rejects %s',
    (email) => expect(isValidEmail(email)).toBe(false),
  )

  it('ignores surrounding whitespace and case', () => {
    expect(isValidEmail('  ANDERSON@KLE.HT  ')).toBe(true)
  })
})

describe('isValidName', () => {
  it('requires at least two characters', () => {
    expect(isValidName('A')).toBe(false)
    expect(isValidName('Jn')).toBe(true)
  })

  it('does not count padding as characters', () => {
    expect(isValidName('  a  ')).toBe(false)
  })
})

describe('isValidPassword', () => {
  it('enforces the minimum length', () => {
    expect(isValidPassword('1234567')).toBe(false)
    expect(isValidPassword('12345678')).toBe(true)
  })

  it('rejects non-strings defensively', () => {
    expect(isValidPassword(undefined as unknown as string)).toBe(false)
  })
})

describe('isValidEssay', () => {
  it('rejects an essay below the minimum', () => {
    expect(isValidEssay('Too short.')).toBe(false)
  })

  it('accepts an essay at the minimum', () => {
    expect(isValidEssay('x'.repeat(50))).toBe(true)
  })

  it('does not let whitespace pad an essay to length', () => {
    expect(isValidEssay(`${' '.repeat(80)}short`)).toBe(false)
  })
})

describe('parseDateOfBirth', () => {
  it('parses an ISO date', () => {
    expect(parseDateOfBirth('1998-04-12')?.getUTCFullYear()).toBe(1998)
  })

  it.each([null, undefined, '', 'not-a-date'])('returns null for %s', (value) => {
    expect(parseDateOfBirth(value)).toBeNull()
  })
})

describe('ageInYears', () => {
  const now = new Date('2026-09-11T12:00:00Z')

  it('counts whole years', () => {
    expect(ageInYears(new Date('2000-09-11'), now)).toBe(26)
  })

  it('does not count a birthday that has not happened yet this year', () => {
    expect(ageInYears(new Date('2000-09-12'), now)).toBe(25)
  })

  it('counts a birthday that falls today', () => {
    expect(ageInYears(new Date('2010-09-11'), now)).toBe(16)
  })
})

describe('meetsMinimumAge', () => {
  const now = new Date('2026-09-11T12:00:00Z')

  it('accepts someone exactly at the floor', () => {
    const birth = new Date(now)
    birth.setUTCFullYear(now.getUTCFullYear() - MIN_ACCOUNT_AGE_YEARS)
    expect(meetsMinimumAge(birth, now)).toBe(true)
  })

  it('rejects someone one day short of the floor', () => {
    const birth = new Date(now)
    birth.setUTCFullYear(now.getUTCFullYear() - MIN_ACCOUNT_AGE_YEARS)
    birth.setUTCDate(birth.getUTCDate() + 1)
    expect(meetsMinimumAge(birth, now)).toBe(false)
  })
})
