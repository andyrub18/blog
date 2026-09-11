import type { ParaglideVitePluginOptions } from '@inlang/paraglide-js'

/**
 * Paraglide compiler options, shared by `vite.config.ts` and `vitest.config.ts`
 * so the two never drift.
 */
export const paraglideOptions: ParaglideVitePluginOptions = {
  project: './project.inlang',
  outdir: './src/paraglide',
  emitTsDeclarations: true,

  /**
   * The URL is the source of truth for language, because every page lives
   * under `/fr/...` or `/ht/...`. Order matters: `url` first means a link to
   * `/ht/atik` shows Creole even if the reader's cookie says French — a shared
   * link must show the language it points at.
   *
   * The cookie and `Accept-Language` only decide where an unprefixed URL like
   * `/` should go.
   */
  strategy: ['url', 'cookie', 'preferredLanguage', 'baseLocale'],

  /**
   * Reuse the app's existing `lang` cookie rather than Paraglide's default
   * `PARAGLIDE_LOCALE`. Two cookies would let the middleware and
   * `src/i18n/detect.ts` disagree about the reader's language.
   */
  cookieName: 'lang',

  /**
   * Both locales carry a prefix. Paraglide's default leaves the base locale
   * unprefixed (`/about` for French, `/ht/about` for Creole), which would make
   * French the implicit default in the URL. For a bilingual Haitian movement
   * neither language should be the one without a name.
   */
  urlPatterns: [
    {
      pattern: ':protocol://:domain(.*)::port?/:path(.*)?',
      localized: [
        ['fr', ':protocol://:domain(.*)::port?/fr/:path(.*)?'],
        ['ht', ':protocol://:domain(.*)::port?/ht/:path(.*)?'],
      ] as Array<[string, string]>,
    },
  ],
}
