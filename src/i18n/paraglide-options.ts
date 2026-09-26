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
   * Paraglide is the only thing that reads or writes the locale cookie, so the
   * name is ours to choose. `lang` is kept because it is what was already set
   * in readers' browsers.
   */
  cookieName: 'lang',

  /**
   * Both locales carry a prefix. Paraglide's default leaves the base locale
   * unprefixed (`/about` for French, `/ht/about` for Creole), which would make
   * French the implicit default in the URL. For a bilingual Haitian movement
   * neither language should be the one without a name.
   */
  /**
   * `/api/*` is not a page and has no localized form, so it is left alone.
   *
   * Without this, the `url` strategy treated every unprefixed path the same way:
   * a browser *navigating* to `/api/auth/verify-email?token=…` — which is what
   * clicking the link in a verification email is — was redirected with a 307 to
   * `/fr/api/auth/verify-email`, which does not exist. Nobody could verify an
   * address by clicking the link they were sent, a reviewer clicking a dossier
   * download got a 404, and so did anyone opening a companion PDF's URL in a tab
   * or from a forwarded link. (Clicking the PDF link on the article was spared
   * only because it carries `download`, which a browser does not send as a page
   * navigation.) A `fetch` is never redirected — the middleware only redirects
   * `Sec-Fetch-Dest: document` — which is why every test that fetched these
   * URLs passed. `e2e/api-routes.spec.ts` navigates instead.
   *
   * Excluded routes still run inside a locale scope, pinned to the base locale.
   * Nothing under `/api` renders a message to a person: the verification email
   * is sent from a server function, which keeps the request's real locale.
   */
  routeStrategies: [{ match: '/api/:path(.*)?', exclude: true }],

  urlPatterns: [
    {
      pattern: ':protocol://:domain(.*)::port?/:path(.*)?',
      localized: [
        ['fr', ':protocol://:domain(.*)::port?/fr/:path(.*)?'],
        ['ht', ':protocol://:domain(.*)::port?/ht/:path(.*)?'],
        ['en', ':protocol://:domain(.*)::port?/en/:path(.*)?'],
        ['es', ':protocol://:domain(.*)::port?/es/:path(.*)?'],
      ] as Array<[string, string]>,
    },
  ],
}
