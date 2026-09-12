# Phase 2 — Articles and the review workflow

> **Articles are built. The review workflow is designed, not built.** Phase 2
> delivered the schema, the document format, authoring in every language, the
> reading view and the language fallback. Everything from "The point" down to
> the four-stage process below describes phase 3, whose tables exist and whose
> code does not. What was built, and the three decisions taken while building
> it, is at the end of this file.

Design this now even though it ships after articles, because the tables must exist before
the first article does. Retrofitting a review process onto published content is painful.

## The point

A binary approve/reject button would make this Medium with extra steps. The manifesto
specifies a four-stage process, and building *that* is the reason KLE needs its own
platform instead of a Substack:

1. **Documented submission** — a proposal must state the diagnosis, the solutions
   considered, the resources required, the risks identified, and measurable success
   indicators. An undocumented proposal is not admissible.
2. **Structured adversarial debate** — named members are assigned to argue *against* the
   proposal, to surface flaws, blind spots and unverified assumptions.
3. **Synthesis and fusion** — surviving proposals are refined and merged.
4. **Consensus, or qualified majority** — never a simple majority, and only on proposals
   that cleared the first three stages.

## Schema

```
article              (id, slug, author_id, visibility, status, created_at, published_at)
article_translation  (article_id, lang, title, summary, content_json, updated_at)
                     PRIMARY KEY (article_id, lang)
article_revision     (id, article_id, lang, content_json, created_by, created_at)

article_submission   (id, article_id, round, submitted_by, submitted_at, status,
                      diagnosis, solutions, resources, risks, indicators)
article_reviewer     (submission_id, user_id, stance, assigned_by, assigned_at)
                     PRIMARY KEY (submission_id, user_id)
article_review       (id, submission_id, reviewer_id, verdict, rationale, created_at)
article_decision     (id, submission_id, outcome, method, tally_json, decided_at, decided_by)
```

- `article.visibility` — `public` | `members`. Default **`public`**: a movement whose
  purpose is national influence should not hide its output behind a signup wall. `members`
  is the deliberate exception.
- `article.status` — `draft` | `submitted` | `in_review` | `revision_requested` |
  `published` | `archived`.
- `article_submission.round` — revisions create a new round rather than overwriting, so the
  argument history survives.
- The five columns `diagnosis / solutions / resources / risks / indicators` are the
  manifesto's requirements, enforced as `NOT NULL`. The form *is* the standard.
- `article_reviewer.stance` — `contradictor` | `reviewer`. At least one contradictor is
  required to move to `in_review`; their explicit job is to argue against.
- `article_review.verdict` — `support` | `object` | `abstain`, with `rationale NOT NULL`.
  A verdict without reasoning is a popularity vote, which is the thing being rejected.
- `article_decision.method` — `consensus` | `qualified_majority`, `tally_json` recording the
  individual positions.

## Rules

- Quorum: at least three assigned reviewers, of whom at least one is a contradictor.
- Qualified majority: two-thirds of votes cast, never a simple majority.
- Authors cannot review their own submission; contradictors are assigned by a senior
  member, not self-selected.
- Publication is per language. A submission covers one or more
  `(article_id, lang)` variants, and reviewers validate the languages they can read —
  publishing `fr` while `ht` is still in review is normal and expected.

## Language fallback

Never require all four languages. An author writes what they can. A reader landing on an
unavailable language sees the article in the site's fallback order with an honest banner —
"not yet available in English; read it in French, or help translate it." That last link is
a contribution path for members who are not writers, and it is how the translations
actually get done.

## Why content is stored as ProseMirror JSON

Diffs. During the adversarial stage a contradictor needs to see precisely what changed
between round 2 and round 3. Structured JSON diffs cleanly; HTML does not. It also means
imported or pasted content cannot smuggle script through, because anything outside the
schema is dropped at parse time.


---

## What phase 2 built

Migration `drizzle/0006_articles.sql` creates all seven tables above. The four review
tables are empty and nothing writes to them yet; they are there because a review trail
that begins halfway through the archive is not a review trail.

