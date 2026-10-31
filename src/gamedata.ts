import type { UserGame } from './types.js'

/** `itemGrade` values in the item tables, lowest first. */
export type ItemGrade = 'Common' | 'Uncommon' | 'Rare' | 'Epic' | 'Legend' | 'Mythic'

export const ITEM_GRADES: readonly ItemGrade[] = Object.freeze([
  'Common',
  'Uncommon',
  'Rare',
  'Epic',
  'Legend',
  'Mythic',
])

/**
 * `equipmentGrade` number → grade name. In checked game records, 1, 4, 5 and
 * 6 always matched the item's table grade at this position.
 */
export function itemGradeOf(equipmentGrade: number | null | undefined): ItemGrade | null {
  return typeof equipmentGrade === 'number' ? ITEM_GRADES[equipmentGrade - 1] ?? null : null
}

export type EquipSlot = 'weapon' | 'chest' | 'head' | 'arm' | 'leg'

/** Keys of `equipment` in game records. */
export const EQUIPMENT_SLOTS: Readonly<Record<string, EquipSlot>> = Object.freeze({
  0: 'weapon',
  1: 'chest',
  2: 'head',
  3: 'arm',
  4: 'leg',
})

/** Row of `/v2/data/CharacterMastery`. `weapon1` to `weapon4` are weapon types or `"None"`. */
export interface CharacterMasteryRow {
  code: number
  weapon1: string
  weapon2: string
  weapon3: string
  weapon4: string
  [key: string]: unknown
}

/** Row of `/v2/data/ItemWeapon`. */
export interface ItemWeaponRow {
  code: number
  itemType: 'Weapon'
  weaponType: string
  itemGrade: ItemGrade
  isCompletedItem: boolean
  makeMaterial1: number
  makeMaterial2: number
  [key: string]: unknown
}

/** Row of `/v2/data/ItemArmor`. */
export interface ItemArmorRow {
  code: number
  itemType: 'Armor'
  armorType: 'Head' | 'Chest' | 'Arm' | 'Leg'
  itemGrade: ItemGrade
  isCompletedItem: boolean
  makeMaterial1: number
  makeMaterial2: number
  [key: string]: unknown
}

export interface ItemInfo {
  code: number
  slot: EquipSlot
  grade: ItemGrade
  /** For weapons, e.g. `"Glove"`. Null for armor. */
  weaponType: string | null
  completed: boolean
  /** `makeMaterial1` and `makeMaterial2`, or null if the item is not crafted. */
  materials: [number, number] | null
}

/** Joins of the character and item tables. */
export interface GameData {
  /** Weapon types a character can use, e.g. `["Glove", "Tonfa"]`. Empty for unknown codes. */
  weaponsOf(characterNum: number | null | undefined): string[]
  /** Weapons and armor only. Null for other codes. */
  item(code: number | null | undefined): ItemInfo | null
  /** A game row's equipment by slot. */
  equipment(game: Pick<UserGame, 'equipment'>): Partial<Record<EquipSlot, ItemInfo>>
}

const ARMOR_SLOT: Record<ItemArmorRow['armorType'], EquipSlot> = { Head: 'head', Chest: 'chest', Arm: 'arm', Leg: 'leg' }

export function buildGameData(
  mastery: CharacterMasteryRow[],
  weapons: ItemWeaponRow[],
  armors: ItemArmorRow[],
): GameData {
  const weaponsBy = new Map<number, string[]>()
  for (const row of mastery) {
    const list = [row.weapon1, row.weapon2, row.weapon3, row.weapon4].filter((w) => typeof w === 'string' && w && w !== 'None')
    weaponsBy.set(row.code, list)
  }
  const items = new Map<number, ItemInfo>()
  const add = (row: ItemWeaponRow | ItemArmorRow, slot: EquipSlot | undefined, weaponType: string | null) => {
    if (!slot) return
    const materials: [number, number] | null =
      row.makeMaterial1 || row.makeMaterial2 ? [row.makeMaterial1, row.makeMaterial2] : null
    items.set(row.code, { code: row.code, slot, grade: row.itemGrade, weaponType, completed: row.isCompletedItem === true, materials })
  }
  for (const row of weapons) add(row, 'weapon', row.weaponType)
  for (const row of armors) add(row, ARMOR_SLOT[row.armorType], null)

  const item = (code: number | null | undefined) => (code == null ? null : items.get(code) ?? null)
  return {
    weaponsOf: (code) => (code == null ? [] : [...(weaponsBy.get(code) ?? [])]),
    item,
    equipment: (game) => {
      const out: Partial<Record<EquipSlot, ItemInfo>> = {}
      const raw = game.equipment
      if (!raw) return out
      for (const [key, code] of Object.entries(raw)) {
        const slot = EQUIPMENT_SLOTS[key]
        const info = item(code)
        if (slot && info) out[slot] = info
      }
      return out
    },
  }
}
