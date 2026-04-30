import { createContext, useContext, type ParentComponent } from 'solid-js'
import { resolveTemplate, translator } from '@solid-primitives/i18n'
import { getFlatDictionary, type FlatDict, type Locale } from './index'

type I18nValue = {
  locale: () => Locale
  t: ReturnType<typeof translator<FlatDict>>
}

const I18nContext = createContext<I18nValue>()

export const I18nProvider: ParentComponent<{ locale: Locale }> = (props) => {
  const dict = () => getFlatDictionary(props.locale)
  const t = translator(dict, resolveTemplate)
  const value: I18nValue = {
    locale: () => props.locale,
    t,
  }
  return <I18nContext.Provider value={value}>{props.children}</I18nContext.Provider>
}

export function useI18n(): I18nValue {
  const ctx = useContext(I18nContext)
  if (!ctx) throw new Error('useI18n must be used within an I18nProvider')
  return ctx
}
