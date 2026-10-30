/** One row of the `Season` data table (`/v2/data/Season`). */
export interface SeasonRow {
  seasonID: number
  seasonName: string
  isCurrent: number
  [key: string]: unknown
}

/** `Season20` → 20, `Pre-Season11` → 11. Other names → null. */
export function parseSeasonNumber(seasonName: string): number | null {
  const match = /^(?:Pre-)?Season(\d+)$/.exec(seasonName.trim())
  if (!match) return null
  const n = Number(match[1])
  return Number.isFinite(n) && n > 0 ? n : null
}

/**
 * Table numbering → the season number players see in game.
 * From `Season10` on, the table runs 9 ahead: `Season20` is S11.
 */
export function toPlayerSeason(tableSeasonNumber: number): number {
  return tableSeasonNumber >= 10 ? tableSeasonNumber - 9 : tableSeasonNumber
}

function isRanked(row: SeasonRow): boolean {
  return /^Season\d+$/.test(row.seasonName.trim())
}

/**
 * Maps between API season ids and the season numbers players use.
 *
 * `isCurrent` can point at a `Pre-Season` row between seasons. Pre-seasons have
 * no ranked ladder, so `currentRankedSeasonId` falls back to the latest ranked
 * season before it.
 */
export class SeasonCatalog {
  readonly rows: readonly Readonly<SeasonRow>[]
  private readonly idToPlayer = new Map<number, number>()
  private readonly playerToId = new Map<number, number>()

  constructor(rows: SeasonRow[]) {
    this.rows = rows
    for (const row of rows) {
      const n = parseSeasonNumber(row.seasonName)
      if (n === null) continue
      const player = toPlayerSeason(n)
      this.idToPlayer.set(row.seasonID, player)
      if (!isRanked(row)) continue
      const known = this.playerToId.get(player)
      if (known === undefined || row.seasonID > known) this.playerToId.set(player, row.seasonID)
    }
  }

  /** The row the API marks as current. May be a pre-season. */
  get current(): Readonly<SeasonRow> | null {
    return this.rows.find((row) => row.isCurrent === 1) ?? null
  }

  /** Season id to use for rank and stats calls right now. */
  get currentRankedSeasonId(): number | null {
    const current = this.current
    if (!current) return null
    if (isRanked(current)) return current.seasonID
    const pre = /^Pre-Season(\d+)$/.exec(current.seasonName.trim())
    if (!pre) return null
    const preNumber = Number(pre[1])
    const previous = this.rows
      .filter((row) => {
        const n = parseSeasonNumber(row.seasonName)
        return isRanked(row) && row.seasonID < current.seasonID && n !== null && n < preNumber
      })
      .sort((a, b) => b.seasonID - a.seasonID)[0]
    return previous?.seasonID ?? null
  }

  /** Player season number for any season id, pre-seasons included. */
  playerSeasonOf(seasonId: number): number | null {
    return this.idToPlayer.get(seasonId) ?? null
  }

  /** Ranked season id for a player season number. Pre-season-only numbers give null. */
  seasonIdOf(playerSeason: number): number | null {
    return this.playerToId.get(playerSeason) ?? null
  }
}
