import { MatchingMode } from './modes.js'
import type { UserGame } from './types.js'

export interface RpChange {
  before: number
  after: number
  /** `after - before`. */
  change: number
}

/**
 * RP before and after a ranked game. Null for other modes.
 *
 * `mmrAfter` is right except for a player who left and paid the penalty:
 * `mmrAfter` and `mmrGain` are 0, and `rankPoint` has the RP they were left
 * with. `mmrGain` alone also misses games whose RP change was doubled.
 */
export function rpChange(game: UserGame): RpChange | null {
  const before = game.mmrBefore
  if (game.matchingMode !== MatchingMode.RANKED || typeof before !== 'number') return null
  const left = game.giveUp === 1 && game.mmrAfter === 0
  const after = left ? game.rankPoint : game.mmrAfter
  return typeof after === 'number' ? { before, after, change: after - before } : null
}
