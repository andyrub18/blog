import { createContext, useContext, type ParentComponent } from 'solid-js'
import { resolveTemplate, translator } from '@solid-primitives/i18n'
import { getFlatDictionary, type FlatDict, type Locale } from './index'

type Translate = ReturnType<typeof translator<FlatDict>>

type I18nValue = {
  locale: () => Locale
  t: Translate
  tx: (key: Parameters<Translate>[0]) => string
}

const I18nContext = createContext<I18nValue>()

export const I18nProvider: ParentComponent<{ locale: Locale }> = (props) => {
  const dict = () => getFlatDictionary(props.locale)
  const t = translator(dict, resolveTemplate)
  const tx: I18nValue['tx'] = (key) => {
    const v = t(key as Parameters<Translate>[0])
    return typeof v === 'string' ? v : ''
  }
  const value: I18nValue = {
    locale: () => props.locale,
    t,
    tx,
  }
  return <I18nContext.Provider value={value}>{props.children}</I18nContext.Provider>
}

export function useI18n(): I18nValue {
  const ctx = useContext(I18nContext)
  if (!ctx) throw new Error('useI18n must be used within an I18nProvider')
  return ctx
}
