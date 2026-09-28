import { eq } from 'drizzle-orm'
import { auth } from '../lib/auth' // Adjust path if needed
import { db } from '../lib/db'
import { user } from '../lib/db/schema'

async function main() {
  const email = 'admin@example.com'
  const password = process.env.ADMIN_PASSWORD
  if (!password) {
    console.error('Error: ADMIN_PASSWORD environment variable is required')
    process.exit(1)
  }
  const name = 'Admin User'

  console.log('Creating user...')

  try {
    // 1. Create user via Better Auth
    // signUpEmail usually requires a request context for session, but we can try without it
    // or just accept it might fail to set cookies (which is fine for a script).
    // Actually, better-api might need headers.
    // If this fails, we will use a workaround.
    const res = await auth.api.signUpEmail({
      body: {
        email,
        password,
        name,
      },
    })

    if (!res) {
      console.error('Failed to create user (no response)')
      process.exit(1)
    }

    console.log('User created successfully:', res.user?.email)

    // 2. Assign admin role directly in DB (safest way to ensure it sticks)
    // Check if user exists first to get ID
    const dbUser = await db
      .select()
      .from(user)
      .where(eq(user.email, email))
      .then((rows) => rows[0])

    if (dbUser) {
      await db.update(user).set({ roleId: 'admin' }).where(eq(user.id, dbUser.id))
      console.log("Role updated to 'admin' for:", email)
    } else {
      console.error('User found in response but not in DB?')
    }
  } catch (error) {
    console.error('Error creating user:', error)
    // If error says 'headers' missing, we might need a dummy header object if possible,
    // or we fallback to pure DB insertion if we can hash the password correctly.
  }
  process.exit(0)
}

main()
