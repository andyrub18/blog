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
  stop: () => Promise<void>
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
export async function startTestDatabase(): Promise<TestDatabase> {
  const container: StartedPostgreSqlContainer = await new PostgreSqlContainer(
    'postgres:17-alpine',
  ).start()

  const url = container.getConnectionUri()
  const client = postgres(url, { max: 1 })
  const db = drizzle(client, { schema })

  await migrate(db, { migrationsFolder: './drizzle' })

  return {
    db,
    url,
    stop: async () => {
      await client.end()
      await container.stop()
    },
  }
}
