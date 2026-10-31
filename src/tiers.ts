/**
 * Ranked tiers from RP, per season. Tables come from ERCraft, which checks them
 * against patch notes and reward announcements.
 */

export type TierKey =
  | 'unranked'
  | 'iron'
  | 'bronze'
  | 'silver'
  | 'gold'
  | 'platinum'
  | 'diamond'
  | 'meteorite'
  | 'mithril'
  | 'demigod'
  | 'eternity'

export interface RankTier {
  tier: TierKey
  /** 4 (lowest) to 1, or null for tiers without divisions. */
  division: number | null
  /** Official English name, e.g. "Diamond 2", "Mythril", "Titan". Use `GameNames.tier` for other languages. */
  name: string
  minRp: number
  /** Null for open-ended tiers. */
  maxRp: number | null
}

/** Last season with a checked table. Later seasons use it until the package is updated. */
export const LATEST_TIER_SEASON = 12

type Division = [minRp: number, tier: TierKey, division: number | null]

interface Ladder {
  /** Ascending by minRp. Each row ends where the next starts. */
  divisions: Division[]
  mithrilMinRp: number
  /** `mithrilRank`: rank alone decides. `rp`: also needs at least `minRp`. */
  leaderboard:
    | { mode: 'mithrilRank'; eternityMaxRank: number; demigodMaxRank: number }
    | { mode: 'rp'; minRp: number; eternityMaxRank: number; demigodMinRank: number; demigodMaxRank: number }
}

function steps(tier: TierKey, starts: number[]): Division[] {
  return starts.map((minRp, i) => [minRp, tier, starts.length === 1 ? null : 4 - i])
}

const BASE_S5: Division[] = [
  ...steps('iron', [0, 150, 300, 450]),
  ...steps('bronze', [600, 800, 1000, 1200]),
  ...steps('silver', [1400, 1650, 1900, 2150]),
  ...steps('gold', [2400, 2700, 3000, 3300]),
  ...steps('platinum', [3600, 3950, 4300, 4650]),
  ...steps('diamond', [5000, 5350, 5700, 6050]),
]

const S3_LOW: Division[] = [
  ...steps('bronze', [800, 1000, 1200, 1400]),
  ...steps('silver', [1600, 1850, 2100, 2350]),
]

const LADDERS: Record<number, Ladder> = {
  1: {
    divisions: [
      ...steps('bronze', [1000, 1250, 1500, 1750]),
      ...steps('silver', [2000, 2250, 2500, 2750]),
      ...steps('gold', [3000, 3250, 3500, 3750]),
      ...steps('platinum', [4000, 4250, 4500, 4750]),
      ...steps('diamond', [5000, 5250, 5500, 5750]),
    ],
    mithrilMinRp: 6000,
    leaderboard: { mode: 'rp', minRp: 6200, eternityMaxRank: 200, demigodMinRank: 201, demigodMaxRank: 700 },
  },
  3: {
    divisions: [
      ...S3_LOW,
      ...steps('gold', [2600, 2850, 3100, 3350]),
      ...steps('platinum', [3600, 3900, 4200, 4500]),
      ...steps('diamond', [4800, 5150, 5500, 5850]),
    ],
    mithrilMinRp: 6200,
    leaderboard: { mode: 'rp', minRp: 6400, eternityMaxRank: 200, demigodMinRank: 201, demigodMaxRank: 700 },
  },
  4: {
    divisions: [
      ...S3_LOW,
      ...steps('gold', [2600, 2900, 3200, 3500]),
      ...steps('platinum', [3800, 4150, 4500, 4850]),
      ...steps('diamond', [5200, 5600, 6000, 6400]),
    ],
    mithrilMinRp: 6800,
    leaderboard: { mode: 'rp', minRp: 7000, eternityMaxRank: 200, demigodMinRank: 201, demigodMaxRank: 700 },
  },
  5: {
    divisions: [...BASE_S5, ...steps('meteorite', [6400])],
    mithrilMinRp: 6800,
    leaderboard: { mode: 'rp', minRp: 7500, eternityMaxRank: 200, demigodMinRank: 201, demigodMaxRank: 700 },
  },
  6: {
    divisions: [...BASE_S5, ...steps('meteorite', [6400])],
    mithrilMinRp: 7000,
    leaderboard: { mode: 'rp', minRp: 7700, eternityMaxRank: 300, demigodMinRank: 301, demigodMaxRank: 1000 },
  },
  7: {
    divisions: [...BASE_S5, ...steps('meteorite', [6400])],
    mithrilMinRp: 7100,
    leaderboard: { mode: 'rp', minRp: 7800, eternityMaxRank: 300, demigodMinRank: 301, demigodMaxRank: 1000 },
  },
  9: {
    divisions: [...BASE_S5, ...steps('meteorite', [6400])],
    mithrilMinRp: 7200,
    leaderboard: { mode: 'rp', minRp: 7900, eternityMaxRank: 300, demigodMinRank: 301, demigodMaxRank: 1000 },
  },
  10: {
    divisions: [...BASE_S5, ...steps('meteorite', [6400, 6650, 6900, 7150])],
    mithrilMinRp: 7400,
    leaderboard: { mode: 'mithrilRank', eternityMaxRank: 300, demigodMaxRank: 1000 },
  },
  11: {
    divisions: [...BASE_S5, ...steps('meteorite', [6400, 6700, 7000, 7300])],
    mithrilMinRp: 7600,
    leaderboard: { mode: 'mithrilRank', eternityMaxRank: 300, demigodMaxRank: 1000 },
  },
  12: {
    divisions: [...BASE_S5, ...steps('meteorite', [6400, 6700, 7000, 7300])],
    mithrilMinRp: 7600,
    leaderboard: { mode: 'rp', minRp: 8300, eternityMaxRank: 300, demigodMinRank: 301, demigodMaxRank: 1000 },
  },
}

