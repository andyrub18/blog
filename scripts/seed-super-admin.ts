/**
 * Seed the Super admin from env vars.
 * Run with: npm run db:seed
 */
import { eq } from 'drizzle-orm'
import { db } from '../src/lib/db'
import { user as userTable } from '../src/lib/db/schema'
import { auth } from '../src/lib/auth'

async function main() {
  const email = (process.env.SUPER_ADMIN_EMAIL ?? '').trim().toLowerCase()
  const password = process.env.SUPER_ADMIN_PASSWORD ?? ''
  const name = (process.env.SUPER_ADMIN_NAME ?? 'Super Admin').trim()

  if (!email || !password) {
    console.error(
      'Missing SUPER_ADMIN_EMAIL or SUPER_ADMIN_PASSWORD environment variables.',
    )
    process.exit(1)
  }
  if (password.length < 8) {
    console.error('SUPER_ADMIN_PASSWORD must be at least 8 characters.')
    process.exit(1)
  }

  const existing = await db
    .select({ id: userTable.id, role: userTable.role })
    .from(userTable)
    .where(eq(userTable.email, email))
    .limit(1)

  if (existing.length > 0) {
    if (existing[0].role !== 'super_admin') {
      await db
        .update(userTable)
        .set({ role: 'super_admin', emailVerified: true, memberStatus: 'active' })
        .where(eq(userTable.id, existing[0].id))
      console.log(`Promoted existing user ${email} to super_admin.`)
    } else {
      console.log(`Super admin ${email} already exists. Skipping.`)
    }
    return
  }

  const result = await auth.api.signUpEmail({
    body: { name, email, password },
    headers: new Headers(),
  })

  await db
    .update(userTable)
    .set({ role: 'super_admin', emailVerified: true, memberStatus: 'active' })
    .where(eq(userTable.id, result.user.id))

  console.log(`Created super admin ${email}.`)
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err)
    process.exit(1)
  })
