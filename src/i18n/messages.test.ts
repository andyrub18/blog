import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { DEFAULT_LOCALE, isLocale, LOCALE_LABELS, LOCALES } from './index'

type Bundle = Record<string, string>

function load(locale: string): Bundle {
  const raw = readFileSync(join(process.cwd(), 'messages', `${locale}.json`), 'utf-8')
  const parsed = JSON.parse(raw) as Record<string, unknown>
  delete parsed.$schema
  return parsed as Bundle
}

const bundles = Object.fromEntries(LOCALES.map((l) => [l, load(l)])) as Record<
  (typeof LOCALES)[number],
  Bundle
>

describe('locale registry', () => {
  it('includes the default locale', () => {
    expect(LOCALES).toContain(DEFAULT_LOCALE)
  })

  it('labels every locale', () => {
    for (const locale of LOCALES) {
      expect(LOCALE_LABELS[locale]).toBeTruthy()
    }
  })

  it('recognises only known locales', () => {
    expect(isLocale('fr')).toBe(true)
    expect(isLocale('ht')).toBe(true)
    expect(isLocale('de')).toBe(false)
    expect(isLocale(null)).toBe(false)
  })
})

describe('message bundles', () => {
  it('ships a bundle for every registered locale', () => {
    for (const locale of LOCALES) {
      expect(Object.keys(bundles[locale]).length).toBeGreaterThan(0)
    }
  })

  // The failure this guards against: a French string shipped, its Creole
  // counterpart forgotten, and a Creole reader silently served French.
  it('has no key missing from any locale', () => {
    const reference = new Set(Object.keys(bundles[DEFAULT_LOCALE]))
    for (const locale of LOCALES) {
      const missing = [...reference].filter((k) => !(k in bundles[locale]))
      expect({ locale, missing }).toEqual({ locale, missing: [] })
    }
  })

  it('has no key present in a translation but absent from the base locale', () => {
    const reference = new Set(Object.keys(bundles[DEFAULT_LOCALE]))
    for (const locale of LOCALES) {
      const orphaned = Object.keys(bundles[locale]).filter((k) => !reference.has(k))
      expect({ locale, orphaned }).toEqual({ locale, orphaned: [] })
    }
  })

  it('has no empty or placeholder-only translations', () => {
    for (const locale of LOCALES) {
      const blank = Object.entries(bundles[locale])
        .filter(([, value]) => typeof value !== 'string' || value.trim() === '')
        .map(([key]) => key)
      expect({ locale, blank }).toEqual({ locale, blank: [] })
    }
  })

  it('uses the same placeholders in every locale', () => {
    const placeholders = (value: string) =>
      [...value.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort()
    for (const key of Object.keys(bundles[DEFAULT_LOCALE])) {
      const expected = placeholders(bundles[DEFAULT_LOCALE][key])
      for (const locale of LOCALES) {
        expect({ key, locale, ph: placeholders(bundles[locale][key] ?? '') }).toEqual({
          key,
          locale,
          ph: expected,
        })
      }
    }
  })

  it('does not leave the old {{double-brace}} syntax behind', () => {
    for (const locale of LOCALES) {
      const stale = Object.entries(bundles[locale])
        .filter(([, v]) => v.includes('{{'))
        .map(([k]) => k)
      expect({ locale, stale }).toEqual({ locale, stale: [] })
    }
  })
})
