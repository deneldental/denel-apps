// Simple in-memory cache (per-process)
class InMemoryCache {
  private cache: Map<string, { value: any; expires: number }> = new Map()

  set(key: string, value: any, ttlSeconds: number): void {
    const expires = Date.now() + ttlSeconds * 1000
    this.cache.set(key, { value, expires })
  }

  get<T = any>(key: string): T | null {
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
}

export const cache = new InMemoryCache()
