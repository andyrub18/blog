import { randomUUID } from 'node:crypto'
import { eq } from 'drizzle-orm'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { startTestDatabase, type TestDatabase } from '../test/postgres'
import type { Documentation } from './article-review'
import type { Viewer } from './articles'

/**
 * The deliberation against a real PostgreSQL.
 *
 * The arithmetic is tested on its own in `article-review.test.ts`. What is
 * tested here is everything a mock would simply have agreed with: that the
 * quorum is enforced before anyone reads the article, that a reviewer cannot
 * file two verdicts on the same text, that a decision cannot be taken at a
 * convenient moment, and that acceptance publishes exactly the languages that
 * passed and no others.
 */

let harness: TestDatabase
let review: typeof import('./article-review')
let articles: typeof import('./articles')
let schema: typeof import('./db/schema')

beforeAll(async () => {
  harness = await startTestDatabase()
  process.env.DATABASE_URL = harness.url
  review = await import('./article-review')
  articles = await import('./articles')
  schema = await import('./db/schema')
})

afterAll(async () => {
  await harness?.stop()
})

beforeEach(async () => {
  await harness.db.delete(schema.articleDecision)
  await harness.db.delete(schema.articleReview)
  await harness.db.delete(schema.articleReviewer)
  await harness.db.delete(schema.articleSubmission)
  await harness.db.delete(schema.articleRevision)
  await harness.db.delete(schema.articleTranslation)
  await harness.db.delete(schema.article)
  await harness.db.delete(schema.user)
})

async function makeUser(role: string = 'member'): Promise<Viewer> {
  const id = randomUUID()
  await harness.db.insert(schema.user).values({
    id,
    name: `${role}-${id.slice(0, 4)}`,
    email: `${id}@kle.ht`,
    emailVerified: true,
    role: role as 'member',
    memberStatus: 'active',
  })
  return { id, role: role as Viewer['role'], memberStatus: 'active' }
}

const TITLE = 'La situation économique en Haïti'
const SUMMARY = 'Un diagnostic de la crise et les réponses que le mouvement propose.'

const DOCUMENTATION: Documentation = {
  diagnosis:
    "Les recettes publiées ne se recoupent pas avec les dépenses annoncées, et l'écart n'est expliqué nulle part.",
  solutions:
    'Trois options ont été considérées : un audit externe, une publication trimestrielle, ou les deux ensemble.',
  resources:
    "Deux membres du Cercle Économie à mi-temps pendant un trimestre, et l'accès aux journaux officiels.",
  risks:
    "Le principal risque est de publier un chiffre erroné et de perdre la crédibilité que l'article cherche à bâtir.",
  indicators:
    'Succès : trois notes trimestrielles publiées et au moins une reprise par un média national.',
}

const body = (text: string) => ({
  type: 'doc',
  content: [{ type: 'paragraph', content: [{ type: 'text', text }] }],
})

/** An article with real text in the languages named, ready to submit. */
async function draftArticle(author: Viewer, langs: Array<string> = ['fr']) {
  const created = await articles.createArticle({
    author,
    lang: langs[0],
    title: TITLE,
    summary: SUMMARY,
  })
  if (!created.ok) throw new Error(created.code)
  for (const lang of langs) {
    await articles.saveTranslation({
      actor: author,
      articleId: created.value.articleId,
      lang,
      title: `${TITLE} (${lang})`,
      summary: SUMMARY,
      content: body(`Le texte en ${lang}.`),
    })
  }
  return created.value
}

async function submit(author: Viewer, langs: Array<string> = ['fr']) {
  const { articleId, slug } = await draftArticle(author, langs)
  const result = await review.submitForReview({
    actor: author,
    articleId,
    langs,
    documentation: DOCUMENTATION,
  })
  if (!result.ok) throw new Error(`submitForReview: ${result.code}`)
  return { articleId, slug, submissionId: result.value.submissionId }
}

const RATIONALE = 'Le diagnostic tient et les indicateurs sont vérifiables.'

