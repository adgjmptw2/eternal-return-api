export interface ErUser {
  uid: string
  nickname: string
}

export interface UserRank {
  mmr: number
  nickname: string
  rank: number
  serverCode?: number
  serverRank?: number
  [key: string]: unknown
}

export interface TopRankEntry {
  nickname: string
  rank: number
  mmr: number
  userEmblems?: unknown
  [key: string]: unknown
}

export interface CharacterStat {
  characterCode: number
  totalGames: number
  maxKillings: number
  top3: number
  wins: number
  averageRank: number
  [key: string]: unknown
}

export interface UserStat {
  seasonId: number
  matchingMode: number
  matchingTeamMode: number
  mmr: number
  nickname?: string
  rank: number
  rankSize: number
  totalGames: number
  totalWins: number
  totalTeamKills: number
  totalDeaths: number
  averageRank: number
  averageKills: number
  averageAssistants: number
  top1: number
  top3: number
  characterStats?: CharacterStat[]
  [key: string]: unknown
}

/**
 * One player's result in one game (`BattleUserResult`), from `getUserGames`
 * or `getGame`.
 *
 * Only commonly used fields are typed. The API sends about 320 fields, and the
 * rest are kept on the object as-is. Notes on each field were checked against
 * live responses (30 games, 594 rows, October 2026) and ERCraft's records.
 * Fields without a note are not documented here because their meaning was not
 * confirmed.
 */
export interface UserGame {
  gameId: number
  /** Ranked season ID, e.g. 41 for season 12. 0 in normal and Cobalt Protocol games. */
  seasonId: number
  /** See `MatchingMode`: 2 normal, 3 ranked, 6 Cobalt Protocol. */
  matchingMode: number
  /** See `TeamMode`: 3 squad, 4 Cobalt Protocol. */
  matchingTeamMode: number
  /** Game version, with `versionMajor` and `versionMinor`. Only in `getGame` rows. */
  versionSeason?: number
  versionMajor?: number
  versionMinor?: number
  nickname?: string
  /** Team within the game. Members share it. */
  teamNumber?: number
  /** Character code. `GameNames.character` gives the name. */
  characterNum: number
  /** Highest seen: 20. */
  characterLevel: number
  skinCode?: number
  /** Weapon type number, not an item code. `GameNames.weapon` gives the name. */
  bestWeapon?: number
  /** Highest seen: 20. */
  bestWeaponLevel?: number
  /** `GameNames.tacticalSkill` gives the name. */
  tacticalSkillGroup?: number
  tacticalSkillLevel?: number
  /** Trait codes. `GameNames.trait` gives the names. */
  traitFirstCore?: number
  traitFirstSub?: number[]
  traitSecondSub?: number[]
  /**
   * Item codes by slot: `"0"` weapon, `"1"` chest, `"2"` head, `"3"` arm,
   * `"4"` leg. Returned as an object; some slots may be missing.
   */
  equipment?: number[] | Record<string, number>
  /** Item grade, same keys as `equipment`. Seen: 1 Common, 4 Epic, 5 Legendary, 6 Mythic. */
  equipmentGrade?: number[] | Record<string, number>
  routeIdOfStart?: number
  /**
   * Team placement, 1 is the winner. Members share it, except a player who
   * gave up: they keep the rank from when they left. Cobalt Protocol uses 1 and 2.
   */
  gameRank: number
  /** `1` for the winning team, `0` otherwise. Matches `gameRank === 1`. */
  victory: number
  playerKill: number
  playerAssistant: number
  playerDeaths?: number
  /**
   * Team kills, shared like `gameRank`. Usually
   * `teamElimination + teamDownCanEliminate + teamDownCanNotEliminate`,
   * sometimes 1 to 3 higher.
   */
  teamKill?: number
  teamElimination?: number
  teamDownCanEliminate?: number
  teamDownCanNotEliminate?: number
  monsterKill: number
  damageToPlayer?: number
  damageToMonster?: number
  damageFromPlayer?: number
  totalGainVFCredit?: number
  /** Ranked only. RP before the game. */
  mmrBefore?: number
  /** Ranked only. RP change: `mmrGainInGame + mmrLossEntryCost`. */
  mmrGain?: number
  /** Ranked only. `mmrBefore + mmrGain`. */
  mmrAfter?: number
  /** Ranked: RP earned in the game, before the entry cost. Members of a team share it. 0 in other modes. */
  mmrGainInGame?: number
  /** Ranked: entry cost, 0 or negative. 0 in other modes. */
  mmrLossEntryCost?: number
  /** Ranked only. Average `mmrBefore` of everyone in the game, rounded down. */
  mmrAvg?: number
  /** Same as `mmrAfter` in ranked games, 0 in others. */
  rankPoint?: number
  /** Not present in responses checked in October 2026. Use `mmrAfter`. */
  rpAfter?: number
  /** Size of the party the player queued with: 1 solo, 2 duo, 3 trio. */
  preMade?: number
  botAdded?: number
  botRemain?: number
  /** 1 if the player gave up. Their `gameRank`, `teamKill` and `duration` can be from when they left. */
  giveUp?: number
  /**
   * Start time in Korea time, e.g. `2026-10-30T15:30:59.059+0900`. The
   * milliseconds repeat the seconds, so do not read them as milliseconds.
   */
  startDtm: string
  /**
   * `startDtm` plus `duration` plus 90 days, within a few seconds. Games are
   * kept about 90 days.
   */
  expireDtm?: string
  /** Seconds the player played, at most `duration`. */
  playTime?: number
  watchTime?: number
  /** `playTime + watchTime`. */
  totalTime?: number
  /** Seconds from the start until the team finished. Shared like `gameRank`. */
  duration?: number
  /** Cobalt Protocol: chosen infusions. */
  finalInfusion?: number[]
  [key: string]: unknown
}

export interface UserGamesPage {
  games: UserGame[]
  /** Pass to the next call to get older games. Absent on the last page. */
  next?: number
}

/** Raw response body. Every Open API response has `code` and `message`. */
export interface Envelope {
  code: number
  message: string
  [key: string]: unknown
}
