import { eq, lt, sql } from 'drizzle-orm'
import { authThrottle } from './db/schema'

/**
 * The database is imported lazily, not at module scope.
 *
 * `RULES` and `clientIp` are pure and are read by code — and tests — that has
 * no business opening a connection. A top-level `import { db }` made merely
 * naming a rule require DATABASE_URL.
 */
async function database() {
  const { db } = await import('./db')
  return db
}

export type RateLimitRule = {
  /** Attempts permitted inside one window. */
  limit: number
  /** Window length in seconds. */
  windowSeconds: number
}

export type RateLimitResult = {
  allowed: boolean
  remaining: number
  /** Seconds until the window resets. */
  retryAfter: number
}

/**
 * Limits for the endpoints an attacker actually targets.
 *
 * These are deliberately tight. Nobody legitimately signs up eight times in an
 * hour from one address, and the cost of a slightly annoyed genuine user is far
 * below the cost of an enumerated member roster.
 */
export const RULES = {
  /**
   * Deliberately generous, and cleared by a successful sign-in.
   *
   * Many of KLE's readers reach the site from a shared connection — a
   * cybercafé, an office, a mobile carrier behind NAT — so one address is one
   * neighbourhood, not one person. A tight per-IP limit would lock all of them
   * out together. The defence against credential stuffing is `signInPerEmail`
   * below, which is keyed to the account actually under attack.
   */
  signIn: { limit: 30, windowSeconds: 15 * 60 },
  signInPerEmail: { limit: 10, windowSeconds: 60 * 60 },
  signUp: { limit: 5, windowSeconds: 60 * 60 },
  resendVerification: { limit: 5, windowSeconds: 60 * 60 },
  // The invitation lookup is public by necessity — the holder has no account
  // yet. A 32-byte token is not guessable, so this is not really brute-force
  // defence; it stops the endpoint being used as a free probe.
  inviteLookup: { limit: 30, windowSeconds: 15 * 60 },
} as const satisfies Record<string, RateLimitRule>

export type RateLimitAction = keyof typeof RULES

/**
 * Consume one unit against `key`, atomically.
 *
 * The upsert is a single statement so two concurrent requests cannot both read
 * a stale count and both be allowed through. The `CASE` resets the window in
 * the same statement when the previous one has expired.
 */
export async function consume(
  key: string,
  rule: RateLimitRule,
): Promise<RateLimitResult> {
  const now = new Date()
  const expiresAt = new Date(now.getTime() + rule.windowSeconds * 1000)

  const db = await database()
  // Dates are passed as ISO strings with an explicit cast. A raw JS `Date`
  // inside a `sql` template is handed to the driver unserialised and throws
  // `The "string" argument must be of type string ... Received an instance of
  // Date`, which would make every call to this function fail.
  const nowIso = now.toISOString()
  const expiresIso = expiresAt.toISOString()

  const [row] = await db
    .insert(authThrottle)
    .values({ key, count: 1, expiresAt })
    .onConflictDoUpdate({
      target: authThrottle.key,
      set: {
        count: sql`CASE WHEN ${authThrottle.expiresAt} <= ${nowIso}::timestamptz THEN 1 ELSE ${authThrottle.count} + 1 END`,
        expiresAt: sql`CASE WHEN ${authThrottle.expiresAt} <= ${nowIso}::timestamptz THEN ${expiresIso}::timestamptz ELSE ${authThrottle.expiresAt} END`,
      },
    })
    .returning({ count: authThrottle.count, expiresAt: authThrottle.expiresAt })

  const count = row?.count ?? 1
  const resetAt = row?.expiresAt ?? expiresAt
  const retryAfter = Math.max(0, Math.ceil((resetAt.getTime() - now.getTime()) / 1000))

  return {
    allowed: count <= rule.limit,
    remaining: Math.max(0, rule.limit - count),
    retryAfter,
  }
}

/** Clear a counter — used when a sign-in succeeds. */
export async function reset(key: string): Promise<void> {
  const db = await database()
  await db.delete(authThrottle).where(eq(authThrottle.key, key))
}

/** Opportunistic sweep of expired rows, so the table does not grow forever. */
export async function sweepExpired(): Promise<void> {
  const db = await database()
  await db.delete(authThrottle).where(lt(authThrottle.expiresAt, new Date()))
}

/**
 * Best-effort client address.
 *
 * `x-forwarded-for` is only trustworthy when the app sits behind a proxy that
 * overwrites it. On a managed host that is the case; if this ever runs without
 * one, a client can forge the header and sidestep per-IP limits. The per-email
 * counter is the backstop for that.
 *
 * The `unknown` fallback deserves care in deployment: with no proxy header at
 * all, every caller shares one bucket and they throttle each other. That is the
 * safe direction to fail, but it makes the site unusable under any real load,
 * so confirm the host sets `x-forwarded-for` before launch.
 */
export function clientIp(headers: Headers): string {
  const forwarded = headers.get('x-forwarded-for')
  if (forwarded) {
    const first = forwarded.split(',')[0]?.trim()
    if (first) return first
  }
  return headers.get('cf-connecting-ip') ?? headers.get('x-real-ip') ?? 'unknown'
}
