# Phase 2 — Articles and the review workflow

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
