import { paraglideVitePlugin } from '@inlang/paraglide-js'
import tailwindcss from '@tailwindcss/vite'
import { devtools } from '@tanstack/devtools-vite'
import { tanstackStart } from '@tanstack/solid-start/plugin/vite'
import { nitro } from 'nitro/vite'
import { defineConfig } from 'vite'
import solidPlugin from 'vite-plugin-solid'
import { paraglideOptions } from './src/i18n/paraglide-options.ts'

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
    tanstackStart(),
    solidPlugin({ ssr: true }),
  ],
})
