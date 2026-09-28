/**
 * QStash signature verification.
 *
 * QStash signs every webhook with a JWT in the `Upstash-Signature` header.
 * The JWT body claims include the request body's SHA-256 (`body`) and the
 * target URL (`sub`). We verify the signature against the configured current
 * key, falling back to the next key during rotation.
 */

import { createHash, createHmac, timingSafeEqual } from 'node:crypto'
import { getUpstashConfig } from '../integrations'
import { logger } from '../logger'

interface JwtClaims {
  iss?: string
  sub?: string
  exp?: number
  nbf?: number
  iat?: number
  jti?: string
  body?: string
}

export interface VerifyResult {
  valid: boolean
  reason?: string
}

export async function verifyQStashSignature(
  signature: string | undefined | null,
  rawBody: string,
  targetUrl: string
): Promise<VerifyResult> {
  if (!signature) return { valid: false, reason: 'missing signature' }

  const cfg = await getUpstashConfig()
  if (!cfg?.qstashCurrentSigningKey) {
    return { valid: false, reason: 'qstash signing key not configured' }
  }

  const candidates = [cfg.qstashCurrentSigningKey, cfg.qstashNextSigningKey].filter(Boolean)
  let lastError = 'no candidate keys'
  for (const key of candidates) {
    const r = verifyWithKey(signature, key, rawBody, targetUrl)
    if (r.valid) return r
    lastError = r.reason ?? 'invalid'
  }
  return { valid: false, reason: lastError }
}

function verifyWithKey(
  signature: string,
  key: string,
  rawBody: string,
  targetUrl: string
): VerifyResult {
  const parts = signature.split('.')
  if (parts.length !== 3) return { valid: false, reason: 'malformed jwt' }
  const [encHeader, encPayload, encSig] = parts

  const expectedSigB64 = createHmac('sha256', key).update(`${encHeader}.${encPayload}`).digest()
  const providedSig = base64UrlToBuffer(encSig)
  if (
    providedSig.length !== expectedSigB64.length ||
    !timingSafeEqual(providedSig, expectedSigB64)
  ) {
    return { valid: false, reason: 'signature mismatch' }
  }

  let claims: JwtClaims
  try {
    claims = JSON.parse(base64UrlToBuffer(encPayload).toString('utf8'))
  } catch {
    return { valid: false, reason: 'payload not json' }
  }

  const now = Math.floor(Date.now() / 1000)
  if (claims.exp && claims.exp < now) return { valid: false, reason: 'expired' }
  if (claims.nbf && claims.nbf > now + 5) return { valid: false, reason: 'not yet valid' }

  // Issuer claim MUST be "Upstash" — otherwise a JWT signed with a leaked
  // signing key from another tenant/service could pass verification.
  if (claims.iss !== 'Upstash') {
    logger.warn({ iss: claims.iss }, '[qstash-verify] issuer mismatch')
    return { valid: false, reason: 'issuer mismatch' }
  }

  // Subject claim should match the URL QStash hit.
  if (claims.sub && claims.sub !== targetUrl) {
    logger.warn({ sub: claims.sub, targetUrl }, '[qstash-verify] subject/URL mismatch')
    return { valid: false, reason: 'subject mismatch' }
  }

  // Body claim is sha256(body) base64. Verify it matches what we actually received.
  if (claims.body) {
    const expected = createHash('sha256').update(rawBody).digest('base64url')
    if (claims.body !== expected) {
      return { valid: false, reason: 'body hash mismatch' }
    }
  }

  return { valid: true }
}

function base64UrlToBuffer(s: string): Buffer {
  const pad = s.length % 4 === 0 ? '' : '='.repeat(4 - (s.length % 4))
  return Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/') + pad, 'base64')
}
