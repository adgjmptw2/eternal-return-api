import type { TierKey } from './tiers.js'

/**
 * `bestWeapon` number → weapon type key used by the official localization
 * (`WeaponType/{key}`). Numbers 12 and 17 are not used by current games.
 */
export const WEAPON_TYPES: Readonly<Record<number, string>> = Object.freeze({
  1: 'Glove',
  2: 'Tonfa',
  3: 'Bat',
  4: 'Whip',
  5: 'HighAngleFire',
  6: 'DirectFire',
  7: 'Bow',
  8: 'CrossBow',
  9: 'Pistol',
  10: 'AssaultRifle',
  11: 'SniperRifle',
  13: 'Hammer',
  14: 'Axe',
  15: 'OneHandSword',
  16: 'TwoHandSword',
  18: 'DualSword',
  19: 'Spear',
  20: 'Nunchaku',
  21: 'Rapier',
  22: 'Guitar',
  23: 'Camera',
  24: 'Arcana',
  25: 'VFArm',
})

/** Row of `/v2/data/TacticalSkillSetGroup`. */
export interface TacticalSkillGroupRow {
  group: number
  startCode: number
  icon?: string
  [key: string]: unknown
}

/** Row of `/v2/data/TacticalSkillSet`. */
export interface TacticalSkillSetRow {
  code: number
  /** A number, or several joined with ", " for some skills. */
  skillCode: number | string
  [key: string]: unknown
}

/** Removes rich-text tags such as `<color=yellow>` from a localized string. */
export function stripTags(text: string): string {
  return text.replace(/<[^<>]*>/g, '').trim()
}

/** Picks `{prefix}{code}` entries with an integer code: code → name. */
export function namesByCode(l10n: Map<string, string>, prefix: string): Map<number, string> {
  const names = new Map<number, string>()
  for (const [key, value] of l10n) {
    if (!key.startsWith(prefix)) continue
    const code = Number(key.slice(prefix.length))
    const name = stripTags(value)
    if (Number.isInteger(code) && code > 0 && name) names.set(code, name)
  }
  return names
}

/** `Character/Name/{code}`: character code → name. */
export function characterNames(l10n: Map<string, string>): Map<number, string> {
  return namesByCode(l10n, 'Character/Name/')
}

/** `Item/Name/{code}`: item code → name. */
export function itemNames(l10n: Map<string, string>): Map<number, string> {
  return namesByCode(l10n, 'Item/Name/')
}

/** `Trait/Name/{code}`: trait (augment) code → name. */
export function traitNames(l10n: Map<string, string>): Map<number, string> {
  return namesByCode(l10n, 'Trait/Name/')
}

/** `bestWeapon` number → weapon type name, or null when unknown. */
export function weaponTypeName(l10n: Map<string, string>, bestWeapon: number): string | null {
  const key = WEAPON_TYPES[bestWeapon]
  const name = key ? l10n.get(`WeaponType/${key}`) : undefined
  return name ? stripTags(name) || null : null
}

function skillGroupOf(code: number): number {
  return code - (code % 1000)
}

/**
 * `tacticalSkillGroup` → name.
 *
 * Follows group → start code → skill code and reads `Skill/Group/Name/{skill
 * group}`. When that key is missing, falls back to the group icon's number.
 */
export function tacticalSkillNames(
  l10n: Map<string, string>,
  groups: TacticalSkillGroupRow[],
  sets: TacticalSkillSetRow[],
): Map<number, string> {
  const skillCodeBySet = new Map<number, number>()
  for (const set of sets) {
    const first = Number(String(set.skillCode).split(',')[0])
    if (Number.isInteger(first) && first > 0) skillCodeBySet.set(set.code, first)
  }
  const names = new Map<number, string>()
  for (const row of groups) {
    const candidates: number[] = []
    const skillCode = skillCodeBySet.get(row.startCode)
    if (skillCode) candidates.push(skillGroupOf(skillCode))
    const icon = Number(String(row.icon ?? '').split('_').pop())
    if (Number.isInteger(icon) && icon > 0) candidates.push(icon)
    for (const code of candidates) {
      const name = l10n.get(`Skill/Group/Name/${code}`)
      if (name && stripTags(name)) {
        names.set(row.group, stripTags(name))
        break
      }
    }
  }
  return names
}

type Code = number | null | undefined

/** Name lookups for one language. Every method returns null for unknown or missing codes. */
export interface GameNames {
  character(code: number | null | undefined): string | null
  item(code: number | null | undefined): string | null
  trait(code: number | null | undefined): string | null
  weapon(bestWeapon: number | null | undefined): string | null
  /** By weapon type key, e.g. `"Glove"` from `GameData.weaponsOf`. */
  weaponType(key: string | null | undefined): string | null
  tacticalSkill(group: number | null | undefined): string | null
  /** Tier name, e.g. `tier(rankTier(rp).tier)`. Add the division yourself. */
  tier(key: TierKey): string | null
}

export function buildGameNames(
  l10n: Map<string, string>,
  groups: TacticalSkillGroupRow[],
  sets: TacticalSkillSetRow[],
): GameNames {
  const characters = characterNames(l10n)
  const items = itemNames(l10n)
  const traits = traitNames(l10n)
  const tactical = tacticalSkillNames(l10n, groups, sets)
  const lookup = (names: Map<number, string>) => (code: Code) => (code == null ? null : names.get(code) ?? null)
  return {
    character: lookup(characters),
    item: lookup(items),
    trait: lookup(traits),
    weapon: (bestWeapon) => (bestWeapon == null ? null : weaponTypeName(l10n, bestWeapon)),
    weaponType: (key) => {
      const name = key ? l10n.get(`WeaponType/${key}`) : undefined
      return name ? stripTags(name) || null : null
    },
    tacticalSkill: lookup(tactical),
    tier: (key) => {
      const name = l10n.get(key === 'unranked' ? 'UNRANK' : key.toUpperCase())
      return name ? stripTags(name) || null : null
    },
  }
}
