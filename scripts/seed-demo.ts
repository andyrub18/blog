/**
 * Seed accounts for exercising the enrollment and review flows locally.
 *
 * Run with: npm run db:seed:demo
 *
 * Refuses to run in production. These are known-password accounts; creating
 * them on a deployed server would hand anyone who reads this file a senior
 * member account, and with it every applicant's CV.
 */
import { randomUUID } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { eq, inArray } from 'drizzle-orm'
import { auth } from '../src/lib/auth'
import { db } from '../src/lib/db'
import {
  applicationEvent,
  article,
  articleDecision,
  articleReview,
  articleReviewer,
  articleRevision,
  articleSubmission,
  articleTranslation,
  authThrottle,
  forumPost,
  invitation,
  memberApplication,
  roleChange,
  seniorPromotion,
  seniorPromotionVote,
  user as userTable,
  type Role,
} from '../src/lib/db/schema'

const PASSWORD = 'demo-password-123'

const ACCOUNTS = [
  { key: 'senior', name: 'Manm Senyò', email: 'senior@kleayiti.test', role: 'senior_member' },
  // Three senior members, because three approvals is the floor for a promotion.
  // With fewer, the qualified majority can never be reached and the promotion
  // flow cannot be exercised at all.
  { key: 'senior2', name: 'Manm Senyò 2', email: 'senior2@kleayiti.test', role: 'senior_member' },
  { key: 'senior3', name: 'Manm Senyò 3', email: 'senior3@kleayiti.test', role: 'senior_member' },
  // Probation behind them: the only kind of member who may be nominated.
  { key: 'confirmed', name: 'Manm Konfime', email: 'confirmed@kleayiti.test', role: 'member' },
  // Reserved for the blocking test, so it does not lock another test's account.
  { key: 'blockable', name: 'Manm Regilye', email: 'blockable@kleayiti.test', role: 'member' },
  { key: 'reader', name: 'Lektè', email: 'reader@kleayiti.test', role: 'reader' },
  { key: 'applicant', name: 'Kandida', email: 'applicant@kleayiti.test', role: 'reader' },
  // Admitted member whose six months are up: the probation queue's subject.
  { key: 'probationer', name: 'Manm an Esè', email: 'probationer@kleayiti.test', role: 'member' },
  // Pristine on purpose: tests that only look at the application form must not
  // share an account with tests that submit one, or they depend on run order.
  { key: 'newcomer', name: 'Nouvo', email: 'newcomer@kleayiti.test', role: 'reader' },
] as const satisfies ReadonlyArray<{
  key: string
  name: string
  email: string
  role: Role
}>

/** A byte-valid PDF, so the magic-byte check and the download path both work. */
const MINIMAL_PDF = Buffer.from(
  '%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n',
  'latin1',
)

/**
 * State every seeded account goes back to.
 *
 * The membership fields are cleared on purpose: a previous run's review and
 * probation decisions would otherwise leave the next run with an empty queue
 * and nothing to exercise.
 */
const RESET_STATE = {
  emailVerified: true,
  memberStatus: 'active',
  memberSince: null,
  probationUntil: null,
  probationConfirmedAt: null,
} as const

async function ensureAccount(account: (typeof ACCOUNTS)[number]): Promise<string> {
  const [existing] = await db
    .select({ id: userTable.id })
    .from(userTable)
    .where(eq(userTable.email, account.email))
    .limit(1)

  if (existing) {
    await db
      .update(userTable)
      .set({ ...RESET_STATE, role: account.role })
      .where(eq(userTable.id, existing.id))
    console.info(`· ${account.email} already existed — role reset to ${account.role}`)
    return existing.id
  }

  const result = await auth.api.signUpEmail({
    body: { name: account.name, email: account.email, password: PASSWORD },
    headers: new Headers(),
  })

  await db
    .update(userTable)
    .set({ ...RESET_STATE, role: account.role })
    .where(eq(userTable.id, result.user.id))

  // Even a seeded role gets an audit row. A role nobody can account for is
  // exactly what the audit trail exists to prevent.
  await db.insert(roleChange).values({
    id: randomUUID(),
    subjectUserId: result.user.id,
    fromRole: 'reader',
    toRole: account.role,
    reason: 'seeded',
    rationale: 'Created by the demo seed script.',
    actorId: null,
  })

  console.info(`· created ${account.email} (${account.role})`)
  return result.user.id
}

