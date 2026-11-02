import { DEFAULT_CACHE_TTL_MS, cacheKindOf, type CacheKind, type CacheStore } from './cache.js'
import { ErApiError, ErNicknameMismatchError } from './errors.js'
import { isGameFinished } from './games.js'
import {
  buildGameData,
  type CharacterMasteryRow,
  type GameData,
  type ItemArmorRow,
  type ItemWeaponRow,
} from './gamedata.js'
import { parseL10n } from './l10n.js'
import { RateLimiter, defaultSleep, type Sleep } from './limiter.js'
import { MatchingMode, TeamMode } from './modes.js'
import {
  buildGameNames,
  characterNames,
  type GameNames,
  type TacticalSkillGroupRow,
  type TacticalSkillSetRow,
} from './names.js'
import { SeasonCatalog, type SeasonRow } from './seasons.js'
import type {
  Envelope,
  ErUser,
  TopRankEntry,
  UserGame,
  UserGamesPage,
  UserRank,
  UserStat,
} from './types.js'

export const DEFAULT_BASE_URL = 'https://open-api.bser.io'

/** Longest wait taken from a `Retry-After` header. */
const MAX_RETRY_AFTER_MS = 60_000
/** `Retry-After` of a 429, kept beside the error without adding to its public shape. */
const retryAfter = new WeakMap<ErApiError, number>()

export interface ErClientOptions {
  apiKey: string
  /** Default 1. Match your key's limit. */
  requestsPerSecond?: number
  /** Requests allowed back to back before throttling. Default 1. */
  burst?: number
  /** Per request. Default 9000. */
  timeoutMs?: number
  /** Waits before each retry after HTTP 429. Default [1500, 3000]. Use [] to disable. */
  retryDelaysMs?: number[]
  /** How long the season table is cached. Default 5 minutes. */
  seasonCacheTtlMs?: number
  /**
   * Response cache, off by default. Pass `new MemoryCache()` or your own store
   * (Redis etc.). Only successful responses are cached.
   */
  cache?: CacheStore
  /** Per kind of response, in ms. Defaults: `DEFAULT_CACHE_TTL_MS`. 0 disables a kind. */
  cacheTtlMs?: Partial<Record<CacheKind, number>>
  /** A cache read slower than this counts as a miss. Default 1000. */
  cacheTimeoutMs?: number
  baseUrl?: string
  fetch?: typeof fetch
  /** For tests. */
  sleep?: Sleep
  /** For tests. */
  now?: () => number
}

export interface UserGamesOptions {
  /**
   * Newest `gameId` you already have. Stops there; that game and older ones
   * are not returned. A player's games are sorted by `gameId`, newest first.
   */
  after?: number
  /**
   * Start below this `gameId`: only older games are returned. The API's `next`
   * cursor is a game id, so this jumps there in one request.
   */
  before?: number
  /** Stop once games are older than this. */
  since?: Date
  /** Stop after this many pages. A whole number, 1 or more. */
  maxPages?: number
}

export interface SyncOptions extends UserGamesOptions {
  /** Set by `rest`. The newest game seen before the gap; leave it as it is. */
  resumeNewestGameId?: number
}

export interface SyncResult {
  /** Games newer than `after`, newest first. */
  games: UserGame[]
  /**
   * Save this and pass it as `after` next time. Equals `after` when nothing
   * is new, and while `rest` is set, so saving it never skips games.
   */
  newestGameId: number | undefined
  /**
   * Set when `maxPages` stopped the walk before `after`, `since` or the end:
   * older new games are still missing. Pass it back to `syncUserGames` until
   * no `rest` comes back; the last call's `newestGameId` is the newest game.
   */
  rest?: SyncOptions
}

export interface WatchOptions {
  /**
   * Player uids. An array or a Set is read again every round, so changes to
   * it apply. A function is called before every round. A one-time iterator
   * (such as `map.keys()`) is read once.
   */
  uids: Iterable<string> | (() => Iterable<string>)
  /** Time from the start of one round to the next. Default 60000. */
  intervalMs?: number
  /**
   * Newest `gameId` already handled, per uid, read when a player first
   * appears. Players not in it start from their newest game: their past
   * games are not reported. Set an entry before adding a player to start
   * from a known game.
   */
  after?: Record<string, number> | Map<string, number>
  /** Stops watching. A request already sent finishes first. */
  signal?: AbortSignal
}

