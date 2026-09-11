import { createContext, type ParentProps, useContext } from 'solid-js'
import type { Locale } from './index'

/**
 * Carries the active locale down the tree.
 *
 * Messages themselves are NOT held here. They are imported directly from the
 * Paraglide-generated module and called with an explicit `{ locale }`, which
 * keeps them tree-shakable and avoids any request-shared global locale state
 * during SSR (two requests in different languages must never interfere).
 */
const LocaleContext = createContext<() => Locale>()

export function I18nProvider(props: ParentProps<{ locale: Locale }>) {
  return <LocaleContext value={() => props.locale}>{props.children}</LocaleContext>
}

export function useLocale(): () => Locale {
  const ctx = useContext(LocaleContext)
  if (!ctx) throw new Error('useLocale must be used within an I18nProvider')
  return ctx
}
