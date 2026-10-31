import type { UserGame } from './types.js'

export interface GameTeam {
  /** Null for a player without `teamNumber`; each such player is a team alone. */
  teamNumber: number | null
  /**
   * Team placement, from a member who did not give up and stayed longest
   * (if all gave up, the one who stayed longest). A player who gave up can
   * keep the rank and team kills from when they left.
   */
  gameRank: number
  victory: boolean
  /**
   * `teamKill` from the same row as `gameRank`. If missing, the highest
   * `teamKill` among members who did not give up, else the sum of member kills.
   */
  teamKills: number
  assists: number
  damageToPlayer: number
  /** Most kills first. */
  players: UserGame[]
}

// A player who gave up keeps their rank and team kills from when they left,
// so team values come from someone who stayed: not given up, longest duration.
function stayScore(p: UserGame): [number, number] {
  const duration = typeof p.duration === 'number' && Number.isFinite(p.duration) ? p.duration : -1
  return [p.giveUp === 1 ? 0 : 1, duration]
}

function lastToLeave(members: UserGame[]): UserGame {
  let best = members[0]!
  let bestScore = stayScore(best)
  for (const p of members) {
    const score = stayScore(p)
    if (score[0] > bestScore[0] || (score[0] === bestScore[0] && score[1] > bestScore[1])) {
      best = p
      bestScore = score
    }
  }
  return best
}

function maxTeamKill(members: UserGame[]): number | undefined {
  const values = members
    .filter((p) => p.giveUp !== 1)
    .map((p) => p.teamKill)
    .filter((n): n is number => typeof n === 'number')
  return values.length ? Math.max(...values) : undefined
}

/**
 * Groups the players of one game (`getGame`) into teams, best placement first.
 * Players without `teamNumber` each get a team of their own.
 */
export function groupTeams(players: Iterable<UserGame>): GameTeam[] {
  const byTeam = new Map<number, UserGame[]>()
  const groups: Array<[number | null, UserGame[]]> = []
  for (const player of players) {
    if (typeof player.teamNumber !== 'number') {
      groups.push([null, [player]])
      continue
    }
    const members = byTeam.get(player.teamNumber)
    if (members) members.push(player)
    else {
      const team: UserGame[] = [player]
      byTeam.set(player.teamNumber, team)
      groups.push([player.teamNumber, team])
    }
  }
  const teams: GameTeam[] = []
  for (const [teamNumber, members] of groups) {
    const last = lastToLeave(members)
    const kills = members.reduce((n, p) => n + (p.playerKill ?? 0), 0)
    teams.push({
      teamNumber,
      gameRank: last.gameRank,
      victory: members.some((p) => p.victory === 1),
      teamKills: typeof last.teamKill === 'number' ? last.teamKill : maxTeamKill(members) ?? kills,
      assists: members.reduce((n, p) => n + (p.playerAssistant ?? 0), 0),
      damageToPlayer: members.reduce((n, p) => n + (p.damageToPlayer ?? 0), 0),
      players: [...members].sort((a, b) => (b.playerKill ?? 0) - (a.playerKill ?? 0)),
    })
  }
  const order = (n: number | null) => (n === null ? Infinity : n)
  return teams.sort((a, b) => (a.gameRank || Infinity) - (b.gameRank || Infinity) || order(a.teamNumber) - order(b.teamNumber))
}
