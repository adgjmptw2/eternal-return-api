/** `matchingMode` values seen in Open API responses. */
export const MatchingMode = {
  NORMAL: 2,
  RANKED: 3,
  /** Cobalt Protocol. */
  COBALT: 6,
  /** Cobalt Protocol in older records. New games use 6. */
  COBALT_LEGACY: 4,
  LONE_WOLF: 9,
} as const

/** `matchingTeamMode` values. */
export const TeamMode = {
  LONE_WOLF: 1,
  SQUAD: 3,
  COBALT: 4,
} as const

export type GameModeName = 'rank' | 'normal' | 'cobalt' | 'loneWolf' | 'unknown'

export function gameModeName(matchingMode: number): GameModeName {
  switch (matchingMode) {
    case MatchingMode.RANKED:
      return 'rank'
    case MatchingMode.NORMAL:
      return 'normal'
    case MatchingMode.COBALT:
    case MatchingMode.COBALT_LEGACY:
      return 'cobalt'
    case MatchingMode.LONE_WOLF:
      return 'loneWolf'
    default:
      return 'unknown'
  }
}