function ladderOf(input: number | null | undefined): Ladder {
  const season = typeof input === 'number' && Number.isFinite(input) ? Math.floor(input) : LATEST_TIER_SEASON
  if (season <= 2) return LADDERS[1]!
  if (season === 8) return LADDERS[7]!
  return LADDERS[Math.min(season, LATEST_TIER_SEASON)]!
}

const ENGLISH: Record<TierKey, string> = {
  unranked: 'Unranked',
  iron: 'Iron',
  bronze: 'Bronze',
  silver: 'Silver',
  gold: 'Gold',
  platinum: 'Platinum',
  diamond: 'Diamond',
  meteorite: 'Meteorite',
  mithril: 'Mythril',
  demigod: 'Titan',
  eternity: 'Immortal',
}

function tier(key: TierKey, division: number | null, minRp: number, maxRp: number | null): RankTier {
  return { tier: key, division, name: division === null ? ENGLISH[key] : `${ENGLISH[key]} ${division}`, minRp, maxRp }
}

function leaderboardTier(rp: number, rank: number, ladder: Ladder): TierKey | null {
  const rule = ladder.leaderboard
  if (rule.mode === 'mithrilRank') {
    if (rank <= rule.eternityMaxRank) return 'eternity'
    if (rank <= rule.demigodMaxRank) return 'demigod'
    return null
  }
  if (rp < rule.minRp) return null
  if (rank <= rule.eternityMaxRank) return 'eternity'
  if (rank >= rule.demigodMinRank && rank <= rule.demigodMaxRank) return 'demigod'
  return null
}

export interface RankTierOptions {
  /**
   * Leaderboard rank (`rank` from `getUserRank`). `demigod` and `eternity` need it;
   * without it, the top tier is `mithril`.
   */
  rank?: number | null
  /** In-game season number (see `toPlayerSeason`). Default `LATEST_TIER_SEASON`. */
  season?: number | null
}

/** RP → tier. 0 RP or less is Unranked. Fractions are rounded down. */
export function rankTier(input: number, options: RankTierOptions = {}): RankTier {
  if (!Number.isFinite(input) || input < 1) return tier('unranked', null, 0, null)
  const rp = Math.floor(input)
  const ladder = ladderOf(options.season)
  if (rp >= ladder.mithrilMinRp) {
    const rank = options.rank
    const top = rank != null && rank > 0 ? leaderboardTier(rp, rank, ladder) : null
    if (!top) return tier('mithril', null, ladder.mithrilMinRp, null)
    const rule = ladder.leaderboard
    return tier(top, null, rule.mode === 'rp' ? rule.minRp : ladder.mithrilMinRp, null)
  }
  const rows = ladder.divisions
  for (let i = rows.length - 1; i >= 0; i--) {
    const [minRp, key, division] = rows[i]!
    if (rp >= minRp) return tier(key, division, minRp, (rows[i + 1]?.[0] ?? ladder.mithrilMinRp) - 1)
  }
  // Below the lowest row (seasons 1 to 4 had no Iron).
  return tier('unranked', null, 0, null)
}
