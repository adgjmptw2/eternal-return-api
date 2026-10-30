import type { UserGame } from './types.js'

export interface GameSummary {
  games: number
  /** Games with `victory === 1`. */
  wins: number
  /** Games with `gameRank` 1 to 3. */
  top3: number
  /** 0 to 1. */
  winRate: number
  /** 0 to 1. */
  top3Rate: number
  averageRank: number
  averageKills: number
  averageAssists: number
  /** Average `damageToPlayer`, or null when no game has it. */
  averageDamage: number | null
}

export interface CharacterSummary extends GameSummary {
  characterNum: number
}

export interface GamesSummary {
  overall: GameSummary
  /** Most played first. */
  characters: CharacterSummary[]
}

class Totals {
  games = 0
  wins = 0
  top3 = 0
  rankSum = 0
  rankCount = 0
  kills = 0
  assists = 0
  damage = 0
  damageCount = 0

  add(game: UserGame): void {
    this.games++
    if (game.victory === 1) this.wins++
    if (game.gameRank > 0) {
      this.rankSum += game.gameRank
      this.rankCount++
      if (game.gameRank <= 3) this.top3++
    }
    this.kills += game.playerKill ?? 0
    this.assists += game.playerAssistant ?? 0
    if (typeof game.damageToPlayer === 'number') {
      this.damage += game.damageToPlayer
      this.damageCount++
    }
  }

  result(): GameSummary {
    const per = (n: number, d: number) => (d > 0 ? n / d : 0)
    return {
      games: this.games,
      wins: this.wins,
      top3: this.top3,
      winRate: per(this.wins, this.games),
      top3Rate: per(this.top3, this.games),
      averageRank: per(this.rankSum, this.rankCount),
      averageKills: per(this.kills, this.games),
      averageAssists: per(this.assists, this.games),
      averageDamage: this.damageCount > 0 ? this.damage / this.damageCount : null,
    }
  }
}

/**
 * Totals and per-character stats for a list of games.
 *
 * Mixing modes skews the numbers (Cobalt Protocol ranks teams differently), so
 * filter by `matchingMode` first when that matters.
 */
export function summarizeGames(games: Iterable<UserGame>): GamesSummary {
  const overall = new Totals()
  const byCharacter = new Map<number, Totals>()
  for (const game of games) {
    overall.add(game)
    let totals = byCharacter.get(game.characterNum)
    if (!totals) {
      totals = new Totals()
      byCharacter.set(game.characterNum, totals)
    }
    totals.add(game)
  }
  const characters = [...byCharacter]
    .map(([characterNum, totals]) => ({ characterNum, ...totals.result() }))
    .sort((a, b) => b.games - a.games || a.characterNum - b.characterNum)
  return { overall: overall.result(), characters }
}