export type WatchEvent =
  /** A game the player finished. `game` is the player's own row. */
  | { type: 'game'; uid: string; game: UserGame }
  /**
   * A request for this player failed, or `uid` is null when calling `uids`
   * failed. Watching goes on; the next round tries again.
   */
  | { type: 'error'; uid: string | null; error: unknown }

function normalizeUser(raw: unknown): ErUser | null {
  if (typeof raw !== 'object' || raw === null) return null
  const row = raw as { uid?: unknown; userId?: unknown; nickname?: unknown }
  const uid =
    typeof row.uid === 'string' ? row.uid : typeof row.userId === 'string' ? row.userId : null
  const nickname = typeof row.nickname === 'string' ? row.nickname : ''
  return uid && nickname ? { uid, nickname } : null
}

function sameNickname(a: string, b: string): boolean {
  const norm = (value: string) => value.normalize('NFKC').trim().toLowerCase()
  return norm(a) === norm(b)
}

function arrayField<T>(body: Envelope, key: string): T[] {
  const value = body[key]
  return Array.isArray(value) ? (value as T[]) : []
}

export class ErClient {
  private readonly apiKey: string
  private readonly baseUrl: string
  private readonly timeoutMs: number
  private readonly retryDelaysMs: number[]
  private readonly seasonCacheTtlMs: number
  private readonly fetchImpl: typeof fetch
  private readonly sleep: Sleep
  private readonly now: () => number
  private readonly limiter: RateLimiter
  private readonly cache: CacheStore | null
  private readonly cacheTtlMs: Record<CacheKind, number>
  private readonly cacheTimeoutMs: number
  private readonly inFlight = new Map<string, Promise<string>>()
  /** Responses from another server must not mix with the official API's in a shared cache. */
  private readonly cachePrefix: string

  private seasonCache: { value: SeasonRow[]; expiresAt: number } | null = null
  private seasonLoading: Promise<SeasonRow[]> | null = null
  private readonly l10nLoading = new Map<string, Promise<Map<string, string>>>()
  private readonly namesLoading = new Map<string, Promise<GameNames>>()
  private gameDataLoading: Promise<GameData> | null = null

  constructor(options: ErClientOptions) {
    if (!options.apiKey) throw new TypeError('apiKey is required')
    const rps = options.requestsPerSecond ?? 1
    const burst = options.burst ?? 1
    const timeoutMs = options.timeoutMs ?? 9_000
    if (!(Number.isFinite(rps) && rps > 0)) throw new RangeError('requestsPerSecond must be a positive number')
    if (!(Number.isInteger(burst) && burst >= 1)) throw new RangeError('burst must be a whole number, 1 or more')
    if (!(Number.isFinite(timeoutMs) && timeoutMs > 0)) throw new RangeError('timeoutMs must be a positive number')

    this.apiKey = options.apiKey
    this.baseUrl = (options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, '')
    this.timeoutMs = timeoutMs
    this.retryDelaysMs = options.retryDelaysMs ?? [1_500, 3_000]
    this.seasonCacheTtlMs = options.seasonCacheTtlMs ?? 5 * 60_000
    this.fetchImpl = options.fetch ?? globalThis.fetch.bind(globalThis)
    this.sleep = options.sleep ?? defaultSleep
    this.now = options.now ?? Date.now
    this.limiter = new RateLimiter(Math.ceil(1_000 / rps), burst, this.now, this.sleep)
    this.cache = options.cache ?? null
    this.cacheTtlMs = { ...DEFAULT_CACHE_TTL_MS, ...options.cacheTtlMs }
    this.cacheTimeoutMs = options.cacheTimeoutMs ?? 1_000
    this.cachePrefix = this.baseUrl === DEFAULT_BASE_URL ? 'er:' : `er:${this.baseUrl}:`
  }

  /**
   * GET any API path and return the parsed body. Rate limit, 429 retries and
   * the `code` check apply. Uses the cache when one is set; concurrent calls
   * for the same path then share one request. Use it for endpoints this
   * client does not wrap.
   */
  async request(path: string): Promise<Envelope> {
    return this.load(path)
  }

  /** `fresh` skips the cache. */
  private async load(path: string, fresh = false): Promise<Envelope> {
    const cache = this.cache
    const kind = cacheKindOf(path)
    const ttl = this.cacheTtlMs[kind]
    if (fresh || !cache || !(ttl > 0)) return this.requestWithRetry(path)

    const key = this.cachePrefix + path
    let loading = this.inFlight.get(key)
    if (!loading) {
      // An unfinished game changes as players finish, so it is never cached.
      const keep = kind === 'game' ? (body: Envelope) => isGameFinished(arrayField<UserGame>(body, 'userGames')) : undefined
      loading = this.loadThroughCache(cache, key, path, ttl, keep).finally(() => this.inFlight.delete(key))
      this.inFlight.set(key, loading)
    }
    // Parse per caller so no two callers share one object.
    return JSON.parse(await loading) as Envelope
  }

