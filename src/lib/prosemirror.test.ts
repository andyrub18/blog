import { describe, expect, it } from 'vitest'
import {
  type DocNode,
  docToPlainText,
  emptyDocument,
  escapeHtml,
  isSafeHref,
  parseDocument,
  readingTimeMinutes,
  renderDocumentToHtml,
} from './prosemirror'

/**
 * These test the rule, not the implementation.
 *
 * The rule is that a document coming from a browser cannot put script, an
 * attacker-chosen URL scheme, or markup of its own choosing in front of a
 * reader. That is the security property; how the walker is written is not.
 */

const doc = (...content: Array<unknown>): unknown => ({ type: 'doc', content })
const para = (...content: Array<unknown>) => ({ type: 'paragraph', content })
const textNode = (value: string, marks?: Array<unknown>) => ({
  type: 'text',
  text: value,
  ...(marks ? { marks } : {}),
})
const text = textNode

function render(input: unknown): string {
  const parsed = parseDocument(input)
  if (!parsed.ok) throw new Error(`expected a document, got ${parsed.code}`)
  return renderDocumentToHtml(parsed.doc)
}

describe('parseDocument', () => {
  it('refuses anything that is not a ProseMirror document', () => {
    for (const value of [null, 'hello', 42, [], { type: 'paragraph' }]) {
      const result = parseDocument(value)
      expect(result.ok).toBe(false)
      if (!result.ok) expect(result.code).toBe('NOT_A_DOCUMENT')
    }
  })

  it('refuses a document with no text in it', () => {
    const result = parseDocument(doc(para()))
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.code).toBe('EMPTY')
  })

  it('keeps the text but drops nodes outside the allowlist', () => {
    const parsed = parseDocument(
      doc(
        { type: 'script', content: [text('alert(1)')] },
        { type: 'iframe', attrs: { src: 'https://evil.example' } },
        para(text('Diagnostic')),
      ),
    )
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    expect(parsed.doc.content).toHaveLength(1)
    expect(docToPlainText(parsed.doc)).toBe('Diagnostic')
  })

  it('drops marks outside the allowlist and keeps the words', () => {
    const html = render(
      doc(para(text('Ayiti', [{ type: 'evilMark' }, { type: 'bold' }]))),
    )
    expect(html).toBe('<p><strong>Ayiti</strong></p>')
  })

  it('drops attributes the author invented', () => {
    const parsed = parseDocument(
      doc({
        type: 'paragraph',
        attrs: { onclick: 'steal()', style: 'position:fixed' },
        content: [text('bonjou')],
      }),
    )
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    expect(parsed.doc.content?.[0]?.attrs).toBeUndefined()
  })

  it('clamps headings into the range below the page title', () => {
    const html = render(
      doc(
        { type: 'heading', attrs: { level: 1 }, content: [text('Trop haut')] },
        { type: 'heading', attrs: { level: 9 }, content: [text('Trop bas')] },
        { type: 'heading', attrs: { level: 3 }, content: [text('Juste')] },
      ),
    )
    expect(html).toBe('<h2>Trop haut</h2><h4>Trop bas</h4><h3>Juste</h3>')
  })

  it('stops walking a document nested past any plausible depth', () => {
    let node: unknown = text('deep')
    for (let i = 0; i < 200; i += 1) node = { type: 'blockquote', content: [node] }
    // The guard is that this returns rather than overflowing the stack. The
    // text is far past the depth limit, so nothing survives to render.
    const result = parseDocument(doc(node))
    expect(result.ok).toBe(false)
  })
})

describe('link safety', () => {
  it('accepts the schemes an article legitimately links to', () => {
    for (const href of [
      'https://kle.ht/manifeste',
      'http://example.ht',
      'mailto:kontak@kle.ht',
      '/articles/sitiyasyon-ekonomik',
      '#notes',
    ]) {
      expect(isSafeHref(href), href).toBe(true)
    }
  })

  it('refuses schemes that execute or impersonate', () => {
    for (const href of [
      'javascript:alert(1)',
      'JaVaScRiPt:alert(1)',
      'data:text/html;base64,PHNjcmlwdD4=',
      'vbscript:msgbox(1)',
      'file:///etc/passwd',
      '   ',
    ]) {
      expect(isSafeHref(href), href).toBe(false)
    }
  })

  it('refuses a scheme hidden behind a control character', () => {
    // Browsers strip these before resolving the URL; a prefix check that does
    // not is how `java\tscript:` gets through.
    expect(isSafeHref('java\tscript:alert(1)')).toBe(false)
    expect(isSafeHref('java\nscript:alert(1)')).toBe(false)
  })

  it('turns an unsafe link into plain text rather than a dead anchor', () => {
    const html = render(
      doc(
        para(text('cliquez', [{ type: 'link', attrs: { href: 'javascript:alert(1)' } }])),
      ),
    )
    expect(html).toBe('<p>cliquez</p>')
  })

  it('renders a safe link with rel attributes that cannot be overridden', () => {
    const html = render(
      doc(para(text('manifeste', [{ type: 'link', attrs: { href: 'https://kle.ht' } }]))),
    )
    expect(html).toBe(
      '<p><a href="https://kle.ht" rel="nofollow noopener noreferrer">manifeste</a></p>',
    )
  })

  it('ignores extra mark attributes an author supplies', () => {
    const html = render(
      doc(
        para(
          text('lien', [
            { type: 'link', attrs: { href: '/a', target: '_blank', onclick: 'x()' } },
          ]),
        ),
      ),
    )
    expect(html).not.toContain('onclick')
    expect(html).not.toContain('target')
  })
})

