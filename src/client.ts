import { ErApiError, ErNicknameMismatchError } from './errors.js'
import { characterNames, parseL10n } from './l10n.js'
import { RateLimiter, defaultSleep, type Sleep } from './limiter.js'
import { MatchingMode, TeamMode } from './modes.js'
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
  baseUrl?: string
  fetch?: typeof fetch
  /** For tests. */
  sleep?: Sleep
  /** For tests. */
  now?: () => number
}

export interface UserGamesOptions {
  /** Stop once games are older than this. */
  since?: Date
  /** Stop after this many pages. */
  maxPages?: number
}

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

  private seasonCache: { value: SeasonRow[]; expiresAt: number } | null = null
  private seasonLoading: Promise<SeasonRow[]> | null = null
  private readonly l10nLoading = new Map<string, Promise<Map<string, string>>>()

  constructor(options: ErClientOptions) {
    if (!options.apiKey) throw new TypeError('apiKey is required')
    const rps = options.requestsPerSecond ?? 1
    const burst = Math.floor(options.burst ?? 1)
    if (!(rps > 0)) throw new RangeError('requestsPerSecond must be positive')
    if (!(burst >= 1)) throw new RangeError('burst must be at least 1')

    this.apiKey = options.apiKey
    this.baseUrl = (options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, '')
    this.timeoutMs = options.timeoutMs ?? 9_000
    this.retryDelaysMs = options.retryDelaysMs ?? [1_500, 3_000]
    this.seasonCacheTtlMs = options.seasonCacheTtlMs ?? 5 * 60_000
    this.fetchImpl = options.fetch ?? globalThis.fetch.bind(globalThis)
    this.sleep = options.sleep ?? defaultSleep
    this.now = options.now ?? Date.now
    this.limiter = new RateLimiter(Math.ceil(1_000 / rps), burst, this.now, this.sleep)
  }

  /**
   * Calls any Open API path and returns the body. Rate limit, 429 retries and
   * the `code` check apply. Use it for endpoints this client does not wrap.
   */
  async request(path: string): Promise<Envelope> {
    for (let attempt = 0; ; attempt++) {
      await this.limiter.acquire()
      try {
        return await this.requestOnce(path)
      } catch (e) {
        const delay = this.retryDelaysMs[attempt]
        if (!(e instanceof ErApiError) || e.status !== 429 || delay === undefined) throw e
        await this.sleep(delay)
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
    })
    let envelope: Envelope | null = null
    try {
      const body: unknown = JSON.parse(text)
      if (typeof body === 'object' && body !== null) envelope = body as Envelope
    } catch {
      // Non-JSON error page. Status below decides.
    }
    const apiCode = typeof envelope?.code === 'number' ? envelope.code : undefined
    const message = envelope?.message ?? `Request failed (HTTP ${res.status})`
    if (!res.ok) throw new ErApiError(res.status, message, apiCode)
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
   * this player's row; use `getGame` for everyone in it.
   */
  async getUserGames(uid: string, next?: number): Promise<UserGamesPage> {
    return this.orEmpty<UserGamesPage>(async () => {
      const suffix = next !== undefined ? `?next=${next}` : ''
      const body = await this.request(`/v1/user/games/uid/${encodeURIComponent(uid)}${suffix}`)
      return {
        games: arrayField<UserGame>(body, 'userGames'),
        next: typeof body.next === 'number' ? body.next : undefined,
      }
    }, { games: [] })
  }

  /** Walks `getUserGames` pages until the end, `since`, or `maxPages`. */
  async *iterateUserGames(uid: string, options: UserGamesOptions = {}): AsyncGenerator<UserGame> {
    const since = options.since?.getTime()
    const seen = new Set<number>()
    let next: number | undefined
    for (let page = 0; options.maxPages === undefined || page < options.maxPages; page++) {
      const result = await this.getUserGames(uid, next)
      for (const game of result.games) {
        if (since !== undefined && Date.parse(game.startDtm) < since) return
        yield game
      }
      if (result.next === undefined) return
      if (seen.has(result.next)) throw new ErApiError(502, `Paging cursor repeated: ${result.next}`)
      seen.add(result.next)
      next = result.next
    }
  }

  /** Every participant of one game. Empty if the game is gone. */
  async getGame(gameId: number | string): Promise<UserGame[]> {
    return this.orEmpty(async () => {
      const body = await this.request(`/v1/games/${encodeURIComponent(String(gameId))}`)
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
      this.seasonLoading = this.getData<SeasonRow>('Season')
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