const PLAN =
  'Je propose de coordonner un cycle de lectures sur les politiques ' +
  'éducatives haïtiennes, de produire une note de position par trimestre, ' +
  'et de mettre mes compétences en analyse de données au service du ' +
  'Cercle Économie pour documenter les projets financés par le Fonds.'

/** Write the three dossier PDFs for a user and return their stored paths. */
async function writeDossier(userId: string): Promise<Record<string, string>> {
  const paths: Record<string, string> = {}
  for (const field of ['cv', 'vision', 'contribution'] as const) {
    const relative = `member-applications/${userId}/${field}-${randomUUID()}-${field}.pdf`
    const absolute = join(process.cwd(), 'uploads', relative)
    await mkdir(dirname(absolute), { recursive: true })
    await writeFile(absolute, MINIMAL_PDF)
    paths[field] = relative
  }
  return paths
}

/**
 * Put a demo user's application back to a known status.
 *
 * Replaces rather than skips: a run that approved the applicant would otherwise
 * leave the next run with an empty review queue.
 */
async function clearApplications(userId: string): Promise<void> {
  const existing = await db
    .select({ id: memberApplication.id })
    .from(memberApplication)
    .where(eq(memberApplication.userId, userId))
  if (existing.length === 0) return
  const ids = existing.map((row) => row.id)
  await db.delete(applicationEvent).where(inArray(applicationEvent.applicationId, ids))
  await db.delete(memberApplication).where(inArray(memberApplication.id, ids))
}

async function resetApplication(
  userId: string,
  status: 'pending' | 'approved',
): Promise<void> {
  await clearApplications(userId)

  const id = randomUUID()
  const paths = await writeDossier(userId)

  await db.insert(memberApplication).values({
    id,
    userId,
    cvPath: paths.cv,
    visionEssayPath: paths.vision,
    contributionEssayPath: paths.contribution,
    contributionPlan: PLAN,
    status,
  })

  await db.insert(applicationEvent).values({
    id: randomUUID(),
    applicationId: id,
    fromStatus: null,
    toStatus: status,
    actorId: userId,
  })
}

/**
 * Age a member's probation so the confirmation queue has something in it.
 *
 * Admitted seven months ago, so the manifesto's six months ran out a month ago.
 */
async function ensureProbationDue(userId: string): Promise<void> {
  const memberSince = new Date()
  memberSince.setMonth(memberSince.getMonth() - 7)
  const probationUntil = new Date(memberSince)
  probationUntil.setMonth(probationUntil.getMonth() + 6)

  await db
    .update(userTable)
    .set({ memberSince, probationUntil, probationConfirmedAt: null })
    .where(eq(userTable.id, userId))
}

/** A member whose six months are behind them, confirmed by the circle. */
async function confirmMember(userId: string): Promise<void> {
  const memberSince = new Date()
  memberSince.setMonth(memberSince.getMonth() - 12)
  const probationUntil = new Date(memberSince)
  probationUntil.setMonth(probationUntil.getMonth() + 6)

  await db
    .update(userTable)
    .set({ memberSince, probationUntil, probationConfirmedAt: probationUntil })
    .where(eq(userTable.id, userId))
}

/**
 * A ProseMirror document, the shape the editor produces.
 *
 * A bare string is a paragraph; `{ heading }` is a section title. Long-form
 * work is the case the contents list exists for, and a seed made only of
 * paragraphs would never produce one.
 */
type DemoBlock = string | { heading: string; level?: number }

function demoDocument(blocks: Array<DemoBlock>) {
  return {
    type: 'doc',
    content: blocks.map((block) =>
      typeof block === 'string'
        ? { type: 'paragraph', content: [{ type: 'text', text: block }] }
        : {
            type: 'heading',
            attrs: { level: block.level ?? 2 },
            content: [{ type: 'text', text: block.heading }],
          },
    ),
  }
}

type DemoArticle = {
  slug: string
  visibility: 'public' | 'members'
  translations: Array<{
    lang: string
    status: 'draft' | 'published'
    title: string
    summary: string
    paragraphs: Array<DemoBlock>
  }>
}

/**
 * Three articles, each exercising a different reading path.
 *
 * The second is published in French only on purpose: the fallback banner a
 * Creole reader sees is the part of the reading view most likely to break
 * quietly, because it only appears when a language is missing.
 */