/** A panel that clears the quorum, opened for debate. */
async function panelOf(senior: Viewer, submissionId: string, members: Array<Viewer>) {
  await review.assignReviewer({
    actor: senior,
    submissionId,
    userId: members[0].id,
    stance: 'contradictor',
  })
  for (const member of members.slice(1)) {
    await review.assignReviewer({
      actor: senior,
      submissionId,
      userId: member.id,
      stance: 'reviewer',
    })
  }
  const opened = await review.openDeliberation({ actor: senior, submissionId })
  if (!opened.ok) throw new Error(`openDeliberation: ${opened.code}`)
}

describe('submitting', () => {
  it('refuses a submission missing any of the five documented fields', async () => {
    const author = await makeUser()
    const { articleId } = await draftArticle(author)

    for (const field of ['diagnosis', 'solutions', 'resources', 'risks', 'indicators']) {
      const result = await review.submitForReview({
        actor: author,
        articleId,
        langs: ['fr'],
        documentation: { ...DOCUMENTATION, [field]: 'trop court' },
      })
      expect(result.ok, field).toBe(false)
      if (!result.ok) expect(result.code).toBe('DOCUMENTATION_REQUIRED')
    }
  })

  it('refuses a language with nothing written in it', async () => {
    const author = await makeUser()
    const { articleId } = await draftArticle(author, ['fr'])

    // The Creole has never been started: putting reviewers in front of a blank
    // page would make the round meaningless.
    const result = await review.submitForReview({
      actor: author,
      articleId,
      langs: ['fr', 'ht'],
      documentation: DOCUMENTATION,
    })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.code).toBe('LANGUAGE_EMPTY')
  })

  it('refuses somebody submitting an article that is not theirs', async () => {
    const author = await makeUser()
    const senior = await makeUser('senior_member')
    const { articleId } = await draftArticle(author)

    const result = await review.submitForReview({
      actor: senior,
      articleId,
      langs: ['fr'],
      documentation: DOCUMENTATION,
    })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.code).toBe('NOT_AUTHOR')
  })

  it('refuses a second live submission for the same article', async () => {
    const author = await makeUser()
    const { articleId } = await submit(author)

    const again = await review.submitForReview({
      actor: author,
      articleId,
      langs: ['fr'],
      documentation: DOCUMENTATION,
    })
    expect(again.ok).toBe(false)
    if (!again.ok) expect(again.code).toBe('ALREADY_SUBMITTED')
  })

  it('numbers a resubmission as the next round, keeping the last one on file', async () => {
    const author = await makeUser()
    const { articleId, submissionId } = await submit(author)

    await review.withdrawSubmission({ actor: author, submissionId })
    const second = await review.submitForReview({
      actor: author,
      articleId,
      langs: ['fr'],
      documentation: DOCUMENTATION,
    })
    expect(second.ok).toBe(true)
    if (!second.ok) return
    expect(second.value.round).toBe(2)

    const rounds = await review.listRounds(articleId)
    expect(rounds.map((r) => r.round)).toEqual([2, 1])
  })
})