  /** A slow or broken cache must not block or break requests. */
  private async loadThroughCache(
    cache: CacheStore,
    key: string,
    path: string,
    ttl: number,
    keep?: (body: Envelope) => boolean,
  ): Promise<string> {
    try {
      const hit = await withTimeout(Promise.resolve(cache.get(key)), this.cacheTimeoutMs)
      if (hit) {
        const body: unknown = JSON.parse(hit)
        // A store shared with an older version may hold what `keep` now rejects.
        if (isEnvelope(body) && (!keep || keep(body))) return hit
      }
    } catch {
      // Treat as a miss.
    }
    const body = await this.requestWithRetry(path)
    const text = JSON.stringify(body)
    if (keep && !keep(body)) return text
    // Not awaited: the caller already has its answer.
    Promise.resolve()
      .then(() => cache.set(key, text, ttl))
      .catch(() => {})
    return text
  }

  private async requestWithRetry(path: string): Promise<Envelope> {
    for (let attempt = 0; ; attempt++) {
      await this.limiter.acquire()
      try {
        return await this.requestOnce(path)
      } catch (e) {
        const delay = this.retryDelaysMs[attempt]
        if (!(e instanceof ErApiError) || e.status !== 429 || delay === undefined) throw e
        await this.sleep(Math.max(delay, retryAfter.get(e) ?? 0))
      }
    }
  }

  private resolveUrl(path: string): string {
    // A path without a leading "/" could be glued onto another host and leak the key.
    if (!path.startsWith('/') || path.startsWith('//')) {
      throw new TypeError(`path must start with a single "/": ${path}`)
    }
    const url = new URL(this.baseUrl + path)
    if (url.origin !== new URL(this.baseUrl).origin) {
      throw new TypeError(`path must stay on ${this.baseUrl}: ${path}`)
    }
    return url.href
  }

