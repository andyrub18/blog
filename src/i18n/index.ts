import { flatten, type Flatten } from '@solid-primitives/i18n'
import { fr, type Dict } from './locales/fr'
import { ht } from './locales/ht'

export const LOCALES = ['fr', 'ht'] as const
export type Locale = (typeof LOCALES)[number]
export const DEFAULT_LOCALE: Locale = 'fr'

export function isLocale(value: unknown): value is Locale {
  return typeof value === 'string' && (LOCALES as readonly string[]).includes(value)
}

const dictionaries: Record<Locale, Dict> = { fr, ht }

export type FlatDict = Flatten<Dict>

export function getFlatDictionary(locale: Locale): FlatDict {
  return flatten(dictionaries[locale])
}