describe('renderDocumentToHtml', () => {
  it('escapes text so markup in a document stays text', () => {
    const html = render(doc(para(text('<script>alert("xss")</script>'))))
    expect(html).toBe('<p>&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;</p>')
  })

  it('escapes a quote inside a link href', () => {
    const html = render(
      doc(para(text('x', [{ type: 'link', attrs: { href: '/a"onmouseover="x' } }]))),
    )
    expect(html).toContain('href="/a&quot;onmouseover=&quot;x"')
    expect(html).not.toContain('onmouseover="x"')
  })

  it('nests marks innermost-first, the way ProseMirror stores them', () => {
    const html = render(doc(para(text('mo', [{ type: 'bold' }, { type: 'italic' }]))))
    expect(html).toBe('<p><em><strong>mo</strong></em></p>')
  })

  it('renders the block vocabulary an essay actually uses', () => {
    const html = render(
      doc(
        { type: 'blockquote', content: [para(text('Yon sèl nou fèb'))] },
        {
          type: 'bulletList',
          content: [{ type: 'listItem', content: [para(text('premye'))] }],
        },
        { type: 'horizontalRule' },
        para(text('avant'), { type: 'hardBreak' }, text('après')),
      ),
    )
    expect(html).toBe(
      '<blockquote><p>Yon sèl nou fèb</p></blockquote>' +
        '<ul><li><p>premye</p></li></ul>' +
        '<hr />' +
        '<p>avant<br />après</p>',
    )
  })

  it('only labels a code block with something shaped like a language', () => {
    const safe = render(
      doc({ type: 'codeBlock', attrs: { language: 'SQL' }, content: [text('select 1')] }),
    )
    expect(safe).toBe('<pre><code class="language-sql">select 1</code></pre>')

    const hostile = render(
      doc({
        type: 'codeBlock',
        attrs: { language: 'x" onload="alert(1)' },
        content: [text('select 1')],
      }),
    )
    expect(hostile).toBe('<pre><code>select 1</code></pre>')
  })

  it('keeps an empty paragraph, because it is the author’s blank line', () => {
    const html = render(doc(para(text('un')), para(), para(text('deux'))))
    expect(html).toBe('<p>un</p><p></p><p>deux</p>')
  })
})

describe('escapeHtml', () => {
  it('covers every character that can end an attribute or open a tag', () => {
    expect(escapeHtml(`&<>"'`)).toBe('&amp;&lt;&gt;&quot;&#39;')
  })
})

describe('docToPlainText and readingTimeMinutes', () => {
  const article = (words: number): DocNode => ({
    type: 'doc',
    content: [
      { type: 'paragraph', content: [{ type: 'text', text: 'mo '.repeat(words) }] },
    ],
  })

  it('separates blocks so words do not run together', () => {
    const parsed = parseDocument(doc(para(text('premye')), para(text('dezyèm'))))
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    expect(docToPlainText(parsed.doc)).toBe('premye\ndezyèm')
  })

  it('never reports less than a minute', () => {
    expect(readingTimeMinutes(article(3))).toBe(1)
  })

  it('rounds to whole minutes at the stated pace', () => {
    expect(readingTimeMinutes(article(540))).toBe(3)
  })
})

describe('emptyDocument', () => {
  it('is a shape the parser recognises but refuses to store', () => {
    // A new translation starts here, and the editor may save it only once the
    // author has written something.
    const result = parseDocument(emptyDocument())
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.code).toBe('EMPTY')
  })
})

describe('tables', () => {
  const cell = (text: string, attrs?: Record<string, number>) => ({
    type: 'tableCell',
    ...(attrs ? { attrs } : {}),
    content: [para(textNode(text))],
  })

  it('renders a table inside a wrapper that can scroll', () => {
    // A wide table is the one thing on an article page allowed to scroll
    // sideways; without the wrapper it widens the page on a phone.
    const html = render(
      doc({
        type: 'table',
        content: [
          {
            type: 'tableRow',
            content: [
              { type: 'tableHeader', content: [para(textNode('Année'))] },
              { type: 'tableHeader', content: [para(textNode('Recettes'))] },
            ],
          },
          { type: 'tableRow', content: [cell('2025'), cell('inconnu')] },
        ],
      }),
    )
    expect(html).toBe(
      '<div class="article-table"><table><tbody>' +
        '<tr><th><p>Année</p></th><th><p>Recettes</p></th></tr>' +
        '<tr><td><p>2025</p></td><td><p>inconnu</p></td></tr>' +
        '</tbody></table></div>',
    )
  })

  it('keeps spans but refuses an absurd one', () => {
    const html = render(
      doc({
        type: 'table',
        content: [
          {
            type: 'tableRow',
            content: [
              cell('a', { colspan: 2, rowspan: 3 }),
              cell('b', { colspan: 9999 }),
            ],
          },
        ],
      }),
    )
    expect(html).toContain('<td colspan="2" rowspan="3">')
    // A cell claiming a thousand columns is broken input, not a wide table.
    expect(html).toContain('<td colspan="100">')
  })

  it('drops a span of one rather than writing it out', () => {
    const html = render(
      doc({
        type: 'table',
        content: [{ type: 'tableRow', content: [cell('a', { colspan: 1 })] }],
      }),
    )
    expect(html).toContain('<td>')
    expect(html).not.toContain('colspan')
  })

  it('drops table attributes an author invented', () => {
    const parsed = parseDocument(
      doc({
        type: 'table',
        attrs: { style: 'width:9999px', onclick: 'steal()' },
        content: [{ type: 'tableRow', content: [cell('a')] }],
      }),
    )
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    expect(parsed.doc.content?.[0]?.attrs).toBeUndefined()
  })
})
