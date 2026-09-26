import { describe, expect, it } from 'vitest'
import { diffDocuments, diffText } from './diff'
import type { DocNode } from './prosemirror'

const text = (value: string, marks?: DocNode['marks']): DocNode => ({
  type: 'text',
  text: value,
  ...(marks ? { marks } : {}),
})
const p = (...parts: Array<string | DocNode>): DocNode => ({
  type: 'paragraph',
  content: parts.map((part) => (typeof part === 'string' ? text(part) : part)),
})
const h = (level: number, value: string): DocNode => ({
  type: 'heading',
  attrs: { level },
  content: [text(value)],
})
const list = (...items: Array<string>): DocNode => ({
  type: 'bulletList',
  content: items.map((item) => ({ type: 'listItem', content: [p(item)] })),
})
const doc = (...content: Array<DocNode>): DocNode => ({ type: 'doc', content })

const labels = {
  unchanged: (n: number) => `${n} inchangés`,
  reformatted: '(mise en forme modifiée)',
}
const diff = (before: DocNode | null, after: DocNode) =>
  diffDocuments(before, after, labels)

describe('diffText', () => {
  it('marks the words that went and the words that came', () => {
    expect(diffText('le budget est publié', 'le budget est vérifié')).toBe(
      'le budget est <del>publié</del><ins>vérifié</ins>',
    )
  })

  it('escapes what the author wrote, on both sides', () => {
    const html = diffText('a <b>', 'a <script>x</script>')
    expect(html).not.toMatch(/<b>|<script>/)
    expect(html).toContain('&lt;script&gt;')
  })
})

describe('diffDocuments', () => {
  /** Version 1 has nothing before it: no change to show, not a wall of green. */
  it('shows no change for a first version', () => {
    const result = diff(null, doc(p('Le texte.')))
    expect(result).toEqual({
      changed: false,
      summary: { added: 0, removed: 0, modified: 0, reformatted: 0 },
      html: '',
    })
  })

  it('shows no change between identical versions', () => {
    const same = doc(h(2, 'Diagnostic'), p('Le texte.'))
    expect(diff(same, structuredClone(same)).changed).toBe(false)
  })

  it('shows an edited paragraph word by word', () => {
    const result = diff(
      doc(p('Trois mesures sont proposées.')),
      doc(p('Quatre mesures sont proposées.')),
    )
    expect(result.summary.modified).toBe(1)
    expect(result.html).toContain('<del>Trois</del><ins>Quatre</ins> mesures')
  })

  /**
   * The alignment is the point of the first pass: a paragraph added at the top
   * must not make every paragraph after it look changed.
   */
  it('shows an inserted paragraph as one addition, not as every paragraph shifting', () => {
    const before = doc(p('Un.'), p('Deux.'), p('Trois.'))
    const after = doc(p('Zéro.'), p('Un.'), p('Deux.'), p('Trois.'))
    const result = diff(before, after)
    expect(result.summary).toEqual({ added: 1, removed: 0, modified: 0, reformatted: 0 })
    expect(result.html).toContain('<ins>Zéro.</ins>')
  })

  /**
   * Both ends changed and a paragraph inserted between: the shortcut that
   * peels off identical beginnings and endings cannot help, so this is the
   * alignment itself at work. Without it, all four old paragraphs would be
   * paired with new ones and reported as rewritten.
   */
  it('aligns unchanged paragraphs even when both ends of the document changed', () => {
    const before = doc(p('Un.'), p('Deux.'), p('Trois.'), p('Quatre.'))
    const after = doc(
      p('Un, revu.'),
      p('Deux.'),
      p('Nouveau.'),
      p('Trois.'),
      p('Quatre, revu.'),
    )
    expect(diff(before, after).summary).toEqual({
      added: 1,
      removed: 0,
      modified: 2,
      reformatted: 0,
    })
  })

  it('shows a removed section', () => {
    const before = doc(h(2, 'Risques'), p('Le principal risque.'), h(2, 'Indicateurs'))
    const after = doc(h(2, 'Indicateurs'))
    const result = diff(before, after)
    expect(result.summary.removed).toBe(2)
    expect(result.html).toMatch(/<h2 class="diff-removed"><del>Risques<\/del><\/h2>/)
  })

  it('sees list items and table rows one by one', () => {
    const before = doc(list('Publier', 'Motiver'))
    const after = doc(list('Publier', 'Motiver chaque nomination'))
    const result = diff(before, after)
    expect(result.summary.modified).toBe(1)
    expect(result.html).toContain('Motiver<ins> chaque nomination</ins>')
  })

  /**
   * No word changed, so a text-only comparison would call it identical — but
   * a word made bold, or a link pointing elsewhere, is a change a reviewer must
   * be able to see.
   */
  it('flags a change of formatting alone instead of hiding it', () => {
    const before = doc(p('Voir la source.'))
    const after = doc(
      p(
        'Voir la ',
        text('source', [{ type: 'link', attrs: { href: 'https://autre.example' } }]),
        '.',
      ),
    )
    const result = diff(before, after)
    expect(result.changed).toBe(true)
    expect(result.summary.reformatted).toBe(1)
    expect(result.html).toContain('(mise en forme modifiée)')
  })

  it('collapses long unchanged stretches, keeping one block of context', () => {
    const body = ['Un.', 'Deux.', 'Trois.', 'Quatre.', 'Cinq.'].map((t) => p(t))
    const before = doc(...body, p('Fin.'))
    const after = doc(...body, p('Fin, modifiée.'))
    const result = diff(before, after)
    expect(result.html).toContain('<p class="diff-skip">4 inchangés</p>')
    expect(result.html).toContain('<p class="diff-context">Cinq.</p>')
    expect(result.html).not.toContain('Un.')
  })

  /**
   * Author text reaches the output by five paths — context, added, removed,
   * modified, reformatted — and each must escape on its own. One hostile string
   * is sent down every one of them.
   */
  it('never lets author text through as markup, by any path', () => {
    const evil = '<img src=x onerror=alert(1)>'
    const before = doc(
      p(`${evil} contexte`),
      p(`${evil} retiré`),
      h(2, `${evil} titre`),
      p(`${evil} lien`),
    )
    const after = doc(
      p(`${evil} contexte`),
      h(2, `${evil} titre modifié`),
      p(
        `${evil} `,
        text('lien', [{ type: 'link', attrs: { href: 'https://x.example' } }]),
      ),
      list(`${evil} ajouté`),
    )
    const result = diff(before, after)
    expect(result.summary).toMatchObject({
      added: 1,
      removed: 1,
      modified: 1,
      reformatted: 1,
    })
    expect(result.html).not.toContain('<img')
    expect(result.html.match(/&lt;img/g)?.length).toBeGreaterThanOrEqual(5)
  })

  it('handles a long document without building an enormous table', () => {
    const many = Array.from({ length: 3000 }, (_, i) => p(`Paragraphe ${i}.`))
    const shuffled = [...many].reverse()
    const started = Date.now()
    const result = diff(doc(...many), doc(...shuffled))
    expect(result.changed).toBe(true)
    expect(Date.now() - started).toBeLessThan(5000)
  })
})
