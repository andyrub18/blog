import { paraglideVitePlugin } from '@inlang/paraglide-js'
import tailwindcss from '@tailwindcss/vite'
import { devtools } from '@tanstack/devtools-vite'
import { tanstackStart } from '@tanstack/solid-start/plugin/vite'
import { nitro } from 'nitro/vite'
import { defineConfig, type Plugin, type ResolveModulePreloadDependenciesFn } from 'vite'
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

/**
 * Preload lists that name only what a page does not already have (D39).
 *
 * Every lazy import Vite writes carries the list of files to fetch alongside
 * it, and each route's stub, all of them in the entry, writes its list out in
 * full: the router, Solid, the message runtime, files every page loaded before
 * any route could ask for them. The browser skips those at run time, but every
 * reader downloaded their names, 4.6 KB of the reading view. The hook drops the
 * entry's own files, read from the finished bundle, and keeps the rest, so a
 * page still fetches what it needs in one round instead of a waterfall.
 *
 * Should Vite ever call the hook before this plugin has seen the bundle, the set
 * is empty and nothing is dropped: larger lists, never a missing file.
 */
function preloadOnlyWhatIsMissing(): {
  plugin: Plugin
  resolveDependencies: ResolveModulePreloadDependenciesFn
} {
  let alwaysLoaded = new Set<string>()
  return {
    plugin: {
      name: 'klea:preload-only-what-is-missing',
      applyToEnvironment: (environment) => environment.name === 'client',
      generateBundle(_, bundle) {
        const seen = new Set<string>()
        const visit = (fileName: string) => {
          if (seen.has(fileName)) return
          seen.add(fileName)
          const chunk = bundle[fileName]
          if (chunk?.type === 'chunk') chunk.imports.forEach(visit)
        }
        for (const chunk of Object.values(bundle)) {
          if (chunk.type === 'chunk' && chunk.isEntry) visit(chunk.fileName)
        }
        alwaysLoaded = seen
      },
    },
    resolveDependencies: (_, deps) => deps.filter((dep) => !alwaysLoaded.has(dep)),
  }
}

const preload = preloadOnlyWhatIsMissing()

export default defineConfig({
  resolve: { tsconfigPaths: true },
  build: { modulePreload: { resolveDependencies: preload.resolveDependencies } },
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
    preload.plugin,
    tanstackStart(),
    solidPlugin({ ssr: true }),
  ],
})
