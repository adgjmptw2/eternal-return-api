import type { UserGame } from './types.js'

/**
 * Whether a `getGame` result is the finished game.
 *
 * A game fetched while other teams are still playing has only the players who
 * are done, and no winner yet. ERCraft stored such games as final and later
 * showed teammates as missing. Check this before storing a game for good.
 *
 * A finished game has a row with `gameRank` 1 (Cobalt Protocol too). The row
 * count is not a test: finished games can have fewer than 24 rows.
 */
export function isGameFinished(players: Iterable<UserGame>): boolean {
  for (const player of players) if (player.gameRank === 1) return true
  return false
}
