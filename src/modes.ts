/** `matchingMode` values seen in Open API responses. */
export const MatchingMode = {
  NORMAL: 2,
  RANKED: 3,
  /** Cobalt Protocol. */
  COBALT: 6,
  /** Cobalt Protocol in older records. New games use 6. */
  COBALT_LEGACY: 4,
  LONE_WOLF: 9,
  /** Rumble Out, an event mode with 5 teams of 3. Ran November 12 to 18, 2026. */
  RUMBLE_OUT: 13,
} as const

/** `matchingTeamMode` values. Rumble Out uses 3, like the squad modes. */
export const TeamMode = {
  LONE_WOLF: 1,
  SQUAD: 3,
  COBALT: 4,
} as const

export type GameModeName = 'rank' | 'normal' | 'cobalt' | 'loneWolf' | 'rumbleOut' | 'unknown'

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
    case MatchingMode.RUMBLE_OUT:
      return 'rumbleOut'
    default:
      return 'unknown'
  }
}
