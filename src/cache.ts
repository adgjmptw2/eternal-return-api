/**
 * Where `ErClient` keeps responses. Values are JSON strings. Methods may be
 * sync or async, so a Redis client fits with a two-line adapter.
 */
export interface CacheStore {
  get(key: string): Promise<string | null | undefined> | string | null | undefined
  set(key: string, value: string, ttlMs: number): Promise<unknown> | unknown
}

export type CacheKind = 'nickname' | 'userGames' | 'game' | 'rank' | 'topRanks' | 'stats' | 'data' | 'other'

/** Default time to keep each kind of response, in ms. 0 means do not cache. */
export const DEFAULT_CACHE_TTL_MS: Readonly<Record<CacheKind, number>> = Object.freeze({
  nickname: 10 * 60_000,
  userGames: 60_000,
  // A finished game never changes.
  game: 60 * 60_000,
  rank: 60_000,
  topRanks: 5 * 60_000,
  stats: 5 * 60_000,
  data: 60 * 60_000,
  other: 0,
})

export function cacheKindOf(path: string): CacheKind {
  if (path.startsWith('/v1/user/nickname')) return 'nickname'
  if (path.startsWith('/v1/user/games/')) return 'userGames'
  if (path.startsWith('/v1/games/')) return 'game'
  if (path.startsWith('/v1/rank/top/')) return 'topRanks'
  if (path.startsWith('/v1/rank/')) return 'rank'
  if (path.startsWith('/v2/user/stats/')) return 'stats'
  if (path.startsWith('/v2/data/')) return 'data'
  return 'other'
}

/** In-memory cache with a size limit; drops the least recently used entry first. */
export class MemoryCache implements CacheStore {
  private readonly entries = new Map<string, { value: string; expiresAt: number }>()
  private readonly maxEntries: number
  private readonly now: () => number

  constructor(options: { maxEntries?: number; now?: () => number } = {}) {
    this.maxEntries = options.maxEntries ?? 1000
    this.now = options.now ?? Date.now
  }

  get size(): number {
    return this.entries.size
  }

  get(key: string): string | undefined {
    const entry = this.entries.get(key)
    if (!entry) return undefined
    this.entries.delete(key)
    if (entry.expiresAt <= this.now()) return undefined
    this.entries.set(key, entry)
    return entry.value
  }

  set(key: string, value: string, ttlMs: number): void {
    this.entries.delete(key)
    if (ttlMs <= 0 || this.maxEntries <= 0) return
    this.entries.set(key, { value, expiresAt: this.now() + ttlMs })
    while (this.entries.size > this.maxEntries) {
      const oldest = this.entries.keys().next().value as string
      this.entries.delete(oldest)
    }
  }
}