**The document format is a module, not a library.** `src/lib/prosemirror.ts` is pure —
no IO, no framework — and does three things: `parseDocument` validates an untrusted
document against an allowlist of nodes and marks, `renderDocumentToHtml` turns a stored
document into HTML, and `docToPlainText` backs the reading-time estimate. It is the
security boundary for article content, and it is why the reading view ships no
JavaScript of its own: the HTML is rendered on the server and the reader downloads
finished markup rather than a document plus a renderer to run it through.

Two absences in the allowlist are decisions. There is **no image node** — there is no
upload path yet (D11), and an arbitrary `src` would let an article make every reader's
browser fetch a URL somebody else controls, handing a third party a record of who read
what. And there is no raw-HTML node, which is the hole the module exists to close.
`src/lib/prosemirror.test.ts` asserts the properties rather than the implementation: a
`javascript:` link becomes plain text, a scheme hidden behind a control character is
refused, markup in a document stays text, and a code block is only ever labelled with
something shaped like a language name.

### Three rules worth stating

**Publication is per language, so the translation carries its own status.** The sketch
above puts `status` and `published_at` on `article` alone, which cannot express the
normal case: the French is ready and the Creole is still being written. `article.status`
is now the life of the work — it becomes `published` when the first language goes live —
and `article_translation.status` is what the reading view checks. Withdrawing one
language leaves the article and the other languages alone, because that is an editorial
correction, not a retraction.

**An author cannot publish their own article.** `publishTranslation` requires a senior
member. The review process that will stand behind that judgement is phase 3, and the
provisional version is a thin one, but the *shape* of the rule had to be right from the
first article: a self-publish button is the hardest thing to take away later, because
people would have been publishing that way for months by the time the submission
workflow arrives. What phase 3 replaces is the judgement, not the constraint.

**A save writes the translation and its revision in one transaction.** A save that wrote
the new text but lost the revision would destroy the record a contradictor reads to see
what changed between rounds, and nobody would notice until the argument mattered.

### The fallback, and the contribution path

A reader who lands on a language nobody has written yet gets the article in the site's
fallback order — their language, then the base locale, then whatever exists — with a
banner naming both languages. Not a 404: the article exists, it is simply not in their
language. The index does the same, showing each article once in the best language
available and marking the card when the reader is being given another one.

The "help translate it" link the language-fallback section above asks for is **not
built**. The editor reaches a missing language through the author's desk, so a member can
add Creole to an existing article, but a reader looking at the banner is not yet offered
that route. It belongs with phase 3's review UI, where a translation would be reviewed
like any other submission.

### Two things that cost an afternoon, recorded so they do not cost another

**Splitting the editor component does not work; splitting the library does.**
The first attempt put `lazy(() => import('./ArticleEditor'))` on the write route.
The server rendered the toolbar happily, the client asset manifest had no entry
for the module, and hydration gave up — producing a page with a complete,
correct-looking toolbar and no editor under it, and no error anybody would
notice. TipTap is now reached by a dynamic `import()` inside the editor's own
effect. The component itself is an ordinary import; only the 126 KB library is
split, which is the part that mattered.

**`<textarea value={…}>` breaks hydration in this Solid RC.** SSR writes the
value as a child text node; the client template has no child. The two sides end
up one node apart, and everything after the textarea in the tree is created
detached — visible, correctly rendered, and completely inert. On the author's
desk that was the entire list of articles. Textareas here are uncontrolled, read
through `onInput`, with any initial value passed as a JSX child.
`src/components/auth/ApplyForm.tsx` and `src/routes/_app/review/probation.tsx`
still use the old shape and have the same defect; they were left alone because
they belong to phase 1, not because they are fine.

### What is deliberately still missing

- **Pseudonymous bylines (D3).** The byline is `user.name`. `display_name` separate from
  `legal_name` needs the senior-member change flow to go with it, or the byline becomes
  freely self-editable and defeats its own purpose. The byline is read at render time,
  so adding it later costs nothing.
- **Progressive enhancement.** The editor needs JavaScript, as it must; the reading view
  does not need any, and does not use any.
- **Images, and anything that uploads into an article.** Waiting on D11.