const ARTICLES: ReadonlyArray<DemoArticle> = [
  {
    slug: 'sitiyasyon-ekonomik-nan-peyi-a',
    visibility: 'public',
    translations: [
      {
        lang: 'fr',
        status: 'published',
        title: 'La situation économique et ce que le mouvement propose',
        summary:
          "Un diagnostic de la crise économique, les réponses envisagées et les moyens qu'elles demandent.",
        paragraphs: [
          "Le diagnostic d'abord : sans état des lieux partagé, chaque proposition défend un problème différent.",
          'Les solutions envisagées, les ressources qu’elles demandent et les risques identifiés viennent ensuite.',
        ],
      },
      {
        lang: 'ht',
        status: 'published',
        title: 'Sitiyasyon ekonomik la ak sa mouvman an pwopoze',
        summary:
          'Yon dyagnostik sou kriz ekonomik la, repons nou anvizaje yo ak mwayen yo mande.',
        paragraphs: [
          'Dyagnostik la anvan : san yon leve kanpe nou tout dakò sou li, chak pwopozisyon ap defann yon pwoblèm diferan.',
          'Solisyon yo, resous yo mande ak risk nou idantifye yo vini apre.',
        ],
      },
    ],
  },
  {
    /**
     * The long-form case: a policy proposal with sections, not an essay.
     *
     * Nothing caps an article's length, so a fifty-page proposal is one
     * article. This one is short enough to seed and structured enough to
     * produce a contents list, which is the thing that makes a long document
     * navigable rather than merely long — and the only article here that
     * exercises it.
     */
    slug: 'reforme-de-ladministration-publique',
    visibility: 'public',
    translations: [
      {
        lang: 'fr',
        status: 'published',
        title: "Proposition pour la réforme de l'administration publique",
        summary:
          "Un diagnostic de l'administration, ce que nous proposons, les moyens que cela demande et la manière dont nous saurons si cela a marché.",
        paragraphs: [
          "Ce texte est une proposition soumise au cercle, pas une position arrêtée. Il suit les cinq champs que le mouvement exige de toute proposition documentée.",
          { heading: 'Diagnostic' },
          "L'administration publique haïtienne ne manque pas de textes ; elle manque de continuité. Un fonctionnaire compétent voit son service réorganisé à chaque changement de ministre, et le savoir accumulé part avec lui.",
          "Sans état des lieux partagé, chaque proposition défend un problème différent. Celui-ci part de trois constats vérifiables.",
          { heading: 'Ce que nous proposons', level: 2 },
          "Trois mesures, dans l'ordre où elles doivent être prises.",
          { heading: 'Un corps administratif protégé du cycle politique', level: 3 },
          "Les postes techniques cessent d'être des nominations. Le recrutement se fait sur concours publié, et la révocation demande un motif écrit et versé au dossier.",
          { heading: 'Une mémoire administrative écrite', level: 3 },
          "Chaque service publie une note de passation à chaque changement de responsable. Sans cela, la compétence d'un service est la mémoire d'une personne.",
          { heading: 'Moyens et calendrier' },
          "La première mesure ne demande pas de budget nouveau : elle demande de publier ce qui existe déjà. La deuxième demande un archiviste par ministère.",
          { heading: 'Risques identifiés' },
          "Le risque principal est qu'un corps protégé devienne un corps fermé. La réponse proposée est la publication des concours et des motifs de révocation.",
          { heading: 'Indicateurs de réussite' },
          "Une priorité que personne ne peut vérifier est une intention. Nous mesurerons la part des postes techniques pourvus sur concours, et le nombre de services ayant publié une note de passation.",
        ],
      },
      {
        lang: 'ht',
        status: 'published',
        title: 'Pwopozisyon pou refòm administrasyon piblik la',
        summary:
          'Yon dyagnostik sou administrasyon an, sa nou pwopoze, mwayen sa mande ak kijan n ap konnen si li mache.',
        paragraphs: [
          'Tèks sa a se yon pwopozisyon nou soumèt bay sèk la, se pa yon pozisyon ki fin deside.',
          { heading: 'Dyagnostik' },
          'Administrasyon piblik ayisyen an pa manke tèks ; li manke kontinyite. Chak fwa gen yon nouvo minis, yo reòganize sèvis yo, epi konesans ki te ranmase a ale ak moun ki pati a.',
          { heading: 'Sa nou pwopoze' },
          'Twa mezi, nan lòd yo dwe pran yo.',
          { heading: 'Mwayen ak kalandriye' },
          'Premye mezi a pa mande yon nouvo bidjè : li mande pou nou pibliye sa ki deja egziste.',
          { heading: 'Risk nou idantifye' },
          'Pi gwo risk la se yon kò ki pwoteje ka vin yon kò ki fèmen.',
          { heading: 'Endikatè siksè' },
          'Yon priyorite pèsonn pa ka verifye se yon entansyon. N ap mezire konbyen pòs teknik yo bay apre yon konkou.',
        ],
      },
    ],
  },
  {
    slug: 'leducation-comme-priorite',
    visibility: 'public',
    translations: [
      {
        lang: 'fr',
        status: 'published',
        title: "L'éducation comme priorité vérifiable",
        summary:
          "Pourquoi une priorité sans indicateur de réussite n'est qu'une intention, et ce que nous mesurerons.",
        paragraphs: [
          'Une priorité que personne ne peut vérifier est une intention, pas un engagement.',
          'Cet article propose trois indicateurs et la manière de les publier chaque trimestre.',
        ],
      },
    ],
  },
  {
    slug: 'bouyon-pou-soumet',
    visibility: 'public',
    translations: [
      {
        lang: 'fr',
        status: 'draft',
        title: 'Le budget national et ses angles morts',
        summary:
          "Ce que le budget publié ne dit pas, et les trois questions que le cercle propose de poser.",
        paragraphs: [
          'Un brouillon terminé, prêt à être soumis au cercle : il sert au test de soumission.',
        ],
      },
    ],
  },
  {
    slug: 'bouyon-pou-enpote',
    visibility: 'public',
    translations: [
      {
        lang: 'fr',
        status: 'draft',
        title: "Un brouillon prêt pour l'import",
        summary:
          "Un brouillon que la suite d'import remplace par un fichier Word ; il n'appartient à aucun autre test.",
        paragraphs: ['Ce texte sera remplacé par le contenu du document importé.'],
      },
    ],
  },
  {
    slug: 'pwopozisyon-san-panel',
    visibility: 'public',
    translations: [
      {
        lang: 'fr',
        status: 'draft',
        title: 'La décentralisation comme condition',
        summary:
          "Pourquoi les décisions prises depuis Port-au-Prince ne tiennent pas dans les communes qui doivent les appliquer.",
        paragraphs: [
          "Le diagnostic porte sur l'écart entre la décision et son application locale.",
        ],
      },
    ],
  },
  {
    slug: 'pwopozisyon-sou-eneji',
    visibility: 'public',
    translations: [
      {
        lang: 'fr',
        status: 'draft',
        title: "L'accès à l'électricité comme préalable",
        summary:
          "Pourquoi aucune des autres priorités ne tient sans un accès à l'électricité mesurable et vérifiable.",
        paragraphs: [
          'Le diagnostic porte sur la couverture réelle, heure par heure, et non sur la capacité installée.',
        ],
      },
    ],
  },
  {
    slug: 'note-interne-cercle-economie',
    visibility: 'members',
    translations: [
      {
        lang: 'fr',
        status: 'draft',
        title: 'Note de travail du Cercle Économie',
        summary:
          "Un brouillon interne : ce que le cercle doit trancher avant de proposer une position publique.",
        paragraphs: ['Brouillon. Rien ici n’a encore été soumis au cercle.'],
      },
    ],
  },
]

