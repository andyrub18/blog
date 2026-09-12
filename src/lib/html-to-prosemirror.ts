import { parseDocument } from 'htmlparser2'
import type { DocNode, Mark } from './prosemirror'
import {
  ALLOWED_NODES,
  isSafeHref,
  MAX_HEADING_LEVEL,
  MIN_HEADING_LEVEL,
} from './prosemirror'

/**
 * HTML in, our document format out.
 *
 * **This is the sanitiser.** Mammoth's own documentation is explicit that it
 * performs no sanitisation and that a Word file can carry `javascript:` links
 * which become executable if the output is embedded uncleaned. The usual answer
 * is to run the HTML through an allowlist sanitiser and then parse it; this does
 * the two in one pass, and the result is stronger than the usual answer.
 *
 * The reason is that the output is not HTML. Nothing here copies a tag through —
 * every node is *rebuilt* from the small vocabulary in `prosemirror.ts`, and an
 * element with no entry in `BLOCK_TAGS` or `MARKS` below cannot produce
 * anything, whatever it contains. A sanitiser has to enumerate what is
 * dangerous. This enumerates what is allowed, and the stored document is by
 * construction something our editor can represent and our renderer can render.
 *
 * It runs on the server only, but has no IO and no framework, so it is tested
 * directly.
 */

/** What an author is told happened to their file. */
export type ImportReport = {
  /** Counts by kind, for the things that made it: `heading`, `table`, `link`… */
  kept: Record<string, number>
  /**
   * Counts by kind, for the things that did not.
   *
   * Named rather than totalled. "Dropped 4 things" tells an author nothing;
   * "dropped 3 images, 1 text box" tells them what to go and look at, which is
   * the difference between a report and a shrug.
   */
  dropped: Record<string, number>
}

type Ctx = {
  report: ImportReport
  depth: number
  /**
   * Whether we are inside a cell, a list item or a quote.
   *
   * The report counts what the *author* would recognise. Every table cell holds
   * a paragraph, structurally, but nobody writing a budget table thinks of
   * themselves as having written twelve paragraphs — reporting it that way
   * would drown the number that matters.
   */
  nested: boolean
}

function count(bag: Record<string, number>, kind: string, by = 1) {
  bag[kind] = (bag[kind] ?? 0) + by
}

/** Guards a pathological document from walking the converter into a stack overflow. */
const MAX_DEPTH = 30

/** Block-level elements, mapped to what they become. */
const BLOCK_TAGS: Record<string, string> = {
  p: 'paragraph',
  div: 'paragraph',
  blockquote: 'blockquote',
  ul: 'bulletList',
  ol: 'orderedList',
  li: 'listItem',
  pre: 'codeBlock',
  hr: 'horizontalRule',
  table: 'table',
  tr: 'tableRow',
  th: 'tableHeader',
  td: 'tableCell',
}

/** Elements that carry nothing themselves: keep their children, drop the wrapper. */
const TRANSPARENT = new Set([
  'body',
  'html',
  'head',
  'article',
  'section',
  'main',
  'tbody',
  'thead',
  'tfoot',
  'span',
  'font',
])

/** Inline elements that become marks. Anything else inline is unwrapped to its text. */
const MARKS: Record<string, string> = {
  strong: 'bold',
  b: 'bold',
  em: 'italic',
  i: 'italic',
  s: 'strike',
  del: 'strike',
  strike: 'strike',
  code: 'code',
}

/**
 * Elements worth naming in the report when they are dropped.
 *
 * Everything else unknown is counted as `other`. These are the ones an author
 * will go looking for, because they could see them in Word.
 */
const NAMED_DROPS: Record<string, string> = {
  img: 'image',
  image: 'image',
  picture: 'image',
  figure: 'image',
  math: 'equation',
  object: 'embedded object',
  embed: 'embedded object',
  iframe: 'embedded object',
  video: 'video',
  audio: 'audio',
  script: 'script',
  style: 'style',
  input: 'form field',
  textarea: 'form field',
}

type DomNode = {
  type: string
  name?: string
  data?: string
  attribs?: Record<string, string>
  children?: Array<DomNode>
}

const isText = (node: DomNode) => node.type === 'text'
const isTag = (node: DomNode) =>
  node.type === 'tag' || node.type === 'script' || node.type === 'style'

