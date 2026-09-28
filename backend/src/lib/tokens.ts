import { sign, verify } from 'hono/jwt'

const SECRET = process.env.BETTER_AUTH_SECRET || 'default-fallback-signing-secret-key-321'

export async function issueSigningToken(signerId: string): Promise<string> {
  const payload = {
    signerId,
    exp: Math.floor(Date.now() / 1000) + 60 * 60 * 24 * 30, // 30 days expiration
  }
  return await sign(payload, SECRET, 'HS256')
}

export async function verifySigningToken(token: string): Promise<{ signerId: string }> {
  const payload = await verify(token, SECRET, 'HS256')
  if (!payload || typeof payload.signerId !== 'string') {
    throw new Error('Invalid or expired signing token')
  }
  return { signerId: payload.signerId }
}