/**
 * Replace the demo articles wholesale.
 *
 * Like the applications above, these are reset rather than skipped: a run that
 * published the draft would leave the next run's editor test with nothing
 * unpublished to work on.
 */
async function resetArticles(authorId: string, allAuthors: Array<string>): Promise<void> {
  // Everything these accounts wrote, not only the known slugs: the end-to-end
  // suite publishes an article of its own, and leaving it behind would grow the
  // public index by one every run.
  const existing = await db
    .select({ id: article.id })
    .from(article)
    .where(inArray(article.authorId, allAuthors))
  if (existing.length > 0) {
    const ids = existing.map((row) => row.id)
    const submissions = await db
      .select({ id: articleSubmission.id })
      .from(articleSubmission)
      .where(inArray(articleSubmission.articleId, ids))
    if (submissions.length > 0) {
      const submissionIds = submissions.map((row) => row.id)
      await db
        .delete(articleDecision)
        .where(inArray(articleDecision.submissionId, submissionIds))
      await db.delete(articleReview).where(inArray(articleReview.submissionId, submissionIds))
      await db
        .delete(articleReviewer)
        .where(inArray(articleReviewer.submissionId, submissionIds))
      await db.delete(articleSubmission).where(inArray(articleSubmission.id, submissionIds))
    }
    await db.delete(articleRevision).where(inArray(articleRevision.articleId, ids))
    await db.delete(articleTranslation).where(inArray(articleTranslation.articleId, ids))
    await db.delete(article).where(inArray(article.id, ids))
  }

  for (const entry of ARTICLES) {
    const id = randomUUID()
    const published = entry.translations.some((t) => t.status === 'published')
    const now = new Date()

    await db.insert(article).values({
      id,
      slug: entry.slug,
      authorId,
      visibility: entry.visibility,
      status: published ? 'published' : 'draft',
      publishedAt: published ? now : null,
    })

    for (const translation of entry.translations) {
      const content = demoDocument(translation.paragraphs)
      await db.insert(articleTranslation).values({
        articleId: id,
        lang: translation.lang,
        title: translation.title,
        summary: translation.summary,
        contentJson: content,
        status: translation.status,
        publishedAt: translation.status === 'published' ? now : null,
      })
      await db.insert(articleRevision).values({
        id: randomUUID(),
        articleId: id,
        lang: translation.lang,
        title: translation.title,
        summary: translation.summary,
        contentJson: content,
        createdBy: authorId,
      })
    }
  }
}