function headingLevel(name: string): number {
  const level = Number(name.slice(1))
  return Math.min(
    MAX_HEADING_LEVEL,
    Math.max(MIN_HEADING_LEVEL, level || MIN_HEADING_LEVEL),
  )
}

/** Inline conversion: produces `text` and `hardBreak` nodes, carrying marks down. */
function inline(nodes: Array<DomNode>, marks: Array<Mark>, ctx: Ctx): Array<DocNode> {
  if (ctx.depth > MAX_DEPTH) return []
  const out: Array<DocNode> = []

  for (const node of nodes) {
    if (isText(node)) {
      // Word documents are full of newlines and indentation that mean nothing;
      // a run of whitespace in running text is one space.
      const value = (node.data ?? '').replace(/\s+/g, ' ')
      if (value === '') continue
      out.push(
        marks.length > 0
          ? { type: 'text', text: value, marks }
          : { type: 'text', text: value },
      )
      continue
    }
    if (!isTag(node)) continue

    const name = (node.name ?? '').toLowerCase()

    if (name === 'br') {
      out.push({ type: 'hardBreak' })
      continue
    }

    if (name === 'a') {
      const href = node.attribs?.href ?? ''
      if (isSafeHref(href)) {
        count(ctx.report.kept, 'link')
        out.push(
          ...inline(
            node.children ?? [],
            [...marks, { type: 'link', attrs: { href: href.trim() } }],
            {
              ...ctx,
              depth: ctx.depth + 1,
            },
          ),
        )
      } else {
        // The words stay, the destination does not. This is the case mammoth
        // warns about, and it arrives as ordinary-looking text.
        count(ctx.report.dropped, 'unsafe link')
        out.push(...inline(node.children ?? [], marks, { ...ctx, depth: ctx.depth + 1 }))
      }
      continue
    }

    const mark = MARKS[name]
    if (mark) {
      out.push(
        ...inline(node.children ?? [], [...marks, { type: mark }], {
          ...ctx,
          depth: ctx.depth + 1,
        }),
      )
      continue
    }

    if (NAMED_DROPS[name]) {
      count(ctx.report.dropped, NAMED_DROPS[name])
      continue
    }

    // `u`, `sup`, `sub`, `span` and the rest: the emphasis is not in our
    // vocabulary, but the author's words are, so the text comes through
    // unmarked rather than disappearing.
    if (name === 'u') count(ctx.report.dropped, 'underline')
    out.push(...inline(node.children ?? [], marks, { ...ctx, depth: ctx.depth + 1 }))
  }

  return out
}

/** Wrap loose inline content, because a block node's children must be blocks. */
function asBlocks(children: Array<DocNode>): Array<DocNode> {
  const out: Array<DocNode> = []
  let run: Array<DocNode> = []
  const flush = () => {
    if (run.length > 0) {
      out.push({ type: 'paragraph', content: run })
      run = []
    }
  }
  for (const child of children) {
    if (child.type === 'text' || child.type === 'hardBreak') run.push(child)
    else {
      flush()
      out.push(child)
    }
  }
  flush()
  return out
}

function spanAttrs(node: DomNode): Record<string, number> | undefined {
  const attrs: Record<string, number> = {}
  for (const key of ['colspan', 'rowspan'] as const) {
    const raw = Number(node.attribs?.[key])
    if (Number.isFinite(raw) && raw > 1) attrs[key] = Math.round(raw)
  }
  return Object.keys(attrs).length > 0 ? attrs : undefined
}

