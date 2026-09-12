import { describe, expect, it } from 'vitest'
import { htmlToDocument } from './html-to-prosemirror'
import { parseDocument, renderDocumentToHtml } from './prosemirror'

/**
 * What a Word file is allowed to become.
 *
 * These test the rule, not the implementation: nothing a `.docx` contains may
 * reach a reader as markup, a script, or a URL scheme we did not agree to.
 * Mammoth is explicit that it sanitises nothing, so this module is the only
 * thing standing between a document somebody emailed an author and a public
 * page.
 */

/** The round trip a real import makes: HTML → our format → HTML. */
function roundTrip(html: string): string {
  const { doc } = htmlToDocument(html)
  const parsed = parseDocument(doc)
  if (!parsed.ok) return ''
  return renderDocumentToHtml(parsed.doc)
}

describe('what cannot get through', () => {
  it('drops a script entirely, tag and contents', () => {
    const { doc, report } = htmlToDocument(
      '<p>Avant</p><script>steal()</script><p>Après</p>',
    )
    const rendered = renderDocumentToHtml(doc)
    expect(rendered).toBe('<p>Avant</p><p>Après</p>')
    expect(rendered).not.toContain('steal')
    expect(report.dropped.script).toBe(1)
  })

  it('turns a javascript: link into plain text and says so', () => {
    // The case mammoth's own documentation warns about. It arrives looking like
    // an ordinary link.
    const { doc, report } = htmlToDocument(
      '<p><a href="javascript:alert(1)">cliquez ici</a></p>',
    )
    expect(renderDocumentToHtml(doc)).toBe('<p>cliquez ici</p>')
    expect(report.dropped['unsafe link']).toBe(1)
    expect(report.kept.link).toBeUndefined()
  })

  it('refuses a data: URL', () => {
    const { report } = htmlToDocument(
      '<p><a href="data:text/html;base64,PHNjcmlwdD4=">rapport</a></p>',
    )
    expect(report.dropped['unsafe link']).toBe(1)
  })

  it('keeps an https link and gives it rel attributes', () => {
    const html = roundTrip('<p><a href="https://kle.ht">le manifeste</a></p>')
    expect(html).toBe(
      '<p><a href="https://kle.ht" rel="nofollow noopener noreferrer">le manifeste</a></p>',
    )
  })

  it('does not let an event handler attribute survive', () => {
    // Nothing copies attributes through: every node is rebuilt, so there is no
    // path by which one could.
    const html = roundTrip('<p onclick="steal()" style="position:fixed">Texte</p>')
    expect(html).toBe('<p>Texte</p>')
  })

  it('renders markup inside the text as text', () => {
    const html = roundTrip('<p>&lt;script&gt;alert(1)&lt;/script&gt;</p>')
    expect(html).toBe('<p>&lt;script&gt;alert(1)&lt;/script&gt;</p>')
  })

  it('drops an iframe and an embedded object, by name', () => {
    const { report } = htmlToDocument(
      '<p>a</p><iframe src="https://evil.example"></iframe><object data="x"></object>',
    )
    expect(report.dropped['embedded object']).toBe(2)
  })

  it('survives a document nested past any plausible depth', () => {
    const deep = `${'<div>'.repeat(200)}texte${'</div>'.repeat(200)}`
    // The guard is that this returns at all rather than overflowing the stack.
    expect(() => htmlToDocument(deep)).not.toThrow()
  })
})