/**
 * A discussion under the published article.
 *
 * Seeded so the article page's tail has something in it on a fresh database:
 * the count and the excerpt are the part a reader sees first, and an empty
 * forum tests only the empty case. The posts hang off the article, so
 * `resetArticles` above has already removed the previous run's — the foreign
 * key cascades.
 */
async function seedForum(ids: Record<string, string>): Promise<void> {
  const [target] = await db
    .select({ id: article.id })
    .from(article)
    .where(eq(article.slug, 'sitiyasyon-ekonomik-nan-peyi-a'))
    .limit(1)
  if (!target) return

  const conversation = [
    {
      authorId: ids.reader,
      lang: 'fr',
      body: "Le diagnostic me paraît juste, mais il ne dit rien de l'agriculture, qui fait vivre la majorité du pays.",
    },
    {
      authorId: ids.confirmed,
      lang: 'ht',
      body: 'Se yon bon remak. Nou te chwazi kòmanse ak de sektè pou nòt la rete kout, men agrikilti a merite pwòp nòt pa l.',
    },
    {
      authorId: ids.newcomer,
      lang: 'fr',
      body: "Est-ce que les chiffres cités viennent des journaux officiels ? J'aimerais pouvoir les vérifier moi-même.",
    },
  ]

  let written = 0
  let parentId: string | null = null
  for (const post of conversation) {
    const id = randomUUID()
    // The second one answers the first, so the seeded thread exercises a reply
    // as well as a top-level post.
    const now = new Date(Date.now() - (conversation.length - written) * 60_000)
    await db.insert(forumPost).values({
      id,
      articleId: target.id,
      lang: post.lang,
      authorId: post.authorId,
      parentId: written === 1 ? parentId : null,
      body: post.body,
      status: 'visible',
      createdAt: now,
      changedAt: now,
    })
    if (written === 0) parentId = id
    written += 1
  }
}

