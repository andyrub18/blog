import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import { env } from '../../env'
import * as schema from './schema'
import { onDatabaseClose } from './shutdown'

const queryClient = postgres(env.DATABASE_URL)
// Queries still running get five seconds; then the connections are dropped.
onDatabaseClose(() => queryClient.end({ timeout: 5 }))

export const db = drizzle(queryClient, { schema })

export type DB = typeof db