/** Block conversion. Anything that is not a block here is gathered into paragraphs. */
function blocks(nodes: Array<DomNode>, ctx: Ctx): Array<DocNode> {
  if (ctx.depth > MAX_DEPTH) return []
  const out: Array<DocNode> = []
  let inlineRun: Array<DomNode> = []

  const flushInline = () => {
    if (inlineRun.length === 0) return
    const content = inline(inlineRun, [], { ...ctx, depth: ctx.depth + 1 })
    inlineRun = []
    if (content.length === 0) return
    if (content.every((n) => n.type === 'text' && (n.text ?? '').trim() === '')) return
    if (!ctx.nested) count(ctx.report.kept, 'paragraph')
    out.push({ type: 'paragraph', content })
  }

  for (const node of nodes) {
    if (isText(node)) {
      inlineRun.push(node)
      continue
    }
    if (!isTag(node)) continue

    const name = (node.name ?? '').toLowerCase()

    if (TRANSPARENT.has(name)) {
      flushInline()
      out.push(...blocks(node.children ?? [], { ...ctx, depth: ctx.depth + 1 }))
      continue
    }

    if (NAMED_DROPS[name]) {
      flushInline()
      count(ctx.report.dropped, NAMED_DROPS[name])
      continue
    }

    if (/^h[1-9]$/.test(name)) {
      flushInline()
      count(ctx.report.kept, 'heading')
      out.push({
        type: 'heading',
        attrs: { level: headingLevel(name) },
        content: inline(node.children ?? [], [], { ...ctx, depth: ctx.depth + 1 }),
      })
      continue
    }

    const block = BLOCK_TAGS[name]
    if (!block) {
      // Unknown block-ish element: keep whatever is inside it rather than the
      // element. A Word text box arrives as something we have no node for, and
      // its sentences are still the author's.
      flushInline()
      count(ctx.report.dropped, 'other')
      out.push(...blocks(node.children ?? [], { ...ctx, depth: ctx.depth + 1 }))
      continue
    }

    flushInline()

    if (block === 'horizontalRule') {
      out.push({ type: 'horizontalRule' })
      continue
    }

    if (block === 'codeBlock') {
      count(ctx.report.kept, 'code block')
      out.push({
        type: 'codeBlock',
        content: inline(node.children ?? [], [], { ...ctx, depth: ctx.depth + 1 }),
      })
      continue
    }

    const nested = block !== 'table' && block !== 'tableRow'
    const inner = blocks(node.children ?? [], {
      ...ctx,
      depth: ctx.depth + 1,
      nested: ctx.nested || nested,
    })

    if (block === 'table') {
      // Only rows may live in a table, and a table with no rows is not a table.
      const rows = inner.filter((child) => child.type === 'tableRow')
      if (rows.length === 0) continue
      count(ctx.report.kept, 'table')
      out.push({ type: 'table', content: rows })
      continue
    }

    if (block === 'tableRow') {
      const cells = inner.filter(
        (child) => child.type === 'tableCell' || child.type === 'tableHeader',
      )
      if (cells.length === 0) continue
      out.push({ type: 'tableRow', content: cells })
      continue
    }

    if (block === 'tableCell' || block === 'tableHeader') {
      const content = asBlocks(inner)
      out.push({
        type: block,
        ...(spanAttrs(node) ? { attrs: spanAttrs(node) } : {}),
        // An empty cell is still a cell; the table's shape depends on it.
        content: content.length > 0 ? content : [{ type: 'paragraph', content: [] }],
      })
      continue
    }

    if (block === 'bulletList' || block === 'orderedList') {
      const items = inner.filter((child) => child.type === 'listItem')
      if (items.length === 0) continue
      count(ctx.report.kept, 'list')
      out.push({ type: block, content: items })
      continue
    }

    if (block === 'listItem') {
      const content = asBlocks(inner)
      out.push({
        type: 'listItem',
        content: content.length > 0 ? content : [{ type: 'paragraph', content: [] }],
      })
      continue
    }

    if (block === 'blockquote') {
      count(ctx.report.kept, 'quote')
      out.push({ type: 'blockquote', content: asBlocks(inner) })
      continue
    }

    // `p` and `div`.
    const content = inline(node.children ?? [], [], { ...ctx, depth: ctx.depth + 1 })
    if (content.length === 0) continue
    if (!ctx.nested) count(ctx.report.kept, 'paragraph')
    out.push({ type: 'paragraph', content })
  }

  flushInline()
  return out.filter((node) => ALLOWED_NODES.includes(node.type))
}

/**
 * Convert one HTML document into our format, and say what happened to it.
 *
 * The report is the point as much as the document is. An import that silently
 * loses a table and goes straight to review burns a reviewer's evening and the
 * author's trust; one that says "kept 12 headings and 3 tables, dropped 5
 * images" sends the author back to their file before anybody else reads it.
 */
export function htmlToDocument(html: string): { doc: DocNode; report: ImportReport } {
  const report: ImportReport = { kept: {}, dropped: {} }
  const dom = parseDocument(html, { decodeEntities: true }) as unknown as {
    children: Array<DomNode>
  }
  const content = blocks(dom.children ?? [], { report, depth: 0, nested: false })
  return { doc: { type: 'doc', content }, report }
}
