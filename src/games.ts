import type { UserGame } from './types.js'

/** Longer than any game: the longest of 1,029 checked games took 27 minutes. */
const GAME_SURELY_OVER_MS = 60 * 60_000

/** `startDtm` in ms. The API writes the offset as `+0900`, which not every engine parses. */
export function startTimeOf(game: Pick<UserGame, 'startDtm'>): number {
  return Date.parse(String(game.startDtm).replace(/([+-]\d{2})(\d{2})$/, '$1:$2'))
}

/**
 * Whether a `getGame` result is the finished game.
 *
 * A game fetched while other teams are still playing has only the players who
 * are done, and no winner yet. ERCraft stored such games as final and later
 * showed teammates as missing. Check this before storing a game for good.
 *
 * A game is finished once a row has `gameRank` 1 (Cobalt Protocol too), or an
 * hour after it started. The hour covers beginner games against AI players
 * that have no rows: when one of their teams wins, no row ever has rank 1.
 * The row count is not a test: finished games can have fewer than 24 rows.
 *
 * `now` is for tests. Default: the current time.
 */
export function isGameFinished(players: Iterable<UserGame>, now: number = Date.now()): boolean {
  let start = NaN
  for (const player of players) {
    if (player.gameRank === 1) return true
    if (Number.isNaN(start)) start = startTimeOf(player)
  }
  return now - start > GAME_SURELY_OVER_MS
}

/**
 * Whether a `getGame` row is an AI player. Normal games and lower ranked games
 * can include them, with a nickname, a rank and RP like anyone else.
 */
export function isBotPlayer(player: Pick<UserGame, 'isMLBot' | 'mlbot'>): boolean {
  return player.isMLBot === true || player.mlbot === true
}
