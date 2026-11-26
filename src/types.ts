export interface ErUser {
  /**
   * For the player endpoints. Not a stable ID: each nickname lookup returns a
   * different value for the same player, and earlier values keep working for
   * some time. Do not use it as a key in your own data; see `UserGame.userCode`.
   */
  uid: string
  nickname: string
}

export interface UserRank {
  mmr: number
  nickname: string
  /** Leaderboard rank over all servers. */
  rank: number
  serverCode?: number
  /** Rank on the server's own leaderboard. 0 when not on it. */
  serverRank?: number
  /** Server that decides season rewards. */
  rewardServerCode?: number
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
  /** 0 in normal and Cobalt Protocol rows. */
  seasonId: number
  matchingMode: number
  matchingTeamMode: number
  /** Ranked rows only. */
  mmr?: number
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
 * Only commonly used fields are typed. The API sends about 340 fields, and the
 * rest are kept on the object as-is. Notes on each field were checked against
 * live responses: 650 games of 13.0 and 13.1 (11,754 rows) and 379 games of
 * 12.5 to 12.7 (6,741 rows), in November 2026. Fields without a note are not
 * documented here because their meaning was not confirmed.
 */
export interface UserGame {
  gameId: number
  /** Ranked season ID, e.g. 43 for season 13. 0 in every mode but ranked. */
  seasonId: number
  /** See `MatchingMode`: 2 normal, 3 ranked, 6 Cobalt Protocol, 13 Rumble Out. */
  matchingMode: number
  /** See `TeamMode`: 3 squad, 4 Cobalt Protocol. */
  matchingTeamMode: number
  /** First part of the game version, e.g. 13 in 13.1. Only in `getGame` rows. */
  versionSeason?: number
  /** Second part, e.g. 1 in 13.1. */
  versionMajor?: number
  versionMinor?: number
  /** The nickname at the time of the game. AI players have one too. */
  nickname?: string
  /**
   * From 13.2: an ID that stayed the same for a player across games, nickname
   * lookups and nickname changes, unlike the uid. The player endpoints do not take it
   * (HTTP 401). Games from before 13.2 do not have it.
   */
  userCode?: string
  /** True for an AI player. See `isBotPlayer`. Only in `getGame` rows. */
  isMLBot?: boolean
  /** Same as `isMLBot`. */
  mlbot?: boolean
  /** Players in the game who are not AI. */
  matchSize?: number
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
  /** Item grade, same keys as `equipment`: 1 Common to 6 Mythic. See `itemGradeOf`. */
  equipmentGrade?: number[] | Record<string, number>
  routeIdOfStart?: number
  /**
   * Team placement, 1 is the winner. Members share it, except a player who
   * gave up: they keep the rank from when they left. Cobalt Protocol uses 1 and
   * 2, Rumble Out 1 to 5.
   */
  gameRank: number
  /** `1` for the winning team, `0` otherwise. `0` in every row when an AI team won. */
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
  /**
   * Ranked only. `mmrGainInGame + mmrLossEntryCost`, plus 50 when the game
   * moved the player up a tier, or minus 50 when it moved them down one. 0 for
   * a player who left and paid the penalty, and for some of their teammates.
   * `rpChange` handles the exceptions.
   */
  mmrGain?: number
  /**
   * Ranked: the RP change that was applied, `mmrAfter - mmrBefore`. Differs
   * from `mmrGain` where the change was doubled (`gambit`, seen in 12.5 and
   * 12.6). Can be nonzero in other modes; ignore it there.
   */
  mmrGainGambit?: number
  /**
   * Ranked only. RP after the game, tier bonus included. 0 for a player who
   * left and paid the penalty; `rankPoint` has their RP.
   */
  mmrAfter?: number
  /**
   * Ranked: RP earned in the game, before the entry cost. Teammates often
   * differ by a few points. 0 in other modes.
   */
  mmrGainInGame?: number
  /**
   * Ranked: entry cost, 0 or negative, set by the player's division. Twice
   * that for a player who left. 0 in other modes.
   */
  mmrLossEntryCost?: number
  /** Ranked only. Average `mmrBefore` of every row in the game, AI players included, rounded down. */
  mmrAvg?: number
  /**
   * Ranked: RP after the game, without the 50 for moving a tier. Also set for
   * a player who left, whose `mmrAfter` is 0. 0 in other modes.
   */
  rankPoint?: number
  /** Not present in responses checked in November 2026. Use `mmrAfter`. */
  rpAfter?: number
  /** Size of the party the player queued with: 1 solo, 2 duo, 3 trio, 4 in Cobalt Protocol. 0 for AI players. */
  preMade?: number
  /** AI players added to the game, with or without rows. */
  botAdded?: number
  botRemain?: number
  /**
   * 1 if the player gave up. Their `gameRank`, `teamKill` and `duration` can be
   * from when they left. See `mmrAfter` for the penalty.
   */
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
  /** Seconds the player played. */
  playTime?: number
  watchTime?: number
  /** `playTime + watchTime`. */
  totalTime?: number
  /** Seconds from the start until the team finished. Shared like `gameRank`. */
  duration?: number
  /** Cobalt Protocol: chosen infusions. */
  finalInfusion?: number[]
  /**
   * 13.0 and 13.1, normal and ranked: the team's Research Task field. Missing
   * when the team cleared none. 13.2 ended Research Tasks: the field is gone
   * and the other Research Task fields are 0 or empty.
   */
  experimentResultType?: 'Material' | 'Energy' | 'Biotechnology'
  /** 13.0 and 13.1: cleared Research Tasks, in the order they were first cleared. Empty when there are none. */
  questStepClear?: QuestStepClear[]
  /** 13.0 and 13.1: credits from clearing Research Tasks. */
  crExperimentReward?: number
  /** 13.0 and 13.1: credits from the Research Task's buff. */
  crExperimentalCredit?: number
  [key: string]: unknown
}

/** A Research Task in `questStepClear` (13.0 and 13.1). */
export interface QuestStepClear {
  /**
   * The first digit is the field: 1 Material, 2 Energy, 3 Biotechnology. In
   * 13.0 `x0001` is the first task and `x0002` the repeated one; in 13.1
   * `x0011` is the first and `x0021` to `x0023` the repeated ones.
   */
  experimentGroupId: number
  /** Seconds from the start of the game. */
  firstClearElapsedSeconds: number
  clearCount: number
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
