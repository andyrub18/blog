import { type DocNode, escapeHtml } from './prosemirror'

/**
 * What changed between two versions of an article (D31).
 *
 * Pure: two documents in, markup out. Used where a person has to see a change
 * rather than take it on trust — a contradictor checking that version 4
 * answered the objections to version 3, a reader checking what the circle
 * approved since the text they read last month.
 *
 * Two passes. The documents are flattened into **blocks** — a heading, a
 * paragraph, a list item, a table row — and the blocks are aligned, so a
 * paragraph inserted at the top does not make every paragraph after it look
 * changed. A deleted block followed by an inserted block of the same kind is
 * then treated as one block **modified**, and compared word by word.
 *
 * What it does not show: a change of formatting alone (a word made bold, a
 * link's address) produces no word difference, so such a block is marked as
 * reformatted rather than silently passed as unchanged. And a change inside a
 * modified block is shown on its words, without the block's inline formatting —
 * the point of the view is what the text says.
 *
 * Every character of author text goes through `escapeHtml`; the tags are this
 * module's own. That is what makes the output safe to put in `innerHTML`, for
 * the same reason the reading view's is.
 */

type BlockKind = 'heading' | 'paragraph' | 'item' | 'quote' | 'code' | 'row' | 'rule'

type Block = {
  kind: BlockKind
  level?: number
  text: string
  /** The block's source, to tell "same words" from "same block". */
  source: string
}

export type DiffSummary = {
  added: number
  removed: number
  modified: number
  reformatted: number
}

export type DiffLabels = {
  /** "3 paragraphes inchangés", for a run of unchanged blocks collapsed away. */
  unchanged: (count: number) => string
  /** A short note on a block whose words are the same and formatting is not. */
  reformatted: string
}

export type DocumentDiff = {
  changed: boolean
  summary: DiffSummary
  html: string
}

/** Past this many cells a table of alignments is not worth building. */
const MAX_CELLS = 4_000_000

/** Unchanged blocks kept on each side of a change, for context. */
const CONTEXT = 1

function plainText(node: DocNode): string {
  const parts: Array<string> = []
  const walk = (current: DocNode) => {
    if (current.type === 'text' && current.text) parts.push(current.text)
    if (current.type === 'hardBreak') parts.push(' ')
    for (const child of current.content ?? []) walk(child)
  }
  walk(node)
  return parts.join('').replace(/\s+/g, ' ').trim()
}

function flatten(doc: DocNode): Array<Block> {
  const blocks: Array<Block> = []
  const push = (kind: BlockKind, node: DocNode, text = plainText(node), level?: number) =>
    blocks.push({ kind, level, text, source: JSON.stringify(node) })

  const visit = (node: DocNode, inQuote: boolean) => {
    switch (node.type) {
      case 'heading':
        push('heading', node, undefined, Number(node.attrs?.level ?? 2))
        return
      case 'paragraph':
        push(inQuote ? 'quote' : 'paragraph', node)
        return
      case 'codeBlock':
        push('code', node)
        return
      case 'horizontalRule':
        push('rule', node, '—')
        return
      case 'blockquote':
        for (const child of node.content ?? []) visit(child, true)
        return
      case 'bulletList':
      case 'orderedList':
        for (const item of node.content ?? []) visit(item, inQuote)
        return
      case 'listItem': {
        // The item's own text; a list nested inside it becomes items of its own.
        const own = (node.content ?? []).filter(
          (child) => child.type !== 'bulletList' && child.type !== 'orderedList',
        )
        push('item', { ...node, content: own }, own.map(plainText).join(' ').trim())
        for (const child of node.content ?? []) {
          if (child.type === 'bulletList' || child.type === 'orderedList')
            visit(child, inQuote)
        }
        return
      }
      case 'table':
        for (const row of node.content ?? []) {
          const cells = (row.content ?? []).map(plainText)
          push('row', row, cells.join(' | '))
        }
        return
      default:
        for (const child of node.content ?? []) visit(child, inQuote)
    }
  }
  for (const node of doc.content ?? []) visit(node, false)
  return blocks
}

type Op<T> = { kind: 'equal' | 'delete' | 'insert'; before?: T; after?: T }

