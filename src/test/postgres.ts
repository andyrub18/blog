import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  PostgreSqlContainer,
  type StartedPostgreSqlContainer,
} from '@testcontainers/postgresql'
import { drizzle } from 'drizzle-orm/postgres-js'
import { migrate } from 'drizzle-orm/postgres-js/migrator'
import postgres from 'postgres'
import * as schema from '../lib/db/schema'

export type TestDatabase = {
  db: ReturnType<typeof drizzle<typeof schema>>
  /** Connection string for the container, for code that reads DATABASE_URL. */
  url: string
  /**
   * Apply the committed migrations up to and including `tag`, or all of them.
   * Only for tests of a data migration, which have to put rows in the shape
   * they had *before* it ran — see `startTestDatabase({ upTo })`.
   */
  migrateTo: (tag?: string) => Promise<void>
  stop: () => Promise<void>
}

/**
 * A copy of `./drizzle` whose journal stops at `tag`.
 *
 * Drizzle's migrator applies whatever the journal lists, in order, and records
 * what it applied; handing it a shorter journal is how a test stops the schema
 * at an earlier point, and handing it a longer one later carries on from there.
 */
async function migrationsUpTo(
  tag?: string,
): Promise<{ folder: string; dispose: () => Promise<void> }> {
  if (!tag) return { folder: './drizzle', dispose: async () => {} }
  const folder = await mkdtemp(join(tmpdir(), 'klea-migrations-'))
  await cp('./drizzle', folder, { recursive: true })
  const journalPath = join(folder, 'meta', '_journal.json')
  const journal = JSON.parse(await readFile(journalPath, 'utf8')) as {
    entries: Array<{ tag: string }>
  }
  const last = journal.entries.findIndex((entry) => entry.tag === tag)
  if (last === -1) throw new Error(`no migration tagged ${tag}`)
  journal.entries = journal.entries.slice(0, last + 1)
  await writeFile(journalPath, JSON.stringify(journal))
  return { folder, dispose: () => rm(folder, { recursive: true, force: true }) }
}

/**
 * Start a throwaway PostgreSQL and run the real migrations against it.
 *
 * Testing this layer against a real server rather than a mock is the point:
 * the rate limiter's correctness lives in an `INSERT … ON CONFLICT DO UPDATE`
 * with a `CASE` expression, which a fake would simply agree with. Running the
 * committed migrations also means a migration that does not apply cleanly fails
 * here rather than on deploy.
 */
export async function startTestDatabase(
  options: { upTo?: string } = {},
): Promise<TestDatabase> {
  const container: StartedPostgreSqlContainer = await new PostgreSqlContainer(
    'postgres:17-alpine',
  ).start()

  const url = container.getConnectionUri()
  const client = postgres(url, { max: 1 })
  const db = drizzle(client, { schema })

  const migrateTo = async (tag?: string) => {
    const { folder, dispose } = await migrationsUpTo(tag)
    try {
      await migrate(db, { migrationsFolder: folder })
    } finally {
      await dispose()
    }
  }
  await migrateTo(options.upTo)

  return {
    db,
    url,
    migrateTo,
    stop: async () => {
      await client.end()
      await container.stop()
    },
  }
}