describe('what an author keeps', () => {
  it('maps Word headings below the page title', () => {
    const html = roundTrip('<h1>Diagnostic</h1><h2>Recettes</h2><h5>Détail</h5>')
    // The article title is the page's h1, so a document cannot emit its own.
    expect(html).toBe('<h2>Diagnostic</h2><h2>Recettes</h2><h4>Détail</h4>')
  })

  it('keeps emphasis that has a meaning in our format', () => {
    const html = roundTrip('<p><strong>gras</strong> et <em>italique</em></p>')
    expect(html).toBe('<p><strong>gras</strong> et <em>italique</em></p>')
  })

  it('keeps the words when the emphasis has no equivalent', () => {
    // Underline is not in the vocabulary. Losing the author's sentence because
    // of that would be absurd.
    const { doc, report } = htmlToDocument('<p>Le mot <u>souligné</u> compte.</p>')
    expect(renderDocumentToHtml(doc)).toBe('<p>Le mot souligné compte.</p>')
    expect(report.dropped.underline).toBe(1)
  })

  it('keeps lists, including nested ones', () => {
    const html = roundTrip(
      '<ul><li>premier<ul><li>imbriqué</li></ul></li><li>second</li></ul>',
    )
    expect(html).toContain('<ul><li>')
    expect(html).toContain('imbriqué')
    expect(html).toContain('second')
  })

  it('keeps a table, with its header row and spans', () => {
    const html = roundTrip(
      '<table><thead><tr><th>Année</th><th colspan="2">Recettes</th></tr></thead>' +
        '<tbody><tr><td>2025</td><td>inconnu</td><td>—</td></tr></tbody></table>',
    )
    expect(html).toContain('<div class="article-table">')
    // A cell holds blocks, so its text is wrapped in a paragraph.
    expect(html).toContain('<th><p>Année</p></th>')
    expect(html).toContain('<th colspan="2"><p>Recettes</p></th>')
    expect(html).toContain('<td><p>2025</p></td>')
  })

  it('does not produce a table with no rows in it', () => {
    const { doc } = htmlToDocument('<table><caption>Vide</caption></table>')
    expect(doc.content?.some((node) => node.type === 'table')).toBe(false)
  })

  it('keeps an empty cell, because the table’s shape depends on it', () => {
    const html = roundTrip('<table><tr><td>a</td><td></td></tr></table>')
    expect(html).toContain('<td><p></p></td>')
  })

  it('collapses the whitespace Word leaves everywhere', () => {
    const html = roundTrip('<p>Un\n   paragraphe\t\tespacé</p>')
    expect(html).toBe('<p>Un paragraphe espacé</p>')
  })

  it('keeps a line break inside a paragraph', () => {
    expect(roundTrip('<p>avant<br>après</p>')).toBe('<p>avant<br />après</p>')
  })

  it('rescues text from a wrapper it does not understand', () => {
    // A Word text box arrives as an element with no node of ours; the sentences
    // inside it are still the author's.
    const { doc, report } = htmlToDocument(
      '<figcaption><p>Une phrase dans une boîte.</p></figcaption>',
    )
    expect(renderDocumentToHtml(doc)).toContain('Une phrase dans une boîte.')
    expect(report.dropped.other).toBe(1)
  })
})

describe('the report', () => {
  it('counts by kind, so the author knows what to look at', () => {
    const { report } = htmlToDocument(
      '<h1>Titre</h1><p>Un</p><p>Deux</p>' +
        '<table><tr><td>x</td></tr></table>' +
        '<img src="a.png"><img src="b.png"><img src="c.png">' +
        '<math>x²</math>',
    )
    expect(report.kept).toMatchObject({ heading: 1, paragraph: 2, table: 1 })
    // "Dropped 4 things" tells an author nothing. This tells them where to look.
    expect(report.dropped).toMatchObject({ image: 3, equation: 1 })
  })

  it('reports nothing dropped for a document that fits', () => {
    const { report } = htmlToDocument('<h2>Titre</h2><p>Du texte.</p>')
    expect(Object.keys(report.dropped)).toHaveLength(0)
  })
})

describe('the result is always storable', () => {
  it('produces a document the schema accepts unchanged', () => {
    const { doc } = htmlToDocument(
      '<h1>Titre</h1><p><a href="https://kle.ht">lien</a></p>' +
        '<table><tr><th>a</th></tr><tr><td>b</td></tr></table>' +
        '<ul><li>x</li></ul><blockquote><p>citation</p></blockquote>',
    )
    const parsed = parseDocument(doc)
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    // Nothing is lost on the way in: the converter's output is already exactly
    // what the schema permits, which is the point of sharing the allowlist.
    expect(parsed.doc).toEqual(doc)
  })

  it('refuses a file with no text in it at all', () => {
    const { doc } = htmlToDocument('<img src="a.png"><hr>')
    expect(parseDocument(doc).ok).toBe(false)
  })
})
