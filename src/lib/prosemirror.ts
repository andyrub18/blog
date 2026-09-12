/**
 * The article document format: parse, validate, render.
 *
 * Pure functions, no IO and no framework, for two reasons. The first is the
 * same reason `validation.ts` is pure — the editor and the server function must
 * agree on what a document is, and the only way to be sure is to run the same
 * code. The second is the perf budget: rendering an article happens on the
 * server, so a reader downloads the finished HTML and none of this.
 *
 * It is also the security boundary for article content. Anything outside the
 * allowlist below is dropped at parse time, before storage (DECISIONS.md, D10).
 * Storing HTML instead would mean trusting whatever the editor produced, and
 * the editor runs on a computer we do not control.
 */

export type Mark = { type: string; attrs?: Record<string, string> }

export type DocNode = {
  type: string
  attrs?: Record<string, string | number>
  content?: Array<DocNode>
  marks?: Array<Mark>
  text?: string
}

/**
 * What an article may contain.
 *
 * Deliberately short. Every node here has an obvious meaning in a political
 * essay; anything that does not is a feature request, not an omission. Two
 * absences are decisions rather than oversights:
 *
 * - **No `image`.** There is no upload path yet (DECISIONS.md, D11 puts
 *   documents in managed object storage), and allowing an arbitrary `src` would
 *   let an article make every reader's browser fetch a URL somebody else
 *   controls — a reader-by-reader record of who read what, handed to a third
 *   party. It arrives with the upload pipeline or not at all.
 * - **No raw HTML node.** That is the hole this whole module exists to close.
 */
const BLOCK_NODES = [
  'paragraph',
  'heading',
  'blockquote',
  'bulletList',
  'orderedList',
  'listItem',
  'codeBlock',
  'horizontalRule',
] as const

const INLINE_NODES = ['text', 'hardBreak'] as const

export const ALLOWED_NODES: ReadonlyArray<string> = [...BLOCK_NODES, ...INLINE_NODES]

export const ALLOWED_MARKS = ['bold', 'italic', 'strike', 'code', 'link'] as const

/**
 * Headings start at level 2.
 *
 * The article title is the page's `h1`. A document that could emit its own
 * would give the page two, which is wrong for a screen reader walking the
 * outline and wrong for search engines. Levels are clamped rather than
 * rejected, because an author who typed the wrong heading level should not lose
 * their paragraph over it.
 */
export const MIN_HEADING_LEVEL = 2
export const MAX_HEADING_LEVEL = 4

/** Guards against a pathological document walking the renderer into a stack overflow. */
const MAX_DEPTH = 20

export type ParseError = 'NOT_A_DOCUMENT' | 'EMPTY'

export type ParseResult = { ok: true; doc: DocNode } | { ok: false; code: ParseError }

/**
 * Link targets we are willing to put in front of a reader.
 *
 * `javascript:` is the obvious one. `data:` is the one people forget: a
 * `data:text/html` link opens an attacker-authored page in the reader's
 * browser. Relative paths and anchors stay inside the site, so they are fine.
 *
 * Control characters are stripped before the check rather than after, because
 * `java\tscript:` is the classic way past a prefix test — browsers ignore the
 * whitespace, naive validators do not.
 */
export function isSafeHref(href: string): boolean {
  const value = href.trim()
  if (value === '') return false
  for (const char of value) {
    const code = char.codePointAt(0) ?? 0
    if (code < 0x20 || code === 0x7f) return false
  }
  if (value.startsWith('/') || value.startsWith('#')) return true
  return /^(https?:|mailto:)/i.test(value)
}

function sanitizeMarks(marks: unknown): Array<Mark> | undefined {
  if (!Array.isArray(marks)) return undefined
  const kept: Array<Mark> = []
  for (const mark of marks) {
    if (!mark || typeof mark !== 'object') continue
    const type = (mark as { type?: unknown }).type
    if (typeof type !== 'string') continue
    if (!(ALLOWED_MARKS as ReadonlyArray<string>).includes(type)) continue

    if (type === 'link') {
      const href = (mark as { attrs?: { href?: unknown } }).attrs?.href
      // A link whose destination we will not follow becomes plain text rather
      // than a dead anchor: the words the author wrote are still theirs.
      if (typeof href !== 'string' || !isSafeHref(href)) continue
      kept.push({ type: 'link', attrs: { href: href.trim() } })
      continue
    }
    kept.push({ type })
  }
  return kept.length > 0 ? kept : undefined
}