/**
 * Align two sequences by their longest common subsequence.
 *
 * The common prefix and suffix are peeled off first, which is most of any real
 * edit, so the table is usually tiny. Past `MAX_CELLS` it is not built at all:
 * the middle is reported as removed and then added, which is coarse but true.
 */
function align<T>(
  before: Array<T>,
  after: Array<T>,
  key: (item: T) => string,
): Array<Op<T>> {
  let start = 0
  while (
    start < before.length &&
    start < after.length &&
    key(before[start]) === key(after[start])
  ) {
    start += 1
  }
  let endBefore = before.length
  let endAfter = after.length
  while (
    endBefore > start &&
    endAfter > start &&
    key(before[endBefore - 1]) === key(after[endAfter - 1])
  ) {
    endBefore -= 1
    endAfter -= 1
  }

  const head: Array<Op<T>> = before
    .slice(0, start)
    .map((item, i) => ({ kind: 'equal', before: item, after: after[i] }))
  const tail: Array<Op<T>> = before
    .slice(endBefore)
    .map((item, i) => ({ kind: 'equal', before: item, after: after[endAfter + i] }))

  const a = before.slice(start, endBefore)
  const b = after.slice(start, endAfter)
  const middle: Array<Op<T>> = []

  if ((a.length + 1) * (b.length + 1) > MAX_CELLS) {
    for (const item of a) middle.push({ kind: 'delete', before: item })
    for (const item of b) middle.push({ kind: 'insert', after: item })
    return [...head, ...middle, ...tail]
  }

  const width = b.length + 1
  const table = new Uint32Array((a.length + 1) * width)
  for (let i = a.length - 1; i >= 0; i -= 1) {
    for (let j = b.length - 1; j >= 0; j -= 1) {
      table[i * width + j] =
        key(a[i]) === key(b[j])
          ? table[(i + 1) * width + j + 1] + 1
          : Math.max(table[(i + 1) * width + j], table[i * width + j + 1])
    }
  }
  let i = 0
  let j = 0
  while (i < a.length && j < b.length) {
    if (key(a[i]) === key(b[j])) {
      middle.push({ kind: 'equal', before: a[i], after: b[j] })
      i += 1
      j += 1
    } else if (table[(i + 1) * width + j] >= table[i * width + j + 1]) {
      middle.push({ kind: 'delete', before: a[i] })
      i += 1
    } else {
      middle.push({ kind: 'insert', after: b[j] })
      j += 1
    }
  }
  for (; i < a.length; i += 1) middle.push({ kind: 'delete', before: a[i] })
  for (; j < b.length; j += 1) middle.push({ kind: 'insert', after: b[j] })
  return [...head, ...middle, ...tail]
}

/** Words and the whitespace between them, so a rejoined diff reads naturally. */
const tokens = (text: string) => text.split(/(\s+)/).filter((token) => token.length > 0)

/** A word-level comparison of two strings, as escaped inline markup. */
export function diffText(before: string, after: string): string {
  return align(tokens(before), tokens(after), (token) => token)
    .map((op) => {
      if (op.kind === 'equal') return escapeHtml(op.after as string)
      if (op.kind === 'delete') return `<del>${escapeHtml(op.before as string)}</del>`
      return `<ins>${escapeHtml(op.after as string)}</ins>`
    })
    .join('')
    .replace(/<\/del><del>/g, '')
    .replace(/<\/ins><ins>/g, '')
}

function wrap(block: Block, inner: string, className?: string): string {
  const cls = className ? ` class="${className}"` : ''
  switch (block.kind) {
    case 'heading': {
      const level = Math.min(Math.max(block.level ?? 2, 2), 4)
      return `<h${level}${cls}>${inner}</h${level}>`
    }
    case 'quote':
      return `<blockquote${cls}><p>${inner}</p></blockquote>`
    case 'code':
      return `<pre${cls}><code>${inner}</code></pre>`
    case 'rule':
      return `<hr${cls}>`
    case 'item':
      return `<p class="diff-item${className ? ` ${className}` : ''}">${inner}</p>`
    case 'row':
      return `<p class="diff-row${className ? ` ${className}` : ''}">${inner}</p>`
    default:
      return `<p${cls}>${inner}</p>`
  }
}

