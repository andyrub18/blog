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
const routeKey = (path) => Object.keys(manifest).filter((k) => k.startsWith(path))

/**
 * `reader: true` means the page is held to the budget.
 *
 * The editor is an author's screen — somebody who has been admitted by dossier,
 * on a connection they chose to write from. The budget is about the reader who
 * arrives on mobile data having heard about KLE, so measuring the write route
 * here is useful without it being a failure.
 */
const PAGES = [
  ['the shared entry, on every page', [], true],
  ['/articles/{slug} — the reading view', routeKey('src/routes/_app/articles/$slug'), true],
  ['/articles', routeKey('src/routes/_app/articles/index'), true],
  ['/ — the home page', routeKey('src/routes/_app/index'), true],
  ['/write/{id} — the editor, before TipTap', routeKey('src/routes/_app/write/$articleId'), false],
]

const article = weigh([...entry, ...routeKey('src/routes/_app/articles/$slug')])

console.log('client JS, gzipped, per page (static imports only)\n')
for (const [label, keys, reader] of PAGES) {
  const { bytes } = weigh([...entry, ...keys])
  const note = !reader
    ? '  (author screen, not held to the budget)'
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