describe('the panel', () => {
  it('refuses to open the debate without three reviewers', async () => {
    const author = await makeUser()
    const senior = await makeUser('senior_member')
    const { submissionId } = await submit(author)

    const one = await makeUser()
    await review.assignReviewer({
      actor: senior,
      submissionId,
      userId: one.id,
      stance: 'contradictor',
    })

    const result = await review.openDeliberation({ actor: senior, submissionId })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.code).toBe('NO_QUORUM')
  })

  it('refuses to open the debate with nobody assigned to argue against', async () => {
    const author = await makeUser()
    const senior = await makeUser('senior_member')
    const { submissionId } = await submit(author)

    for (const member of [await makeUser(), await makeUser(), await makeUser()]) {
      await review.assignReviewer({
        actor: senior,
        submissionId,
        userId: member.id,
        stance: 'reviewer',
      })
    }

    const result = await review.openDeliberation({ actor: senior, submissionId })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.code).toBe('NO_QUORUM')
  })

  it('refuses to put the author on the panel reviewing their own article', async () => {
    const author = await makeUser()
    const senior = await makeUser('senior_member')
    const { submissionId } = await submit(author)

    const result = await review.assignReviewer({
      actor: senior,
      submissionId,
      userId: author.id,
      stance: 'reviewer',
    })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.code).toBe('SELF_REVIEW')
  })

  it('refuses a reader, who has not been admitted to the deliberation', async () => {
    const author = await makeUser()
    const senior = await makeUser('senior_member')
    const reader = await makeUser('reader')
    const { submissionId } = await submit(author)

    const result = await review.assignReviewer({
      actor: senior,
      submissionId,
      userId: reader.id,
      stance: 'reviewer',
    })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.code).toBe('FORBIDDEN')
  })

  it('refuses a member assigning the panel themselves', async () => {
    const author = await makeUser()
    const member = await makeUser()
    const { submissionId } = await submit(author)

    const result = await review.assignReviewer({
      actor: member,
      submissionId,
      userId: member.id,
      stance: 'contradictor',
    })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.code).toBe('FORBIDDEN')
  })

  it('changes a stance rather than failing when somebody is reassigned', async () => {
    const author = await makeUser()
    const senior = await makeUser('senior_member')
    const member = await makeUser()
    const { submissionId } = await submit(author)

    await review.assignReviewer({
      actor: senior,
      submissionId,
      userId: member.id,
      stance: 'reviewer',
    })
    await review.assignReviewer({
      actor: senior,
      submissionId,
      userId: member.id,
      stance: 'contradictor',
    })

    const panel = await review.listReviewers(submissionId)
    expect(panel).toHaveLength(1)
    expect(panel[0].stance).toBe('contradictor')
  })

  it('takes a reviewer’s verdicts with them when they leave the panel', async () => {
    const author = await makeUser()
    const senior = await makeUser('senior_member')
    const members = [await makeUser(), await makeUser(), await makeUser()]
    const { submissionId } = await submit(author)
    await panelOf(senior, submissionId, members)

    await review.recordVerdict({
      actor: members[1],
      submissionId,
      lang: 'fr',
      verdict: 'support',
      rationale: RATIONALE,
    })
    await review.unassignReviewer({
      actor: senior,
      submissionId,
      userId: members[1].id,
    })

    // A verdict from somebody no longer on the panel would count toward a tally
    // they are not part of.
    const [tally] = await review.tallySubmission(submissionId)
    expect(tally.supports).toBe(0)
  })
})

describe('verdicts', () => {
  it('refuses a verdict from somebody who was never assigned', async () => {
    const author = await makeUser()
    const senior = await makeUser('senior_member')
    const members = [await makeUser(), await makeUser(), await makeUser()]
    const outsider = await makeUser()
    const { submissionId } = await submit(author)
    await panelOf(senior, submissionId, members)

    const result = await review.recordVerdict({
      actor: outsider,
      submissionId,
      lang: 'fr',
      verdict: 'support',
      rationale: RATIONALE,
    })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.code).toBe('NOT_ASSIGNED')
  })

  it('refuses a verdict with no reasoning behind it', async () => {
    const author = await makeUser()
    const senior = await makeUser('senior_member')
    const members = [await makeUser(), await makeUser(), await makeUser()]
    const { submissionId } = await submit(author)
    await panelOf(senior, submissionId, members)

    const result = await review.recordVerdict({
      actor: members[0],
      submissionId,
      lang: 'fr',
      verdict: 'object',
      rationale: 'non',
    })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.code).toBe('RATIONALE_REQUIRED')
  })

  it('refuses a second verdict on the same language', async () => {
    const author = await makeUser()
    const senior = await makeUser('senior_member')
    const members = [await makeUser(), await makeUser(), await makeUser()]
    const { submissionId } = await submit(author)
    await panelOf(senior, submissionId, members)

    await review.recordVerdict({
      actor: members[0],
      submissionId,
      lang: 'fr',
      verdict: 'object',
      rationale: RATIONALE,
    })
    const again = await review.recordVerdict({
      actor: members[0],
      submissionId,
      lang: 'fr',
      verdict: 'support',
      rationale: RATIONALE,
    })
    expect(again.ok).toBe(false)
    if (!again.ok) expect(again.code).toBe('ALREADY_VOTED')
  })

  it('accepts one verdict per language from the same reviewer', async () => {
    // The argument can be sound in French and badly rendered in Creole; a
    // reviewer who reads both speaks to both.
    const author = await makeUser()
    const senior = await makeUser('senior_member')
    const members = [await makeUser(), await makeUser(), await makeUser()]
    const { submissionId } = await submit(author, ['fr', 'ht'])
    await panelOf(senior, submissionId, members)

    const french = await review.recordVerdict({
      actor: members[0],
      submissionId,
      lang: 'fr',
      verdict: 'support',
      rationale: RATIONALE,
    })
    const creole = await review.recordVerdict({
      actor: members[0],
      submissionId,
      lang: 'ht',
      verdict: 'object',
      rationale: 'La traduction ne rend pas le diagnostic du texte français.',
    })
    expect(french.ok).toBe(true)
    expect(creole.ok).toBe(true)
  })

  it('refuses a verdict on a language the submission did not put forward', async () => {
    const author = await makeUser()
    const senior = await makeUser('senior_member')
    const members = [await makeUser(), await makeUser(), await makeUser()]
    const { submissionId } = await submit(author, ['fr'])
    await panelOf(senior, submissionId, members)

    const result = await review.recordVerdict({
      actor: members[0],
      submissionId,
      lang: 'ht',
      verdict: 'support',
      rationale: RATIONALE,
    })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.code).toBe('LANGUAGE_NOT_IN_SUBMISSION')
  })

  it('refuses verdicts before the debate is open', async () => {
    const author = await makeUser()
    const senior = await makeUser('senior_member')
    const member = await makeUser()
    const { submissionId } = await submit(author)
    await review.assignReviewer({
      actor: senior,
      submissionId,
      userId: member.id,
      stance: 'contradictor',
    })

    const result = await review.recordVerdict({
      actor: member,
      submissionId,
      lang: 'fr',
      verdict: 'support',
      rationale: RATIONALE,
    })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.code).toBe('WRONG_STATE')
  })
})

