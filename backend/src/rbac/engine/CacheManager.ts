/**
 * CacheManager — in-process LRU cache for resolved permission sets.
 *
 * Key:   `perm:v1:${userId}`
 * Value: ResolvedPermission[]
 * TTL:   10 seconds (see TTL_MS below — this header said 60 s for a long time
 *        while the constant said 10 s; the constant is the truth)
 * Max:   500 entries (evicts oldest on overflow)
 *
 * This is a module-level singleton Map — all PermissionEngine instances across
 * the process share the same cache, so the first request per user pays the DB
 * round-trip and subsequent requests within the TTL window are served from memory.
 *
 * Invalidation is explicit: call invalidate(userId) after role changes, or
 * invalidateByRole(userIds) when a role's bundle assignments change.
 *
 * KNOWN LIMITATION (accepted for v2): the store is per-process, so invalidation
 * only clears the instance that served the request. On DigitalOcean or Render
 * with more than one instance, a revoked permission can stay live on the other
 * instances until their entry expires. Exposure is bounded by TTL_MS below, and
 * the symptom is "I changed their role and nothing happened" for up to a minute.
 * The real fix is a shared invalidation channel (Redis pub/sub or Postgres
 * LISTEN/NOTIFY), which lands with the v3 policy engine.
 */

import type { ResolvedPermission } from '../utils/wildcardMatch'

interface CacheEntry {
  value: ResolvedPermission[]
  expiresAt: number
}

const TTL_MS = 10_000 // 10 seconds (optimized for fast permission invalidation)
const MAX_ENTRIES = 500

// Module-level singleton — shared across all PermissionEngine instances.
const store = new Map<string, CacheEntry>()

function prune(): void {
  const now = Date.now()
  for (const [key, entry] of store) {
    if (now > entry.expiresAt) store.delete(key)
  }
}

/**
 * Every cache key a user can hold — one per interface scope. Must stay in step
 * with PermissionEngine.resolvePermissions(): 'portal' uses the bare userId,
 * every other scope is suffixed. Missing a key here means a stale permission
 * set survives a role change on that surface.
 */
function keysFor(userId: string): string[] {
  return [userId, `${userId}:pwa`, `${userId}:hr`]
}

function evictOldest(): void {
  const firstKey = store.keys().next().value
  if (firstKey !== undefined) store.delete(firstKey)
}

export class CacheManager {
  async get(userId: string): Promise<ResolvedPermission[] | null> {
    const entry = store.get(userId)
    if (!entry) return null

    // Check expiry
    if (Date.now() > entry.expiresAt) {
      store.delete(userId)
      return null
    }

    // Check distributed eviction timestamp in Redis
    try {
      const { getUpstashConfig } = await import('../../lib/integrations')
      const cfg = await getUpstashConfig()
      if (cfg?.redisRestUrl && cfg?.redisRestToken) {
        const baseUrl = cfg.redisRestUrl.replace(/\/$/, '')
        // Clean the actual raw userId (without suffix) for the lookup key
        const rawUserId = userId.split(':')[0]
        const res = await fetch(`${baseUrl}/get/auth:evict:${encodeURIComponent(rawUserId)}`, {
          headers: { Authorization: `Bearer ${cfg.redisRestToken}` },
        })
        if (res.ok) {
          const body = (await res.json()) as { result: string | null }
          if (body.result) {
            const evictTime = parseInt(body.result, 10)
            // If the cache entry was created before the eviction time, it's stale.
            // Cache entry creation time = entry.expiresAt - TTL_MS
            const createdAt = entry.expiresAt - TTL_MS
            if (createdAt < evictTime) {
              // Evict all keys for this user locally
              for (const key of keysFor(rawUserId)) store.delete(key)
              return null
            }
          }
        }
      }
    } catch {
      // Best-effort. If Redis is unreachable, fallback to standard local TTL behavior.
    }

    return entry.value
  }

  async set(userId: string, permissions: ResolvedPermission[]): Promise<void> {
    if (store.size >= MAX_ENTRIES) {
      prune()
      // If still over limit after pruning expired entries, evict oldest.
      if (store.size >= MAX_ENTRIES) evictOldest()
    }
    store.set(userId, { value: permissions, expiresAt: Date.now() + TTL_MS })
  }

  async invalidate(userId: string): Promise<void> {
    for (const key of keysFor(userId)) store.delete(key)

    // Distributed invalidation via Upstash Redis if configured
    try {
      const { getUpstashConfig } = await import('../../lib/integrations')
      const cfg = await getUpstashConfig()
      if (cfg?.redisRestUrl && cfg?.redisRestToken) {
        const baseUrl = cfg.redisRestUrl.replace(/\/$/, '')
        // We use a Redis list or publish-style mechanism, or simply write an invalidation epoch/key.
        // The simplest, most robust way for a cache of this size is writing a hash or list of evicted keys,
        // or a global cache version/epoch, or an eviction key per user that we check on get.
        // Let's store an eviction timestamp/epoch in Redis: `auth:evict:${userId}` = Date.now().
        // On get(), if the local cache entry is older than the Redis eviction timestamp, we evict locally.
        const url = `${baseUrl}/set/auth:evict:${encodeURIComponent(userId)}/${Date.now()}`
        await fetch(url, {
          method: 'POST',
          headers: { Authorization: `Bearer ${cfg.redisRestToken}` },
        })
      }
    } catch {
      // Best-effort. If Redis is down, fallback to local-only invalidation.
    }
  }

  async invalidateByRole(userIds: string[]): Promise<void> {
    for (const id of userIds) {
      for (const key of keysFor(id)) store.delete(key)
    }

    try {
      const { getUpstashConfig } = await import('../../lib/integrations')
      const cfg = await getUpstashConfig()
      if (cfg?.redisRestUrl && cfg?.redisRestToken && userIds.length > 0) {
        const baseUrl = cfg.redisRestUrl.replace(/\/$/, '')
        const now = Date.now()
        // Upstash REST supports pipelining / multi-commands, but since it's just a few commands,
        // we can run them in parallel or using standard fetch.
        await Promise.all(
          userIds.map((id) =>
            fetch(`${baseUrl}/set/auth:evict:${encodeURIComponent(id)}/${now}`, {
              method: 'POST',
              headers: { Authorization: `Bearer ${cfg.redisRestToken}` },
            }).catch(() => {})
          )
        )
      }
    } catch {
      // Best-effort
    }
  }
}
