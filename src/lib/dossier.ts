import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { join, normalize, sep } from 'node:path'
import { eq } from 'drizzle-orm'
import { accessEvent, memberApplication } from './db/schema'
import type { ApplicationField } from './uploads'

const UPLOAD_ROOT = join(process.cwd(), 'uploads')

export type DossierError = 'NOT_FOUND' | 'UNREADABLE'
export type DossierResult =
  | { ok: true; bytes: Buffer; filename: string }
  | { ok: false; code: DossierError }

const COLUMN_FOR: Record<ApplicationField, keyof typeof memberApplication.$inferSelect> =
  {
    cv: 'cvPath',
    vision: 'visionEssayPath',
    contribution: 'contributionEssayPath',
  }

/**
 * Read one dossier file on behalf of an authorised reviewer, and record it.
 *
 * The access log is the point. These are CVs and political essays belonging to
 * people organising in Haiti; the only honest basis for telling a member their
 * file is not circulating is being able to say who opened it and when. A
 * reviewer who downloads the entire queue leaves a trail.
 *
 * Authorisation is the CALLER's job — this function assumes it has already
 * happened and logs the access as fact.
 */
export async function readDossierFile(input: {
  applicationId: string
  field: ApplicationField
  actorId: string
  ip?: string
}): Promise<DossierResult> {
  const { db } = await import('./db')

  const [application] = await db
    .select()
    .from(memberApplication)
    .where(eq(memberApplication.id, input.applicationId))
    .limit(1)

  if (!application) return { ok: false, code: 'NOT_FOUND' }

  const storedPath = application[COLUMN_FOR[input.field]]
  if (typeof storedPath !== 'string' || storedPath.length === 0) {
    return { ok: false, code: 'NOT_FOUND' }
  }

  // The stored path comes from our own writer, but treat it as untrusted
  // anyway: resolve it and refuse anything that escapes the upload root. A
  // traversal here would turn a reviewer into an arbitrary file reader.
  const absolute = normalize(join(UPLOAD_ROOT, storedPath))
  if (!absolute.startsWith(UPLOAD_ROOT + sep)) {
    return { ok: false, code: 'NOT_FOUND' }
  }

  let bytes: Buffer
  try {
    bytes = await readFile(absolute)
  } catch {
    return { ok: false, code: 'UNREADABLE' }
  }

  await db.insert(accessEvent).values({
    id: randomUUID(),
    actorId: input.actorId,
    resourceType: 'member_application_file',
    resourceId: `${input.applicationId}:${input.field}`,
    action: 'download',
    ip: input.ip ?? null,
  })

  return { ok: true, bytes, filename: `${input.field}.pdf` }
}