describe('the decision', () => {
  async function deliberation(langs: Array<string> = ['fr'], panelSize = 3) {
    const author = await makeUser()
    const senior = await makeUser('senior_member')
    const members: Array<Viewer> = []
    for (let i = 0; i < panelSize; i += 1) members.push(await makeUser())
    const { articleId, slug, submissionId } = await submit(author, langs)
    await panelOf(senior, submissionId, members)
    return { author, senior, members, articleId, slug, submissionId }
  }

  async function allSay(
    members: Array<Viewer>,
    submissionId: string,
    lang: string,
    verdicts: Array<'support' | 'object' | 'abstain'>,
  ) {
    for (const [i, verdict] of verdicts.entries()) {
      const result = await review.recordVerdict({
        actor: members[i],
        submissionId,
        lang,
        verdict,
        rationale: RATIONALE,
      })
      if (!result.ok) throw new Error(`recordVerdict: ${result.code}`)
    }
  }

  it('refuses a decision while an assigned reviewer has still said nothing', async () => {
    // Otherwise the moment of the decision is itself a lever: whoever closed it
    // could pick the tally they liked.
    const { senior, members, submissionId } = await deliberation()
    await allSay(members, submissionId, 'fr', ['support', 'support'])

    const result = await review.decide({
      actor: senior,
      submissionId,
      rationale: RATIONALE,
    })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.code).toBe('REVIEWERS_STILL_SILENT')
  })

  it('publishes a language the circle accepted, and records the tally', async () => {
    const { senior, members, slug, submissionId } = await deliberation()
    await allSay(members, submissionId, 'fr', ['support', 'support', 'support'])

    const result = await review.decide({
      actor: senior,
      submissionId,
      rationale: RATIONALE,
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.outcome).toBe('accepted')
    expect(result.value.method).toBe('consensus')

    const read = await articles.getReadableArticle({ slug, lang: 'fr', viewer: null })
    expect(read.ok).toBe(true)

    const [decision] = await harness.db
      .select()
      .from(schema.articleDecision)
      .where(eq(schema.articleDecision.submissionId, submissionId))
    expect(decision.outcome).toBe('accepted')
    // The individual positions are the account of how the circle got here.
    expect(JSON.stringify(decision.tallyJson)).toContain('"supports":3')
  })

  it('publishes only the languages that passed', async () => {
    const { senior, members, slug, submissionId } = await deliberation(['fr', 'ht'])
    await allSay(members, submissionId, 'fr', ['support', 'support', 'support'])
    // The contradictor objects to the Creole, and it does not reach two thirds.
    await allSay(members, submissionId, 'ht', ['object', 'object', 'support'])

    const result = await review.decide({
      actor: senior,
      submissionId,
      rationale: RATIONALE,
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.outcome).toBe('accepted')
    expect(result.value.languages.filter((l) => l.accepted).map((l) => l.lang)).toEqual([
      'fr',
    ])

    const read = await articles.getReadableArticle({ slug, lang: 'ht', viewer: null })
    expect(read.ok).toBe(true)
    if (!read.ok) return
    // A Creole reader gets the French with a banner, not an unreviewed Creole.
    expect(read.value.availableLangs).toEqual(['fr'])
  })

  it('refuses to publish a language no contradictor read', async () => {
    const { senior, members, slug, submissionId } = await deliberation(['fr', 'ht'])
    await allSay(members, submissionId, 'fr', ['support', 'support', 'support'])
    // members[0] is the contradictor and says nothing about the Creole.
    await review.recordVerdict({
      actor: members[1],
      submissionId,
      lang: 'ht',
      verdict: 'support',
      rationale: RATIONALE,
    })
    await review.recordVerdict({
      actor: members[2],
      submissionId,
      lang: 'ht',
      verdict: 'support',
      rationale: RATIONALE,
    })

    const result = await review.decide({
      actor: senior,
      submissionId,
      rationale: RATIONALE,
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    const creole = result.value.languages.find((l) => l.lang === 'ht')
    expect(creole?.accepted).toBe(false)
    expect(creole?.reason).toBe('no_contradictor')

    const read = await articles.getReadableArticle({ slug, lang: 'ht', viewer: null })
    expect(read.ok && read.value.availableLangs).toEqual(['fr'])
  })

  it('sends an unsupported proposal back for another round by default', async () => {
    const { senior, members, articleId, submissionId } = await deliberation()
    await allSay(members, submissionId, 'fr', ['object', 'object', 'support'])

    const result = await review.decide({
      actor: senior,
      submissionId,
      rationale: RATIONALE,
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.outcome).toBe('revision_requested')

    const [row] = await harness.db
      .select({ status: schema.article.status })
      .from(schema.article)
      .where(eq(schema.article.id, articleId))
    expect(row.status).toBe('revision_requested')
  })

  it('archives a proposal the circle will not take further', async () => {
    const { senior, members, articleId, submissionId } = await deliberation()
    await allSay(members, submissionId, 'fr', ['object', 'object', 'object'])

    const result = await review.decide({
      actor: senior,
      submissionId,
      rationale: RATIONALE,
      unresolved: 'rejected',
    })
    expect(result.ok).toBe(true)

    const [row] = await harness.db
      .select({ status: schema.article.status })
      .from(schema.article)
      .where(eq(schema.article.id, articleId))
    // Not `draft`: that would invite the author to resubmit the same text as
    // though nothing had happened.
    expect(row.status).toBe('archived')
  })

  it('refuses a simple majority, which is the point of the whole process', async () => {
    // Three to two carries a simple majority and falls short of two thirds, so
    // it is refused. Five reviewers, because on a panel of three two supports
    // *are* two thirds — the smallest panel that can express the difference is
    // five.
    const { senior, members, slug, submissionId } = await deliberation(['fr'], 5)
    await allSay(members, submissionId, 'fr', [
      'support',
      'support',
      'support',
      'object',
      'object',
    ])

    const result = await review.decide({
      actor: senior,
      submissionId,
      rationale: RATIONALE,
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.outcome).toBe('revision_requested')

    const read = await articles.getReadableArticle({ slug, lang: 'fr', viewer: null })
    expect(read.ok).toBe(false)
  })

  it('refuses a decision from a member, and from the author', async () => {
    const { author, members, submissionId } = await deliberation()
    await allSay(members, submissionId, 'fr', ['support', 'support', 'support'])

    const byMember = await review.decide({
      actor: members[0],
      submissionId,
      rationale: RATIONALE,
    })
    expect(byMember.ok).toBe(false)
    if (!byMember.ok) expect(byMember.code).toBe('FORBIDDEN')

    const byAuthor = await review.decide({
      actor: { ...author, role: 'senior_member' },
      submissionId,
      rationale: RATIONALE,
    })
    expect(byAuthor.ok).toBe(false)
    if (!byAuthor.ok) expect(byAuthor.code).toBe('SELF_REVIEW')
  })

  it('refuses a second decision on the same submission', async () => {
    const { senior, members, submissionId } = await deliberation()
    await allSay(members, submissionId, 'fr', ['support', 'support', 'support'])
    await review.decide({ actor: senior, submissionId, rationale: RATIONALE })

    const again = await review.decide({
      actor: senior,
      submissionId,
      rationale: RATIONALE,
    })
    expect(again.ok).toBe(false)
    if (!again.ok) expect(again.code).toBe('WRONG_STATE')
  })

  it('lets a revision open a new round after a decision', async () => {
    const { author, senior, members, articleId, submissionId } = await deliberation()
    await allSay(members, submissionId, 'fr', ['object', 'object', 'support'])
    await review.decide({ actor: senior, submissionId, rationale: RATIONALE })

    await articles.saveTranslation({
      actor: author,
      articleId,
      lang: 'fr',
      title: TITLE,
      summary: SUMMARY,
      content: body('Le texte, corrigé après les objections du premier tour.'),
    })
    const second = await review.submitForReview({
      actor: author,
      articleId,
      langs: ['fr'],
      documentation: DOCUMENTATION,
    })
    expect(second.ok).toBe(true)
    if (!second.ok) return
    expect(second.value.round).toBe(2)

    // Both rounds survive: what the contradictor objected to in round one is the
    // reason round two reads the way it does.
    const rounds = await review.listRounds(articleId)
    expect(rounds).toHaveLength(2)
    expect(rounds.find((r) => r.round === 1)?.outcome).toBe('revision_requested')
  })
})

describe('the queue', () => {
  it('shows live submissions oldest first and drops decided ones', async () => {
    const authorA = await makeUser()
    const authorB = await makeUser()
    const senior = await makeUser('senior_member')
    const members = [await makeUser(), await makeUser(), await makeUser()]

    const first = await submit(authorA)
    await new Promise((r) => setTimeout(r, 10))
    const second = await submit(authorB)

    let queue = await review.listSubmissionQueue()
    expect(queue.map((q) => q.submissionId)).toEqual([
      first.submissionId,
      second.submissionId,
    ])
    expect(queue[0].reviewers).toBe(0)

    await panelOf(senior, first.submissionId, members)
    for (const member of members) {
      await review.recordVerdict({
        actor: member,
        submissionId: first.submissionId,
        lang: 'fr',
        verdict: 'support',
        rationale: RATIONALE,
      })
    }
    await review.decide({
      actor: senior,
      submissionId: first.submissionId,
      rationale: RATIONALE,
    })

    queue = await review.listSubmissionQueue()
    expect(queue.map((q) => q.submissionId)).toEqual([second.submissionId])
  })

  it('carries what a senior member needs to see before opening the article', async () => {
    const author = await makeUser()
    const senior = await makeUser('senior_member')
    const members = [await makeUser(), await makeUser(), await makeUser()]
    const { submissionId } = await submit(author, ['fr', 'ht'])
    await panelOf(senior, submissionId, members)

    const [card] = await review.listSubmissionQueue()
    expect(card.langs).toEqual(['fr', 'ht'])
    expect(card.reviewers).toBe(3)
    expect(card.contradictors).toBe(1)
    expect(card.round).toBe(1)
  })

  it('returns the documentation, the panel and every verdict for one submission', async () => {
    const author = await makeUser()
    const senior = await makeUser('senior_member')
    const members = [await makeUser(), await makeUser(), await makeUser()]
    const { submissionId } = await submit(author)
    await panelOf(senior, submissionId, members)
    await review.recordVerdict({
      actor: members[0],
      submissionId,
      lang: 'fr',
      verdict: 'object',
      rationale: 'Les indicateurs ne sont pas mesurables tels qu’ils sont écrits.',
    })

    const detail = await review.getSubmission(submissionId)
    expect(detail).not.toBeNull()
    if (!detail) return
    expect(detail.submission.diagnosis).toBe(DOCUMENTATION.diagnosis)
    expect(detail.reviewers).toHaveLength(3)
    expect(detail.verdicts).toHaveLength(1)
    // Attributable by design: a verdict nobody can be asked about is not a reason.
    expect(detail.verdicts[0].reviewerName).toBeTruthy()
    expect(detail.tallies[0].objections).toBe(1)
  })
})
