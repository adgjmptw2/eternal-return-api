# Eternal Return Open API: game data tables

What each table under `/v2/data/{name}` holds, how the tables connect, and how they connect to game records. Checked on November 26, 2026 (13.1, before 13.2) against the full tables.

[한국어](https://github.com/adgjmptw2/eternal-return-api/blob/main/DATA.ko.md) · [Field guide](GUIDE.md)

- `/v2/data/hash` lists every table name with a number per table: 44 tables on that date.
- Rows are in `data`. Field names are as the API sends them.
- Table descriptions are based on field names, the official localization file and the links below. Link counts were checked on every row; where a link does not hold for all rows, the count says how many.
- Names live in the localization file (`/v1/l10n/{language}`), not in the tables. The keys are listed per table.

## From a game record to the tables

| Game record field | Table | Checked |
|---|---|---|
| `characterNum` | `Character.code` | 11,754 of 11,754 |
| `skinCode` | `CharacterSkin.code`; its `characterCode` equals `characterNum` | 11,754 of 11,754 |
| `equipment` values | `ItemWeapon.code`, `ItemArmor.code` | 58,728 of 58,728 codes |
| `bestWeapon` | weapon type number; the package's `WEAPON_TYPES` gives the name used in `WeaponTypeInfo.type` | 11,754 of 11,754 |
| `traitFirstCore`, `traitFirstSub`, `traitSecondSub` | `Trait.code` | 57,155 of 57,155 codes |
| `tacticalSkillGroup` | `TacticalSkillSetGroup.group` | 11,754 of 11,754 |
| `seasonId` | `Season.seasonID` | ranked games |

Counts are from 650 games of 13.0 and 13.1 in every mode, checked against the 13.1 tables.

## Mode numbers in the tables

`modeType` (or `mode`) in data tables does not use the game record's `matchingMode` numbers. Cobalt Protocol areas have `4`, Lumia Island areas have `1,2,3,5,6` and since 13.0 also `7`, which is Rumble Out (`matchingMode` 13). Most rows have `0` (878 rows). Some rows are split into `1,5` and `2,3,6,7`; what that split means was not checked. Values are a number or a comma-separated string.

## Characters

| Table | Rows | What it holds | Links |
|---|---|---|---|
| `Character` | 92 | Base stats per character: `maxHp`, `attackPower`, `defense`, `attackSpeed`, `moveSpeed`, `hpRegen`, plus archetypes (`charArcheType1`, `charArcheType2`) and melee or ranged (`weaponRangeType`). | name: `Character/Name/{code}` |
| `CharacterLevelUpStat` | 91 | Stat gains per level (same codes and fields as `Character`). | `code` = `Character.code` |
| `CharacterExp` | 20 | Experience needed for each in-game level, 1 to 20. Level 20 needs 0. | |
| `CharacterMastery` | 91 | Which weapon types each character can use (`weapon1` to `weapon4`, `None` when unused). The package's `getGameData()` reads it. | `code` = `Character.code`; weapons = `WeaponTypeInfo.type` |
| `CharacterAttributes` | 119 | One row per character and weapon: 1 to 5 ratings for `controlDifficulty`, `attack`, `defense`, `disruptor`, `move`, `assistance`. | `characterCode` = `Character.code`; `mastery` = `WeaponTypeInfo.type` |
| `CharacterModeModifier` | 211 | Per character and weapon, percentage adjustments by mode: damage dealt and taken, healing, shields, ultimate cooldown. Prefixes `solo`, `duo`, `squad`, `cobalt`, and `rumbleOut` since 13.0. All `squad` values are 100 (or 0 for bonuses). | `characterCode` = `Character.code` |
| `CharacterSkin` | 432 | Skins: `characterCode`, `grade`, `purchaseType` and resource paths. Each character has one skin with `index` 0, named after the character. | `characterCode` = `Character.code`; name: `Skin/Name/{code}` |
| `RecommendedList` | 119 | Per character and weapon, Cobalt Protocol settings: `cobaltRecommendTacticalSkill` and whether the weapon can be chosen. | `cobaltRecommendTacticalSkill` = `TacticalSkillSetGroup.group` (12 of 12) |

## Weapon and survival mastery

| Table | Rows | What it holds | Links |
|---|---|---|---|
| `WeaponTypeInfo` | 23 | Base `attackSpeed` and `attackRange` per weapon type. | name: `WeaponType/{type}` |
| `MasteryLevel` | 560 | Experience per mastery level (1 to 20) for 28 types: the 23 weapon types plus `Craft`, `Defense`, `Hunt`, `Move`, `Search`. | name: `MasteryType/{type}` |
| `MasteryExp` | 83 | Mastery experience gained per action, e.g. `CraftWeapon` or `AttackDamageToPlayer`, by item grade. | |
| `MasteryStat` | 124 | Stats a mastery gives per character and type, in four sections each. | `characterCode` = `Character.code`; 0 for masteries every character shares |

## Items

The five item tables share `code` space: an item code is in exactly one of them. Names: `Item/Name/{code}`.

| Table | Rows | What it holds | Links |
|---|---|---|---|
| `ItemWeapon` | 418 | Weapons: `weaponType`, `itemGrade`, stats, recipe (`makeMaterial1`, `makeMaterial2`). | recipe codes are item codes (214 of 214) |
| `ItemArmor` | 258 | Armor: `armorType` (`Head`, `Chest`, `Arm`, `Leg`), grade, stats, recipe. | recipe codes are item codes (109 of 109) |
| `ItemConsumable` | 54 | Food and other consumables: `consumableType`, `hpRecover`. | recipe codes are item codes |
| `ItemMisc` | 63 | Crafting materials. | recipe codes are item codes |
| `ItemSpecial` | 22 | Special items such as cameras and drones: `specialItemType`, `summonCode`. | `summonCode` = `SummonObjectStat.code` (7 of 7) |
| `ItemSearchOptionV2` | 676 | Up to three search tags per item, e.g. `Main_Attack`, `Sub1_AttackSpeed`. | 675 of 676 codes are weapons, armor or consumables |
| `BulletCapacity` | 53 | Ammunition count and reload time per gun. | 52 of 53 are `ItemWeapon` codes |
| `RandomEquipment` | 796 | Item pools by `group` (a slot or weapon type, some prefixed `RANDOM`) and grade. | `itemcode` = item codes (434 of 434) |

`itemGrade` is a string such as `Legend`; look it up with `ItemGrade/{itemGrade}`. Game records use numbers for grades; see the field guide.

## Map and gathering

| Table | Rows | What it holds | Links |
|---|---|---|---|
| `Area` | 33 | Areas: `areaType` (`Lumia` 20, `Cobalt` 4, and others), starting areas, hyperloops. | name: `Area/Name/{name}`, by `name`, not `code` |
| `NearByArea` | 86 | Pairs of neighboring areas. | both columns = `Area.code` |
| `ItemSpawn` | 1,574 | Items placed in each area at the start, with counts. | `areaCode` = `Area.code`; `itemCode` = item codes |
| `Collectible` | 14 | Gathering spots such as water, wood, stone and fish (12 kinds by `castingActionType`): item, cooldown, drop count. | item codes (14 of 14) |
| `NaviCollectAndHunt` | 12 | Which areas have each gatherable item. | `areaCodeList` = `Area.code`; `itemCode` = item codes |
| `ActionCost` | 61 | Time for actions such as resting, opening boxes, gathering and crafting (`time1`, `time2`). | |

Look up area names by `name`, not `code`: `Area/Name/Harbor` is the Harbor, while `Area/Name/10` is the Archery Range even though Harbor's `code` is 10.

## Monsters and drops

| Table | Rows | What it holds | Links |
|---|---|---|---|
| `Monster` | 74 | Wildlife and bosses (`Chicken`, `Bear`, `Wickline`, `Alpha`, `Omega`, `Gamma`, and others): stats, spawn day or night, respawn time. A `code` can have several rows, one per mode. | name: `Monster/Name/{code}` (72 of 74) |
| `MonsterLevelUpStat` | 73 | Stats gained per monster level. | `code` = `Monster.code` |
| `MonsterSpawnLevel` | 920 | Monster level by player level. | `monsterCode` = `Monster.code` |
| `MonsterDropGroup` | 674 | Drop group per monster and level. | `monsterCode` = `Monster.code`; `dropGroup` = `DropGroup.groupCode` for 34 of 51 groups |
| `DropGroup` | 267 | Items in each drop group, with chance and count. `dropType` includes `Random`, `Exclusive` and `PityProbability`. | `itemCode` = item codes (44 of 44) |
| `SummonObjectStat` | 159 | Stats of summoned objects such as cameras, drones and traps. `name` is Korean text. | |

17 drop groups used in `MonsterDropGroup` (for example `3001` to `3006`) have no rows in `DropGroup`.

## Augments, tactical skills and Cobalt Protocol

| Table | Rows | What it holds | Links |
|---|---|---|---|
| `Trait` | 148 | Augments: `traitGroup` (`Havoc`, `Fortification`, `Support`, `Chaos`, `Cobalt`), `traitType` (`Core`, `Sub1`, `Sub2`, `Cobalt`). 92 rows are Cobalt Protocol. | name: `Trait/Name/{code}` |
| `TacticalSkillSetGroup` | 43 | Tactical skill groups. `group` is the game record's `tacticalSkillGroup`. | `startCode` = `TacticalSkillSet.code` (43 of 43) |
| `TacticalSkillSet` | 78 | Each upgrade step: `nextUpgradeCode`, `upgradeCredit`, `skillCode`. | name: see the field guide's tactical skill lookup |
| `InfusionProduct` | 110 | Cobalt Protocol infusions: type (`Trait`, `TacticalSkill`, `Item` and others), price, stock. | `productCode` = `Trait.code` (81 of 81), tactical skill codes (21 of 21) or item codes (5 of 5) by `productType` |

## Credits, experience and scoring

| Table | Rows | What it holds |
|---|---|---|
| `VFCredit` | 197 | Credits gained for events such as kills and phase starts: `conditionType`, `acquireSelf`, `acquireTeam`. |
| `GainExp` | 18 | Experience gained over time, by time range in seconds (0 to 900). 9 rows for Cobalt Protocol, 9 for Rumble Out. |
| `GainScore` | 14 | Points by phase and condition, such as `Kill` and `DeadByMonster`. |
| `BattleZoneReward` | 15 | Battle zone rewards (as item codes). |
| `Level` | 600 | Levels 1 to 600 with experience needed and rewards (`rewardAcoin`, `reward`). |

## Text and seasons

| Table | Rows | What it holds | Links |
|---|---|---|---|
| `GameTip` | 92 | In-game tips for Lumia Island and Cobalt Protocol. | `titleTextKey`, `contentTextKey` are localization keys (92 of 92) |
| `LoadingTip` | 598 | Loading screen tips. | `textKey` is a localization key (598 of 598) |
| `Season` | 44 | Seasons with start and end times. The field guide explains the numbering. | `seasonID` = game record `seasonId` |

## Notes

- Some fields are a number in some rows and a string in others, for example `modeType` and `itemCode` in `DropGroup`. Convert before comparing.
- Don't redistribute whole tables; download them from the API with your own key.
- This guide covers published Open API tables only. The MIT license covers the code of this library only. Game data, text and other resources belong to Nimble Neuron and are not covered by it.
