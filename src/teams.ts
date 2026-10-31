import type { UserGame } from './types.js'

export interface GameTeam {
  /** Null for a player without `teamNumber`; each such player is a team alone. */
  teamNumber: number | null
  /** Team placement. Every member has the same `gameRank`. */
  gameRank: number
  victory: boolean
  /** `teamKill` from the API, or the sum of member kills when it is missing. */
  teamKills: number
  assists: number
  damageToPlayer: number
  /** Most kills first. */
  players: UserGame[]
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
    const first = members[0]!
    const kills = members.reduce((n, p) => n + (p.playerKill ?? 0), 0)
    teams.push({
      teamNumber,
      gameRank: first.gameRank,
      victory: members.some((p) => p.victory === 1),
      teamKills: typeof first.teamKill === 'number' ? first.teamKill : kills,
      assists: members.reduce((n, p) => n + (p.playerAssistant ?? 0), 0),
      damageToPlayer: members.reduce((n, p) => n + (p.damageToPlayer ?? 0), 0),
      players: [...members].sort((a, b) => (b.playerKill ?? 0) - (a.playerKill ?? 0)),
    })
  }
  const order = (n: number | null) => (n === null ? Infinity : n)
  return teams.sort((a, b) => (a.gameRank || Infinity) - (b.gameRank || Infinity) || order(a.teamNumber) - order(b.teamNumber))
}