const DOCUMENTATION = {
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

/**
 * Two deliberations, at the two states the end-to-end tests need.
 *
 * The first is waiting for a panel, so a senior member can be watched naming a
 * contradictor and being refused a debate until the quorum is met. The second is
 * already in debate with every assigned reviewer's verdict recorded, so the
 * decision itself can be exercised in a single sign-in — the suite shares one
 * per-IP throttle bucket, and four sign-ins to reach one button is how a test
 * run locks out the next.
 */
async function resetDeliberations(ids: Record<string, string>): Promise<void> {
  // A submission with no panel yet, so the quorum refusal can be exercised
  // without depending on another test having filed one first. The suite runs
  // `fullyParallel`, which means tests inside one file race each other too —
  // every test owns its own fixture or it owns its own flake.
  const [noPanel] = await db
    .select({ id: article.id })
    .from(article)
    .where(eq(article.slug, 'pwopozisyon-san-panel'))
  if (noPanel) {
    await db.insert(articleSubmission).values({
      id: randomUUID(),
      articleId: noPanel.id,
      round: 1,
      langs: ['fr'],
      submittedBy: ids.confirmed,
      status: 'open',
      ...DOCUMENTATION,
    })
    await db
      .update(article)
      .set({ status: 'submitted' })
      .where(eq(article.id, noPanel.id))
  }

  const [awaitingPanel] = await db
    .select({ id: article.id })
    .from(article)
    .where(eq(article.slug, 'pwopozisyon-sou-eneji'))
  if (!awaitingPanel) return

  const submissionId = randomUUID()
  await db.insert(articleSubmission).values({
    id: submissionId,
    articleId: awaitingPanel.id,
    round: 1,
    langs: ['fr'],
    submittedBy: ids.confirmed,
    status: 'in_review',
    ...DOCUMENTATION,
  })

  // The author is `confirmed`, so the panel is drawn from everybody else.
  const panel: Array<[string, 'contradictor' | 'reviewer']> = [
    [ids.senior2, 'contradictor'],
    [ids.senior3, 'reviewer'],
    [ids.blockable, 'reviewer'],
  ]
  for (const [userId, stance] of panel) {
    await db.insert(articleReviewer).values({
      submissionId,
      userId,
      stance,
      assignedBy: ids.senior,
    })
    await db.insert(articleReview).values({
      id: randomUUID(),
      submissionId,
      reviewerId: userId,
      lang: 'fr',
      verdict: 'support',
      rationale:
        'Le diagnostic tient, les indicateurs sont vérifiables et les risques sont nommés.',
    })
  }

  await db
    .update(article)
    .set({ status: 'in_review' })
    .where(eq(article.id, awaitingPanel.id))
}

async function main() {
  if (process.env.NODE_ENV === 'production' && process.env.ALLOW_INSECURE_LOCAL !== 'true') {
    console.error(
      'Refusing to seed demo accounts in production: they have a known password.',
    )
    process.exit(1)
  }

  // Clear the throttle counters. Repeated sign-ins during local testing trip
  // the per-IP limit, and behind no proxy every local client shares the single
  // `unknown` bucket — so one test run locks out the next.
  await db.delete(authThrottle)
  console.info('· cleared rate-limit counters')

  const ids: Record<string, string> = {}
  for (const account of ACCOUNTS) {
    ids[account.key] = await ensureAccount(account)
  }
  // Governance state is cleared wholesale: a previous run's nomination would
  // block a new one, and a spent invitation cannot be spent again.
  await db.delete(seniorPromotionVote)
  await db.delete(seniorPromotion)
  await db.delete(invitation)
  console.info('· cleared nominations and invitations')

  await resetApplication(ids.applicant, 'pending')
  console.info('· applicant has a pending application')

  // The newcomer must arrive with nothing on file: their test is the one that
  // actually submits the form, and the application it leaves behind would stop
  // the next run from reaching it.
  await clearApplications(ids.newcomer)
  console.info('· newcomer has no application on file')

  // The probationer is already admitted, so their application is approved and
  // their contribution plan is what the confirmation queue judges them against.
  await resetApplication(ids.probationer, 'approved')
  await ensureProbationDue(ids.probationer)
  console.info('· probationer is a member whose six months have elapsed')

  for (const key of ['confirmed', 'blockable'] as const) {
    await resetApplication(ids[key], 'approved')
  }
  await confirmMember(ids.confirmed)
  await confirmMember(ids.blockable)
  console.info('· confirmed and blockable are members past their probation')

  await resetArticles(ids.confirmed, Object.values(ids))
  console.info('· demo articles: two published (one French-only), one members-only draft')

  await seedForum(ids)
  console.info('· a seeded discussion under the published article')

  await resetDeliberations(ids)
  console.info(
    '· one submission with no panel, one in debate with every verdict recorded',
  )

  console.info(`\nDemo accounts (password: ${PASSWORD})`)
  for (const account of ACCOUNTS) {
    console.info(`  ${account.email.padEnd(22)} ${account.role}`)
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err)
    process.exit(1)
  })
