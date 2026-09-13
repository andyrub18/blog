import { describe, expect, it } from 'vitest'
import {
  ageInYears,
  forumParagraphs,
  isValidArticleSummary,
  isValidArticleTitle,
  isValidEmail,
  isValidEssay,
  isValidForumPost,
  isValidName,
  isValidPassword,
  isValidSlug,
  MAX_ARTICLE_SUMMARY_CHARS,
  MAX_ARTICLE_TITLE_CHARS,
  MAX_FORUM_POST_CHARS,
  MAX_SLUG_CHARS,
  MIN_ACCOUNT_AGE_YEARS,
  MIN_ARTICLE_SUMMARY_CHARS,
  meetsMinimumAge,
  normalizeForumPost,
  parseDateOfBirth,
  slugify,
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

describe('slugify', () => {
  it('folds French and Creole accents to their base letters', () => {
    // These URLs get pasted into WhatsApp and read aloud on the radio; a
    // percent-encoded slug survives neither.
    expect(slugify('La situation économique en Haïti')).toBe(
      'la-situation-economique-en-haiti',
    )
    expect(slugify('Sitiyasyon ekonomik nan peyi a — kèk repons')).toBe(
      'sitiyasyon-ekonomik-nan-peyi-a-kek-repons',
    )
  })

  it('collapses punctuation and trims the separators it leaves behind', () => {
    expect(slugify('  Quoi ?! Vraiment…  ')).toBe('quoi-vraiment')
  })

  it('never ends on a separator after being cut to length', () => {
    const slug = slugify(`${'a'.repeat(MAX_SLUG_CHARS - 1)} bcdef`)
    expect(slug.length).toBeLessThanOrEqual(MAX_SLUG_CHARS)
    expect(slug.endsWith('-')).toBe(false)
    expect(isValidSlug(slug)).toBe(true)
  })

  it('produces nothing from a title with no Latin letters, which the caller must handle', () => {
    expect(slugify('!!!')).toBe('')
    expect(isValidSlug('')).toBe(false)
  })
})

describe('isValidSlug', () => {
  it('accepts lowercase words joined by single hyphens', () => {
    expect(isValidSlug('manifes-kle-2026')).toBe(true)
  })

  it('rejects anything that would change what the URL means', () => {
    for (const value of [
      'Majuscule',
      'deux--tirets',
      '-bord',
      'bord-',
      'a/b',
      'a b',
      'é',
    ]) {
      expect(isValidSlug(value), value).toBe(false)
    }
  })

  it('rejects a slug past the length limit', () => {
    expect(isValidSlug('a'.repeat(MAX_SLUG_CHARS + 1))).toBe(false)
  })
})

describe('article title and summary', () => {
  it('requires a title long enough to say something and short enough to display', () => {
    expect(isValidArticleTitle('court')).toBe(false)
    expect(isValidArticleTitle('Un titre honnête')).toBe(true)
    expect(isValidArticleTitle('a'.repeat(MAX_ARTICLE_TITLE_CHARS + 1))).toBe(false)
  })

  it('requires a summary, because it is what a shared link shows', () => {
    expect(isValidArticleSummary('trop court')).toBe(false)
    expect(isValidArticleSummary('x'.repeat(MIN_ARTICLE_SUMMARY_CHARS))).toBe(true)
    expect(isValidArticleSummary('x'.repeat(MAX_ARTICLE_SUMMARY_CHARS + 1))).toBe(false)
  })
})

describe('forum posts', () => {
  it('accepts a short answer, because "Wi." is one', () => {
    // A length floor borrowed from the membership essays would be a rule about
    // how people are allowed to talk.
    expect(isValidForumPost('Wi.')).toBe(true)
    expect(isValidForumPost(' ')).toBe(false)
    expect(isValidForumPost('x'.repeat(MAX_FORUM_POST_CHARS + 1))).toBe(false)
  })

  it('collapses a wall of blank lines', () => {
    // Forty blank lines push every other reply off a phone screen — a denial of
    // the page achieved with the Enter key and no rule broken.
    expect(normalizeForumPost('un\n\n\n\n\n\ndeux')).toBe('un\n\ndeux')
    expect(normalizeForumPost('\r\n  du texte  \r\n')).toBe('du texte')
  })

  it('splits paragraphs on blank lines and keeps single newlines inside one', () => {
    expect(forumParagraphs('un\ndeux\n\ntrois')).toEqual(['un\ndeux', 'trois'])
    expect(forumParagraphs('   ')).toEqual([])
  })
})
