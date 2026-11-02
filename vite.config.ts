import { paraglideVitePlugin } from '@inlang/paraglide-js'
import tailwindcss from '@tailwindcss/vite'
import { devtools } from '@tanstack/devtools-vite'
import { tanstackStart } from '@tanstack/solid-start/plugin/vite'
import { nitro } from 'nitro/vite'
import { defineConfig, type Plugin } from 'vite'
import solidPlugin from 'vite-plugin-solid'
import { paraglideOptions } from './src/i18n/paraglide-options.ts'

/**
 * Paraglide's runtime imports a `URLPattern` polyfill for every browser: 6.1 KB
 * gzipped on every page, though nearly every phone now has `URLPattern` built
 * in. In the client build that import becomes an empty module, and
 * `src/client.tsx` fetches the polyfill only where it is missing. The server
 * keeps the import as it is; there it costs a reader nothing.
 */
function urlPatternOnDemand(): Plugin {
  const empty = '\0klea:empty-module'
  return {
    name: 'klea:urlpattern-on-demand',
    enforce: 'pre',
    resolveId(id) {
      if (
        id === '@inlang/paraglide-js/urlpattern-polyfill' &&
        this.environment?.name === 'client'
      ) {
        return empty
      }
    },
    load(id) {
      if (id === empty) return 'export {}'
    },
  }
}

export default defineConfig({
  resolve: { tsconfigPaths: true },
  plugins: [
    devtools(),
    // `src/boot.ts` runs the production guards when the server starts, not on
    // its first request.
    nitro({ plugins: ['./src/boot.ts'] }),
    tailwindcss(),
    // Compile-time i18n: messages become tree-shakable functions, so the
    // bundle does not grow as locales or messages are added.
    paraglideVitePlugin(paraglideOptions),
    urlPatternOnDemand(),
    tanstackStart(),
    solidPlugin({ ssr: true }),
  ],
})
