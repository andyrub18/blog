#!/usr/bin/env node
/**
 * What a reader actually downloads, per page.
 *
 * The budget in `docs/ROADMAP.md` is "under 100 KB gzipped of client JS **for an
 * article page**", and totalling every chunk in `.output/public/assets` does not
 * measure that — it measures the whole site, editor included, which is a number
 * no reader ever pays. It read 280 KB while an article page was 103 KB, which is
 * the kind of gauge people stop looking at.
 *
 * This walks Vite's manifest instead and sums the *static* import closure of the
 * entry plus one route: the chunks the browser must have before that page is
 * interactive. Dynamic imports are deliberately not followed — TipTap is reached
 * that way, and the whole point is that an article page never fetches it.
 *
 * Run `npm run build` first, then `npm run budget`.
 */
import { gzipSync } from 'node:zlib'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const PUBLIC = '.output/public'
const BUDGET_KB = 100

let manifest
try {
  manifest = JSON.parse(readFileSync(join(PUBLIC, '.vite/manifest.json'), 'utf8'))
} catch {
  console.error('No build found. Run `npm run build` first.')
  process.exit(1)
}

/** Every chunk the browser needs before this one can run. */
function closure(keys) {
  const seen = new Set()
  const stack = [...keys]
  while (stack.length > 0) {
    const key = stack.pop()
    if (seen.has(key) || !manifest[key]) continue
    seen.add(key)
    // `imports` only. `dynamicImports` are the chunks that arrive later, on
    // demand, which is exactly what we are trying to keep off this page.
    stack.push(...(manifest[key].imports ?? []))
  }
  return seen
}

const gzipCache = new Map()
function gzipped(file) {
  if (!gzipCache.has(file)) {
    try {
      gzipCache.set(file, gzipSync(readFileSync(join(PUBLIC, file))).length)
    } catch {
      gzipCache.set(file, 0)
    }
  }
  return gzipCache.get(file)
}

function weigh(keys) {
  const chunks = []
  for (const key of closure(keys)) {
    const file = manifest[key]?.file
    if (file?.endsWith('.js')) chunks.push([gzipped(file), file])
  }
  return { bytes: chunks.reduce((sum, [n]) => sum + n, 0), chunks }
}

const entry = Object.keys(manifest).filter((k) => manifest[k].isEntry)

/**
 * The manifest keys for one route file.
 *
 * A route appears as `…/$slug.tsx` and again as `…/$slug.tsx?tsr-split=component`
 * — the split the router does so a route's component is fetched rather than
 * bundled into the entry. Matching that query is why this is not a plain lookup.
 *
 * It is anchored on `.tsx` rather than being a bare prefix, which it once was:
 * a bare prefix also matched `$slug_/discussion.tsx`, and charged the reading
 * view 6 KB for a page it only links to. A measurement that silently counts a
 * neighbouring route is worse than no measurement, because it is believed.
 */
const routeKey = (path) =>
  Object.keys(manifest).filter((k) => k === `${path}.tsx` || k.startsWith(`${path}.tsx?`))

/**
 * A third entry of `null` means the page is held to the budget; a string is the
 * reason it is not, printed next to the number.
 *
 * Only two pages are exempt, and both are pages somebody opens on purpose
 * rather than arrives on. The budget is about the reader who taps a link on
 * mobile data having heard about KLE — measuring the others is still useful,
 * which is why they are here at all rather than left unmeasured.
 */
const PAGES = [
  ['the shared entry, on every page', [], null],
  ['/articles/{slug} — the reading view', routeKey('src/routes/_app/articles/$slug'), null],
  ['/articles', routeKey('src/routes/_app/articles/index'), null],
  ['/ — the home page', routeKey('src/routes/_app/index'), null],
  [
    '/articles/{slug}/discussion — the forum',
    routeKey('src/routes/_app/articles/$slug_/discussion'),
    '(opened from an article, and interactive: the thread itself is 6 KB)',
  ],
  [
    '/write/{id} — the editor, before TipTap',
    routeKey('src/routes/_app/write/$articleId'),
    '(author screen)',
  ],
]

const article = weigh([...entry, ...routeKey('src/routes/_app/articles/$slug')])

console.log('client JS, gzipped, per page (static imports only)\n')
for (const [label, keys, exemption] of PAGES) {
  const { bytes } = weigh([...entry, ...keys])
  const note = exemption
    ? `  ${exemption}`
    : bytes / 1024 > BUDGET_KB
      ? '  ← over budget'
      : ''
  console.log(`  ${(bytes / 1024).toFixed(1).padStart(6)} KB  ${label}${note}`)
}

console.log('\nthe ten heaviest chunks an article page loads:')
for (const [n, file] of article.chunks.sort((a, b) => b[0] - a[0]).slice(0, 10)) {
  console.log(`  ${(n / 1024).toFixed(1).padStart(6)} KB  ${file.replace('assets/', '')}`)
}

const kb = article.bytes / 1024
console.log(
  `\nBudget: under ${BUDGET_KB} KB for an article page. ` +
    `Currently ${kb.toFixed(1)} KB — ${kb < BUDGET_KB ? `${(BUDGET_KB - kb).toFixed(1)} KB of headroom` : `OVER by ${(kb - BUDGET_KB).toFixed(1)} KB`}.`,
)

// Every route's non-component module sits in the entry graph, so the entry grows
// with the number of routes whether or not anybody visits them. Saying so here
// is the difference between noticing that trend and rediscovering it each phase.
const perRoute = article.chunks.filter(([n]) => n <= 1024).length
console.log(
  `${perRoute} small chunks in that total are route and server-function stubs; ` +
    `each new route adds roughly 0.5 KB to every page.`,
)

process.exit(kb < BUDGET_KB ? 0 : 1)