function sanitizeNode(value: unknown, depth: number): DocNode | null {
  if (depth > MAX_DEPTH) return null
  if (!value || typeof value !== 'object') return null

  const node = value as Record<string, unknown>
  const type = node.type
  if (typeof type !== 'string' || !ALLOWED_NODES.includes(type)) return null

  if (type === 'text') {
    if (typeof node.text !== 'string' || node.text === '') return null
    const marks = sanitizeMarks(node.marks)
    return marks
      ? { type: 'text', text: node.text, marks }
      : { type: 'text', text: node.text }
  }

  if (type === 'hardBreak' || type === 'horizontalRule') return { type }

  const content: Array<DocNode> = []
  if (Array.isArray(node.content)) {
    for (const child of node.content) {
      const parsed = sanitizeNode(child, depth + 1)
      if (parsed) content.push(parsed)
    }
  }

  const result: DocNode = { type, content }

  if (type === 'heading') {
    const raw = (node.attrs as { level?: unknown } | undefined)?.level
    const level =
      typeof raw === 'number' && Number.isFinite(raw)
        ? Math.round(raw)
        : MIN_HEADING_LEVEL
    result.attrs = {
      level: Math.min(MAX_HEADING_LEVEL, Math.max(MIN_HEADING_LEVEL, level)),
    }
  }

  if (type === 'codeBlock') {
    // The language only ever reaches the DOM inside a `language-…` class, and
    // only if it looks like a language name. No highlighter ships to readers.
    const raw = (node.attrs as { language?: unknown } | undefined)?.language
    if (typeof raw === 'string' && /^[a-z0-9+#-]{1,20}$/i.test(raw)) {
      result.attrs = { language: raw.toLowerCase() }
    }
  }

  return result
}

/**
 * Validate an untrusted document and return the version we are willing to store.
 *
 * Called on the server, on the way in. Unknown nodes, unknown marks and unsafe
 * link targets are dropped rather than rejected: an author pasting from a word
 * processor should get their text, not an error message about a node type they
 * have never heard of.
 */
export function parseDocument(value: unknown): ParseResult {
  if (!value || typeof value !== 'object') return { ok: false, code: 'NOT_A_DOCUMENT' }
  if ((value as { type?: unknown }).type !== 'doc') {
    return { ok: false, code: 'NOT_A_DOCUMENT' }
  }

  const content: Array<DocNode> = []
  const raw = (value as { content?: unknown }).content
  if (Array.isArray(raw)) {
    for (const child of raw) {
      const parsed = sanitizeNode(child, 1)
      if (parsed) content.push(parsed)
    }
  }

  const doc: DocNode = { type: 'doc', content }
  if (docToPlainText(doc).trim() === '') return { ok: false, code: 'EMPTY' }
  return { ok: true, doc }
}

/** The text of a document, for length checks, excerpts and reading time. */
export function docToPlainText(doc: DocNode): string {
  const parts: Array<string> = []
  const walk = (node: DocNode) => {
    if (node.type === 'text' && node.text) parts.push(node.text)
    if (node.type === 'hardBreak') parts.push(' ')
    for (const child of node.content ?? []) walk(child)
    if (BLOCK_NODES.includes(node.type as never)) parts.push('\n')
  }
  walk(doc)
  return parts
    .join('')
    .replace(/\n{2,}/g, '\n')
    .trim()
}

/**
 * Words per minute for the reading-time estimate.
 *
 * Low on purpose. These are dense political arguments read on a phone, often in
 * the reader's second language, and an estimate that flatters the reader
 * teaches them not to trust it.
 */
export const WORDS_PER_MINUTE = 180

export function readingTimeMinutes(doc: DocNode): number {
  const words = docToPlainText(doc).split(/\s+/).filter(Boolean).length
  return Math.max(1, Math.round(words / WORDS_PER_MINUTE))
}

const ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
}

export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => ESCAPES[char] as string)
}

const MARK_TAGS: Record<string, string> = {
  bold: 'strong',
  italic: 'em',
  strike: 's',
  code: 'code',
}

function renderMarks(text: string, marks: Array<Mark> | undefined): string {
  let html = escapeHtml(text)
  // Applied outward from the text, so the first mark in the list ends up
  // innermost — the order ProseMirror stores them in.
  for (const mark of marks ?? []) {
    if (mark.type === 'link') {
      const href = escapeHtml(mark.attrs?.href ?? '')
      // `noopener` is not decoration: without it a link opened in a new tab can
      // reach back through `window.opener` and navigate the article away.
      html = `<a href="${href}" rel="nofollow noopener noreferrer">${html}</a>`
      continue
    }
    const tag = MARK_TAGS[mark.type]
    if (tag) html = `<${tag}>${html}</${tag}>`
  }
  return html
}

const BLOCK_TAGS: Record<string, string> = {
  paragraph: 'p',
  blockquote: 'blockquote',
  bulletList: 'ul',
  orderedList: 'ol',
  listItem: 'li',
}

function renderNode(node: DocNode): string {
  if (node.type === 'text') return renderMarks(node.text ?? '', node.marks)
  if (node.type === 'hardBreak') return '<br />'
  if (node.type === 'horizontalRule') return '<hr />'

  const children = (node.content ?? []).map(renderNode).join('')

  if (node.type === 'heading') {
    const level = Number(node.attrs?.level ?? MIN_HEADING_LEVEL)
    return `<h${level}>${children}</h${level}>`
  }

  if (node.type === 'codeBlock') {
    const language = node.attrs?.language
    const attr = language ? ` class="language-${escapeHtml(String(language))}"` : ''
    return `<pre><code${attr}>${children}</code></pre>`
  }

  const tag = BLOCK_TAGS[node.type]
  if (!tag) return children
  // An empty paragraph is the author's blank line; dropping it would silently
  // reflow their text.
  if (tag === 'p' && children === '') return '<p></p>'
  return `<${tag}>${children}</${tag}>`
}

/**
 * Render a stored document to HTML, on the server.
 *
 * This is what keeps an article page near zero client JavaScript: the reader
 * gets finished markup, not a document plus a renderer to run it through. The
 * output is safe to hand to `innerHTML` because every string that reaches it
 * has been through `escapeHtml`, and because the only attributes emitted are
 * ones this function writes itself.
 */
export function renderDocumentToHtml(doc: DocNode): string {
  if (doc.type !== 'doc') return ''
  return (doc.content ?? []).map(renderNode).join('')
}

/** An empty document, for a new translation. */
export function emptyDocument(): DocNode {
  return { type: 'doc', content: [{ type: 'paragraph', content: [] }] }
}
