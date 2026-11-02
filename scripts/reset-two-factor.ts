/**
 * Turn off codes at sign-in for one account, from the server (D40).
 *
 *   npm run two-factor:reset -- someone@example.org
 *
 * For a member who has lost their phone and every backup code. There is no way
 * to do this from inside the site, on purpose: a page that switched off
 * somebody else's codes would be the first thing worth stealing a senior
 * member's session for. Whoever runs this has the server, and must first have
 * established, by the means the movement chooses, that the request comes from
 * the account's owner and not from someone who has taken their mailbox.
 *
 * Every session on the account is ended too, so anybody signed in on it is out,
 * and the next sign-in asks for the password alone.
 */
import { eq } from 'drizzle-orm'
import { db } from '../src/lib/db'
import { session, twoFactor, user } from '../src/lib/db/schema'

async function main() {
  const email = (process.argv[2] ?? '').trim().toLowerCase()
  if (!email) {
    console.error('Usage: npm run two-factor:reset -- <email>')
    process.exit(1)
  }

  const [account] = await db
    .select({ id: user.id, twoFactorEnabled: user.twoFactorEnabled })
    .from(user)
    .where(eq(user.email, email))
    .limit(1)
  if (!account) {
    console.error(`No account for ${email}.`)
    process.exit(1)
  }
  if (!account.twoFactorEnabled) {
    console.info(`${email} does not use codes at sign-in. Nothing changed.`)
    process.exit(0)
  }

  await db.transaction(async (tx) => {
    await tx.delete(twoFactor).where(eq(twoFactor.userId, account.id))
    await tx
      .update(user)
      .set({ twoFactorEnabled: false, updatedAt: new Date() })
      .where(eq(user.id, account.id))
    await tx.delete(session).where(eq(session.userId, account.id))
  })
  console.info(
    `Codes at sign-in are off for ${email}, and every session on it has ended. ` +
      'They can turn codes on again from "Sécurité du compte" once signed in.',
  )
  process.exit(0)
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
})
