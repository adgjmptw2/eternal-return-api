/**
 * @packageDocumentation
 * @document ../GUIDE.md
 */

export { ErClient, DEFAULT_BASE_URL } from './client.js'
export type { ErClientOptions, UserGamesOptions } from './client.js'
export { ErApiError, ErNicknameMismatchError } from './errors.js'
export { MatchingMode, TeamMode, gameModeName } from './modes.js'
export type { GameModeName } from './modes.js'
export { SeasonCatalog, parseSeasonNumber, toPlayerSeason } from './seasons.js'
export type { SeasonRow } from './seasons.js'
export { parseL10n, L10N_SEPARATOR } from './l10n.js'
export {
  WEAPON_TYPES,
  buildGameNames,
  characterNames,
  itemNames,
  namesByCode,
  stripTags,
  tacticalSkillNames,
  traitNames,
  weaponTypeName,
} from './names.js'
export type { GameNames, TacticalSkillGroupRow, TacticalSkillSetRow } from './names.js'
export { summarizeGames } from './summary.js'
export { buildGameData, itemGradeOf, ITEM_GRADES, EQUIPMENT_SLOTS } from './gamedata.js'
export type {
  CharacterMasteryRow,
  EquipSlot,
  GameData,
  ItemArmorRow,
  ItemGrade,
  ItemInfo,
  ItemWeaponRow,
} from './gamedata.js'
export { groupTeams } from './teams.js'
export { rankTier, LATEST_TIER_SEASON } from './tiers.js'
export type { RankTier, RankTierOptions, TierKey } from './tiers.js'
export type { GameTeam } from './teams.js'
export { MemoryCache, DEFAULT_CACHE_TTL_MS, cacheKindOf } from './cache.js'
export type { CacheKind, CacheStore } from './cache.js'
export type { CharacterSummary, GameSummary, GamesSummary } from './summary.js'
export { RateLimiter } from './limiter.js'
export type { Sleep } from './limiter.js'
export type {
  CharacterStat,
  Envelope,
  ErUser,
  TopRankEntry,
  UserGame,
  UserGamesPage,
  UserRank,
  UserStat,
} from './types.js'
