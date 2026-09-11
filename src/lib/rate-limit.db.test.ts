import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { startTestDatabase, type TestDatabase } from '../test/postgres'

let harness: TestDatabase
let limiter: typeof import('./rate-limit')
let schema: typeof import('./db/schema')

beforeAll(async () => {
  harness = await startTestDatabase()
  // The limiter resolves its connection from DATABASE_URL at first use, so the
  // variable must point at the container before the module is imported.
  process.env.DATABASE_URL = harness.url
  limiter = await import('./rate-limit')
  schema = await import('./db/schema')
})

afterAll(async () => {
  await harness?.stop()
})

beforeEach(async () => {
  await harness.db.delete(schema.authThrottle)
})

const RULE = { limit: 3, windowSeconds: 60 }

describe('consume', () => {
  it('allows up to the limit and then refuses', async () => {
    const results = []
    for (let i = 0; i < 4; i++) results.push(await limiter.consume('k', RULE))
    expect(results.map((r) => r.allowed)).toEqual([true, true, true, false])
  })

  it('reports how many attempts remain', async () => {
    expect((await limiter.consume('k', RULE)).remaining).toBe(2)
    expect((await limiter.consume('k', RULE)).remaining).toBe(1)
    expect((await limiter.consume('k', RULE)).remaining).toBe(0)
  })

  it('keeps separate keys independent', async () => {
    for (let i = 0; i < 3; i++) await limiter.consume('a', RULE)
    expect((await limiter.consume('a', RULE)).allowed).toBe(false)
    expect((await limiter.consume('b', RULE)).allowed).toBe(true)
  })

  /**
   * The one that justifies a real database.
   *
   * Ten simultaneous attempts must yield exactly three allowances. A
   * read-then-write limiter passes every sequential test and fails this one,
   * because concurrent requests all read the same stale count — which is
   * precisely the condition an attacker creates.
   */
  it('is atomic under concurrency', async () => {
    const results = await Promise.all(
      Array.from({ length: 10 }, () => limiter.consume('burst', RULE)),
    )
    expect(results.filter((r) => r.allowed)).toHaveLength(3)
  })

  it('starts a fresh window once the old one expires', async () => {
    const instant = { limit: 1, windowSeconds: 1 }
    expect((await limiter.consume('k', instant)).allowed).toBe(true)
    expect((await limiter.consume('k', instant)).allowed).toBe(false)
    await new Promise((r) => setTimeout(r, 1100))
    expect((await limiter.consume('k', instant)).allowed).toBe(true)
  })

  it('does not extend the window on each attempt', async () => {
    // A sliding window would let a steady trickle keep someone locked out
    // forever. This is a fixed window: the reset time must not move.
    const first = await limiter.consume('k', RULE)
    await new Promise((r) => setTimeout(r, 50))
    const second = await limiter.consume('k', RULE)
    expect(second.retryAfter).toBeLessThanOrEqual(first.retryAfter)
  })
})

describe('reset', () => {
  it('clears a counter, as a successful sign-in does', async () => {
    for (let i = 0; i < 3; i++) await limiter.consume('k', RULE)
    expect((await limiter.consume('k', RULE)).allowed).toBe(false)
    await limiter.reset('k')
    expect((await limiter.consume('k', RULE)).allowed).toBe(true)
  })

  it('is harmless for a key that was never used', async () => {
    await expect(limiter.reset('never-seen')).resolves.toBeUndefined()
  })
})

describe('sweepExpired', () => {
  it('removes expired rows and keeps live ones', async () => {
    await limiter.consume('live', RULE)
    await limiter.consume('dead', { limit: 5, windowSeconds: 1 })
    await new Promise((r) => setTimeout(r, 1100))
    await limiter.sweepExpired()

    const rows = await harness.db.select().from(schema.authThrottle)
    expect(rows.map((r) => r.key)).toEqual(['live'])
  })
})

describe('migrations', () => {
  it('apply cleanly from scratch', async () => {
    // startTestDatabase() ran the committed migrations; reaching here at all
    // means they applied. Assert the tables the app depends on exist.
    await expect(harness.db.select().from(schema.authThrottle)).resolves.toBeDefined()
    await expect(harness.db.select().from(schema.rateLimit)).resolves.toBeDefined()
    await expect(harness.db.select().from(schema.user)).resolves.toBeDefined()
    await expect(
      harness.db.select().from(schema.memberApplication),
    ).resolves.toBeDefined()
  })
})