  /** Fetches and reads the whole body under one timeout. */
  private async fetchText(url: string, init: RequestInit): Promise<{ res: Response; text: string }> {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), this.timeoutMs)
    try {
      const res = await this.fetchImpl(url, { ...init, signal: controller.signal })
      return { res, text: await res.text() }
    } catch (e) {
      if (controller.signal.aborted) {
        throw new ErApiError(504, `Request timed out after ${this.timeoutMs}ms`)
      }
      throw e
    } finally {
      clearTimeout(timer)
    }
  }

  private async requestOnce(path: string): Promise<Envelope> {
    const { res, text } = await this.fetchText(this.resolveUrl(path), {
      headers: { 'x-api-key': this.apiKey, accept: 'application/json' },
      // Never follow redirects: the key header would go along to the new host.
      redirect: 'manual',
    })
    let envelope: Envelope | null = null
    try {
      const body: unknown = JSON.parse(text)
      if (isEnvelope(body)) envelope = body
    } catch {
      // Non-JSON error page. Status below decides.
    }
    const apiCode = typeof envelope?.code === 'number' ? envelope.code : undefined
    const message = envelope?.message ?? `Request failed (HTTP ${res.status})`
    if (!res.ok) {
      const error = new ErApiError(res.status, message, apiCode)
      const seconds = (res.headers.get('retry-after') ?? '').trim()
      if (/^[0-9]+$/.test(seconds)) retryAfter.set(error, Math.min(Number(seconds) * 1_000, MAX_RETRY_AFTER_MS))
      throw error
    }
    if (!envelope) throw new ErApiError(502, 'Response is not JSON')
    // HTTP 200 does not mean success: the body `code` can carry the error.
    if (apiCode !== undefined && apiCode !== 200) throw new ErApiError(apiCode, message, apiCode)
    return envelope
  }

  private async orEmpty<T>(load: () => Promise<T>, empty: T): Promise<T> {
    try {
      return await load()
    } catch (e) {
      if (e instanceof ErApiError && e.status === 404) return empty
      throw e
    }
  }

  /** Nickname → uid. Null if no such player. */
  async getUserByNickname(nickname: string): Promise<ErUser | null> {
    return this.orEmpty(async () => {
      const body = await this.request(`/v1/user/nickname?query=${encodeURIComponent(nickname)}`)
      if (body.user == null) return null
      const user = normalizeUser(body.user)
      if (!user) throw new ErApiError(502, 'Nickname response has no uid or nickname')
      if (!sameNickname(user.nickname, nickname)) {
        throw new ErNicknameMismatchError(nickname, user.nickname)
      }
      return user
    }, null)
  }

  /**
   * One page of a player's recent games, newest first. Each game holds only
   * this player's row; use `getGame` for everyone in it. `fresh` skips the
   * cache, for when the newest game must be current.
   */
  async getUserGames(uid: string, next?: number, options: { fresh?: boolean } = {}): Promise<UserGamesPage> {
    return this.loadUserGames(uid, next, options.fresh === true)
  }

  private async loadUserGames(uid: string, next: number | undefined, fresh: boolean): Promise<UserGamesPage> {
    return this.orEmpty<UserGamesPage>(async () => {
      const suffix = next !== undefined ? `?next=${next}` : ''
      const body = await this.load(`/v1/user/games/uid/${encodeURIComponent(uid)}${suffix}`, fresh)
      return {
        games: arrayField<UserGame>(body, 'userGames'),
        next: typeof body.next === 'number' ? body.next : undefined,
      }
    }, { games: [] })
  }

  /** Walks `getUserGames` pages until the end, `after`, `since`, or `maxPages`. */
  async *iterateUserGames(uid: string, options: UserGamesOptions = {}): AsyncGenerator<UserGame> {
    yield* this.walkUserGames(uid, options, false)
  }

  /**
   * Games newer than `after`, in one array. Paging stops at `after`, so a
   * player with a few new games costs one request.
   *
   * ```ts
   * const { games, newestGameId } = await er.syncUserGames(uid, { after: saved })
   * // store games, then save newestGameId as the next `after`
   * ```
   *
   * Without `after` this reads the whole list (about 90 days); pass `since`
   * or `maxPages` for a first sync. The first page skips the cache, so new
   * games show up at once; older pages may come from it.
   */
  async syncUserGames(uid: string, options: SyncOptions = {}): Promise<SyncResult> {
    const games: UserGame[] = []
    const walk = this.walkUserGames(uid, options, true)
    let step = await walk.next()
    while (!step.done) {
      games.push(step.value)
      step = await walk.next()
    }
    const newest = options.resumeNewestGameId ?? games[0]?.gameId ?? options.after
    if (step.value !== 'maxPages') return { games, newestGameId: newest }
    // Older new games are still missing: moving the saved position past them would lose them.
    const rest: SyncOptions = { ...options, before: games.at(-1)?.gameId ?? options.before }
    if (newest !== undefined) rest.resumeNewestGameId = newest
    return { games, newestGameId: options.after, rest }
  }

  /** Returns why it stopped: `maxPages` means more games may follow. */
  private async *walkUserGames(
    uid: string,
    options: UserGamesOptions,
    fresh: boolean,
    signal?: AbortSignal,
  ): AsyncGenerator<UserGame, 'done' | 'maxPages'> {
    const { maxPages } = options
    if (maxPages !== undefined && !(Number.isInteger(maxPages) && maxPages >= 1)) {
      throw new RangeError('maxPages must be a whole number, 1 or more')
    }
    const since = options.since?.getTime()
    const after = options.after
    const seen = new Set<number>()
    let next = options.before
    for (let page = 0; ; page++) {
      if (maxPages !== undefined && page >= maxPages) return 'maxPages'
      if (signal?.aborted) return 'done'
      // Only the first page can change; a page below a cursor stays the same.
      const result = await this.loadUserGames(uid, next, fresh && page === 0)
      for (const game of result.games) {
        if (after !== undefined && game.gameId <= after) return 'done'
        if (since !== undefined && Date.parse(game.startDtm) < since) return 'done'
        yield game
      }
      if (result.next === undefined) return 'done'
      if (seen.has(result.next)) throw new ErApiError(502, `Paging cursor repeated: ${result.next}`)
      seen.add(result.next)
      next = result.next
    }
  }

  /**
   * Reports games as players finish them. Each round reads each player's
   * newest page, without the cache: one request per player when nothing is
   * new. Each player's games come oldest first; players are visited in the
   * order `uids` gives. An error for one player is reported and does not
   * stop the others.
   *
   * ```ts
   * for await (const event of er.watchGames({ uids: [uid], signal })) {
   *   if (event.type === 'game') console.log(event.uid, event.game.gameRank)
   * }
   * ```
   *
   * At the default 1 request per second, a round of 60 players takes a
   * minute. Set `intervalMs` or `requestsPerSecond` to match.
   */
  async *watchGames(options: WatchOptions): AsyncGenerator<WatchEvent> {
    const intervalMs = options.intervalMs ?? 60_000
    const signal = options.signal
    if (!(Number.isFinite(intervalMs) && intervalMs > 0)) throw new RangeError('intervalMs must be a positive number')
    const source = options.uids
    if (typeof source === 'string') throw new TypeError('uids must be a list of uids, not one string')
    // A one-time iterator returns itself; read it once instead of finding it empty next round.
    const fixed =
      typeof source !== 'function' && (source[Symbol.iterator]() as unknown) === source ? [...source] : source
    const startAt = options.after
    const startOf = (uid: string) => (startAt instanceof Map ? startAt.get(uid) : startAt?.[uid])
    const newest = new Map<string, number>()
    let uids = new Set<string>()

    while (!signal?.aborted) {
      const roundStart = this.now()
      try {
        const listed = typeof fixed === 'function' ? fixed() : fixed
        if (typeof listed === 'string') throw new TypeError('uids returned one string, not a list of uids')
        uids = new Set(listed)
      } catch (error) {
        // Keep the last list.
        yield { type: 'error', uid: null, error }
      }
      // Forget players no longer watched, so adding one back starts fresh.
      for (const uid of newest.keys()) if (!uids.has(uid)) newest.delete(uid)
      for (const uid of uids) {
        if (signal?.aborted) return
        const after = newest.get(uid) ?? startOf(uid)
        try {
          if (after === undefined) {
            // First look: remember where the player is, report nothing.
            const page = await this.loadUserGames(uid, undefined, true)
            newest.set(uid, page.games[0]?.gameId ?? 0)
            continue
          }
          newest.set(uid, after)
          // No page limit: stopping early would skip games for good.
          const games: UserGame[] = []
          for await (const game of this.walkUserGames(uid, { after }, true, signal)) games.push(game)
          // Stopped partway: report nothing, so no game is reported out of order.
          if (signal?.aborted) return
          if (games.length === 0) continue
          newest.set(uid, games[0]!.gameId)
          // Oldest first, the order they were played.
          for (const game of games.reverse()) {
            if (signal?.aborted) return
            yield { type: 'game', uid, game }
          }
        } catch (error) {
          if (signal?.aborted) return
          yield { type: 'error', uid, error }
        }
      }
      // Always wait, even after a slow round, so an empty list cannot spin.
      await pause(this.sleep, Math.max(roundStart + intervalMs - this.now(), 0), signal)
    }
  }

  /**
   * Every participant of one game. Empty if the game is gone. A game still
   * being played has only the players who are done; see `isGameFinished`.
   * Such a result is not cached.
   */
  async getGame(gameId: number | string): Promise<UserGame[]> {
    return this.orEmpty(async () => {
      const body = await this.load(`/v1/games/${encodeURIComponent(String(gameId))}`)
      return arrayField<UserGame>(body, 'userGames')
    }, [])
  }

  /** A player's ranked standing. Null if unranked. */
  async getUserRank(
    uid: string,
    seasonId: number,
    teamMode: number = TeamMode.SQUAD,
  ): Promise<UserRank | null> {
    return this.orEmpty(async () => {
      const body = await this.request(
        `/v1/rank/uid/${encodeURIComponent(uid)}/${seasonId}/${teamMode}`,
      )
      return (body.userRank as UserRank | undefined) ?? null
    }, null)
  }

  /** Top of the ladder. One response, no paging. */
  async getTopRanks(seasonId: number, teamMode: number = TeamMode.SQUAD): Promise<TopRankEntry[]> {
    return this.orEmpty(async () => {
      const body = await this.request(`/v1/rank/top/${seasonId}/${teamMode}`)
      return arrayField<TopRankEntry>(body, 'topRanks')
    }, [])
  }

  /** Season stats for normal (2) or ranked (3) games. */
  async getUserStats(
    uid: string,
    seasonId: number,
    matchingMode: number = MatchingMode.RANKED,
  ): Promise<UserStat[]> {
    return this.orEmpty(async () => {
      const body = await this.request(
        `/v2/user/stats/uid/${encodeURIComponent(uid)}/${seasonId}/${matchingMode}`,
      )
      return arrayField<UserStat>(body, 'userStats')
    }, [])
  }

  /** A game data table, e.g. `Character`, `ItemWeapon`, `Season`. */
  async getData<T = Record<string, unknown>>(metaType: string): Promise<T[]> {
    const body = await this.request(`/v2/data/${encodeURIComponent(metaType)}`)
    return arrayField<T>(body, 'data')
  }

  /** The `Season` table, cached for `seasonCacheTtlMs`. Each call gets its own copy. */
  async getSeasons(): Promise<SeasonCatalog> {
    if (this.seasonCache && this.seasonCache.expiresAt > this.now()) {
      return new SeasonCatalog(this.seasonCache.value.map((row) => ({ ...row })))
    }
    if (!this.seasonLoading) {
      // Its own expiry: the response cache would keep it longer.
      this.seasonLoading = this.load('/v2/data/Season', true)
        .then((body) => arrayField<SeasonRow>(body, 'data'))
        .then((rows) => {
          this.seasonCache = { value: rows, expiresAt: this.now() + this.seasonCacheTtlMs }
          return rows
        })
        .finally(() => {
          this.seasonLoading = null
        })
    }
    return new SeasonCatalog((await this.seasonLoading).map((row) => ({ ...row })))
  }

  /**
   * Full localization table for a language (`Korean`, `English`, `Japanese`,
   * ...). Downloaded once per client.
   */
  async getL10n(language: string): Promise<Map<string, string>> {
    let loading = this.l10nLoading.get(language)
    if (!loading) {
      loading = this.loadL10n(language).catch((e) => {
        this.l10nLoading.delete(language)
        throw e
      })
      this.l10nLoading.set(language, loading)
    }
    return loading
  }

  /** Character code → name in the given language. */
  async getCharacterNames(language: string): Promise<Map<number, string>> {
    return characterNames(await this.getL10n(language))
  }

  /**
   * Name lookups for characters, items, traits, weapons and tactical skills.
   * Downloads the l10n file and two data tables once per language.
   */
  async getNames(language: string): Promise<GameNames> {
    let loading = this.namesLoading.get(language)
    if (!loading) {
      loading = this.loadNames(language).catch((e) => {
        this.namesLoading.delete(language)
        throw e
      })
      this.namesLoading.set(language, loading)
    }
    return loading
  }
  /**
   * Character weapons and item slots, grades and materials, from the
   * `CharacterMastery`, `ItemWeapon` and `ItemArmor` tables. Loaded once per
   * client; make a new client after a game patch.
   */
  async getGameData(): Promise<GameData> {
    this.gameDataLoading ??= Promise.all([
      this.getData<CharacterMasteryRow>('CharacterMastery'),
      this.getData<ItemWeaponRow>('ItemWeapon'),
      this.getData<ItemArmorRow>('ItemArmor'),
    ])
      .then(([mastery, weapons, armors]) => buildGameData(mastery, weapons, armors))
      .catch((e) => {
        this.gameDataLoading = null
        throw e
      })
    return this.gameDataLoading
  }


  private async loadNames(language: string): Promise<GameNames> {
    const l10n = await this.getL10n(language)
    const groups = await this.getData<TacticalSkillGroupRow>('TacticalSkillSetGroup')
    const sets = await this.getData<TacticalSkillSetRow>('TacticalSkillSet')
    return buildGameNames(l10n, groups, sets)
  }

  private async loadL10n(language: string): Promise<Map<string, string>> {
    const body = await this.request(`/v1/l10n/${encodeURIComponent(language)}`)
    const url = (body.data as { l10Path?: unknown } | undefined)?.l10Path
    if (typeof url !== 'string' || !url) {
      throw new ErApiError(502, `No l10n file for ${language}`)
    }
    // The file is on a CDN, not the API host: no key, no rate limit.
    const { res, text } = await this.fetchText(url, {})
    if (!res.ok) throw new ErApiError(res.status, `l10n download failed (HTTP ${res.status})`)
    return parseL10n(text)
  }
}

function isEnvelope(value: unknown): value is Envelope {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** `sleep` that ends early when the signal aborts. */
function pause(sleep: Sleep, ms: number, signal?: AbortSignal): Promise<void> {
  if (!signal) return sleep(ms)
  if (signal.aborted) return Promise.resolve()
  return new Promise((resolve) => {
    const done = () => {
      signal.removeEventListener('abort', done)
      resolve()
    }
    signal.addEventListener('abort', done, { once: true })
    sleep(ms).then(done, done)
  })
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error('cache timeout')), ms)
  })
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer))
}
