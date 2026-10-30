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
 * One player's result in one game (`BattleUserResult`).
 *
 * Only commonly used fields are typed. The API sends many more, and they are
 * kept on the object as-is.
 */
export interface UserGame {
  gameId: number
  seasonId: number
  matchingMode: number
  matchingTeamMode: number
  versionSeason?: number
  versionMajor?: number
  versionMinor?: number
  nickname?: string
  teamNumber?: number
  characterNum: number
  characterLevel: number
  skinCode?: number
  bestWeapon?: number
  tacticalSkillGroup?: number
  traitFirstCore?: number
  traitFirstSub?: number[]
  traitSecondSub?: number[]
  equipment?: number[] | Record<string, number>
  equipmentGrade?: number[] | Record<string, number>
  routeIdOfStart?: number
  gameRank: number
  victory: number
  playerKill: number
  playerAssistant: number
  playerDeaths?: number
  teamKill?: number
  monsterKill: number
  damageToPlayer?: number
  damageToMonster?: number
  damageFromPlayer?: number
  totalGainVFCredit?: number
  mmrAfter?: number
  mmrGain?: number
  rpAfter?: number
  preMade?: number
  botAdded?: number
  botRemain?: number
  startDtm: string
  playTime?: number
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
