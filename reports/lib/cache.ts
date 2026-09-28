import { CACHE_TTL } from './constants'
import { logger } from './logger'

// Simple in-memory cache with TTL
class InMemoryCache {
  private cache: Map<string, { value: unknown; expires: number }> = new Map()

  set(key: string, value: unknown, ttl: number = CACHE_TTL.MEDIUM): void {
    const expires = Date.now() + ttl * 1000
    this.cache.set(key, { value, expires })
  }

  get<T = unknown>(key: string): T | null {
    const item = this.cache.get(key)
    if (!item) return null

    if (Date.now() > item.expires) {
      this.cache.delete(key)
      return null
    }

    return item.value as T
  }

  delete(key: string): void {
    this.cache.delete(key)
  }

  clear(): void {
    this.cache.clear()
  }

  // Clean up expired entries
  cleanup(): void {
    const now = Date.now()
    for (const [key, item] of this.cache.entries()) {
      if (now > item.expires) {
        this.cache.delete(key)
      }
    }
  }
}

// Create cache instance
export const cache = new InMemoryCache()

// Cleanup expired entries every 5 minutes
if (typeof window === 'undefined') {
  setInterval(
    () => {
      cache.cleanup()
    },
    5 * 60 * 1000
  )
}

/**
 * Cache wrapper for async functions
 */
export async function withCache<T>(
  key: string,
  fn: () => Promise<T>,
  ttl: number = CACHE_TTL.MEDIUM
): Promise<T> {
  // Try to get from cache
  const cached = cache.get<T>(key)
  if (cached !== null) {
    logger.debug({ key }, 'Cache hit')
    return cached
  }

  // Cache miss - execute function
  logger.debug({ key }, 'Cache miss')
  const result = await fn()
  cache.set(key, result, ttl)
  return result
}

/**
 * Invalidate cache keys by pattern
 */
export function invalidateCache(pattern: string): void {
  // For simple pattern matching (starts with)
  // Access private cache property via type assertion
  interface CacheWithPrivate {
    cache: Map<string, { value: unknown; expires: number }>
  }
  const cacheInstance = cache as unknown as CacheWithPrivate
  const keys = Array.from(cacheInstance.cache.keys())
  for (const key of keys) {
    if (key.startsWith(pattern)) {
      cache.delete(key)
      logger.debug({ key }, 'Cache invalidated')
    }
  }
}