type Piece =
  | { kind: 'equal'; block: Block }
  | { kind: 'reformatted'; block: Block }
  | { kind: 'added'; block: Block }
  | { kind: 'removed'; block: Block }
  | { kind: 'modified'; before: Block; after: Block }

const blockKey = (block: Block) => `${block.kind}:${block.level ?? ''}\u0000${block.text}`

function pieces(before: Array<Block>, after: Array<Block>): Array<Piece> {
  const ops = align(before, after, blockKey)
  const result: Array<Piece> = []
  let i = 0
  while (i < ops.length) {
    const op = ops[i]
    if (op.kind === 'equal') {
      const same = op.before?.source === op.after?.source
      result.push({ kind: same ? 'equal' : 'reformatted', block: op.after as Block })
      i += 1
      continue
    }
    // A run of removals and insertions between two unchanged blocks: pair them
    // in order, same kind with same kind, as modifications of one another.
    const removed: Array<Block> = []
    const added: Array<Block> = []
    while (i < ops.length && ops[i].kind !== 'equal') {
      if (ops[i].kind === 'delete') removed.push(ops[i].before as Block)
      else added.push(ops[i].after as Block)
      i += 1
    }
    while (removed.length > 0 || added.length > 0) {
      const gone = removed[0]
      const come = added[0]
      if (gone && come && gone.kind === come.kind) {
        result.push({ kind: 'modified', before: gone, after: come })
        removed.shift()
        added.shift()
      } else if (gone && (!come || removed.length >= added.length)) {
        result.push({ kind: 'removed', block: gone })
        removed.shift()
      } else if (come) {
        result.push({ kind: 'added', block: come })
        added.shift()
      }
    }
  }
  return result
}

/**
 * Compare two documents. `before` is null for a first version, which has no
 * change to show — the caller says "first version" rather than rendering the
 * whole text as inserted.
 */
export function diffDocuments(
  before: DocNode | null,
  after: DocNode,
  labels: DiffLabels,
): DocumentDiff {
  const summary: DiffSummary = { added: 0, removed: 0, modified: 0, reformatted: 0 }
  if (!before) return { changed: false, summary, html: '' }

  const list = pieces(flatten(before), flatten(after))
  const isChange = (piece: Piece) => piece.kind !== 'equal'
  // Which unchanged blocks to keep: those within CONTEXT of a change.
  const keep = list.map((_, index) =>
    list
      .slice(Math.max(0, index - CONTEXT), index + CONTEXT + 1)
      .some((piece) => isChange(piece)),
  )

  const out: Array<string> = []
  let skipped = 0
  const flushSkipped = () => {
    if (skipped > 0) {
      out.push(`<p class="diff-skip">${escapeHtml(labels.unchanged(skipped))}</p>`)
      skipped = 0
    }
  }
  list.forEach((piece, index) => {
    if (piece.kind === 'equal' && !keep[index]) {
      skipped += 1
      return
    }
    flushSkipped()
    switch (piece.kind) {
      case 'equal':
        out.push(wrap(piece.block, escapeHtml(piece.block.text), 'diff-context'))
        break
      case 'reformatted':
        summary.reformatted += 1
        out.push(
          wrap(
            piece.block,
            `${escapeHtml(piece.block.text)} <span class="diff-note">${escapeHtml(labels.reformatted)}</span>`,
            'diff-reformatted',
          ),
        )
        break
      case 'added':
        summary.added += 1
        out.push(
          wrap(piece.block, `<ins>${escapeHtml(piece.block.text)}</ins>`, 'diff-added'),
        )
        break
      case 'removed':
        summary.removed += 1
        out.push(
          wrap(piece.block, `<del>${escapeHtml(piece.block.text)}</del>`, 'diff-removed'),
        )
        break
      case 'modified':
        summary.modified += 1
        out.push(
          wrap(
            piece.after,
            diffText(piece.before.text, piece.after.text),
            'diff-modified',
          ),
        )
        break
    }
  })
  flushSkipped()

  const changed = list.some(isChange)
  return { changed, summary, html: changed ? out.join('') : '' }
}
