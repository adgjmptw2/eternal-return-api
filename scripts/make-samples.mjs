// Builds samples/sample.json.gz: made-up responses in the shape of the Open
// API, for testing without a key. Nothing here comes from the API: every
// name, code and number is invented. Only the field names, the structure and
// the relations between fields (see GUIDE.md) follow the real API.
// The output is the same on every run:
//   node scripts/make-samples.mjs
import { writeFileSync, mkdirSync } from 'node:fs'
import { gzipSync } from 'node:zlib'

// Small seeded PRNG, so the file does not change between runs.
let seed = 20261102
const rand = () => {
  seed = (seed + 0x6d2b79f5) | 0
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296
}
const int = (lo, hi) => lo + Math.floor(rand() * (hi - lo + 1))
const pick = (list) => list[int(0, list.length - 1)]

const SEASON_ID = 41
const UID = 'sample-uid-1'

// Weapon type keys and numbers are the API's enum (see WEAPON_TYPES).
const WEAPONS = { 1: 'Glove', 2: 'Tonfa', 7: 'Bow', 9: 'Pistol', 15: 'OneHandSword', 19: 'Spear' }
const WEAPON_NAMES = {
  Glove: ['글러브', 'Glove'],
  Tonfa: ['톤파', 'Tonfa'],
  Bow: ['활', 'Bow'],
  Pistol: ['권총', 'Pistol'],
  OneHandSword: ['한손검', 'One-handed Sword'],
  Spear: ['창', 'Spear'],
}
const weaponNumber = Object.fromEntries(Object.entries(WEAPONS).map(([n, k]) => [k, Number(n)]))
const weaponKeys = Object.values(WEAPONS)

// 12 made-up characters, each with two weapon types.
const characters = Array.from({ length: 12 }, (_, i) => {
  const first = weaponKeys[i % weaponKeys.length]
  const second = weaponKeys[(i + 2) % weaponKeys.length]
  return { code: i + 1, weapons: [first, second] }
})

// Items: one weapon per weapon type and grade, armor per slot and grade.
const GRADES = { Epic: 4, Legend: 5, Mythic: 6 }
const itemWeapons = []
const itemArmors = []
const itemNames = {}
let n = 0
for (const key of weaponKeys) {
  for (const [grade] of Object.entries(GRADES)) {
    const code = 910000 + ++n
    itemWeapons.push({
      code, itemType: 'Weapon', weaponType: key, itemGrade: grade, isCompletedItem: true,
      makeMaterial1: 0, makeMaterial2: 0, attackPower: int(20, 80),
    })
    itemNames[code] = [`샘플 ${WEAPON_NAMES[key][0]} ${grade}`, `Sample ${WEAPON_NAMES[key][1]} ${grade}`]
  }
}
const SLOTS = { 1: 'Chest', 2: 'Head', 3: 'Arm', 4: 'Leg' }
const SLOT_NAMES = { Chest: ['옷', 'Chest'], Head: ['머리', 'Head'], Arm: ['팔', 'Arm'], Leg: ['다리', 'Leg'] }
for (const slot of Object.values(SLOTS)) {
  for (const [grade] of Object.entries(GRADES)) {
    const code = 920000 + ++n
    itemArmors.push({
      code, itemType: 'Armor', armorType: slot, itemGrade: grade, isCompletedItem: true,
      makeMaterial1: 0, makeMaterial2: 0, defense: int(5, 40),
    })
    itemNames[code] = [`샘플 ${SLOT_NAMES[slot][0]} 방어구 ${grade}`, `Sample ${SLOT_NAMES[slot][1]} Armor ${grade}`]
  }
}

// Traits and tactical skills.
const traits = Array.from({ length: 10 }, (_, i) => 9100001 + i)
const tacticalGroups = [10, 20, 30, 40].map((group, i) => ({ group, startCode: group + 1, icon: `SampleIcon_${9500000 + i * 1000}` }))
const tacticalSets = tacticalGroups.map((g, i) => ({ code: g.startCode, skillCode: 9500001 + i * 1000, nextUpgradeCode: 0 }))

// Two ranked squad games. The second has 7 teams: finished games can have fewer than 24 rows.
const pad = (x) => String(x).padStart(2, '0')
const kst = (ms) => {
  const d = new Date(ms + 9 * 3600_000)
  const sec = d.getUTCSeconds()
  // The API's milliseconds repeat the seconds.
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}T${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(sec)}.0${pad(sec)}+0900`
}
const DAY = 86_400_000
let nextPlayer = 2

function makeGame(gameId, startMs, teams, meTeam, meRank) {
  const rows = []
  const ranks = Array.from({ length: teams }, (_, i) => i + 1)
  // Put the sample player's team at the wanted rank.
  const order = ranks.filter((r) => r !== meRank)
  for (let t = 1; t <= teams; t++) {
    const rank = t === meTeam ? meRank : order.shift()
    const duration = 1500 - rank * 90 + int(0, 40)
    const elim = int(0, 6)
    const down1 = int(0, 4)
    const down2 = int(0, 2)
    const gainInGame = Math.max(0, 140 - rank * 18) + int(0, 10)
    const premade = pick([[1, 1, 1], [1, 2, 2], [3, 3, 3]])
    for (let m = 0; m < 3; m++) {
      const me = t === meTeam && m === 0
      const ch = me ? characters[0] : pick(characters)
      const weaponKey = pick(ch.weapons)
      const weapon = pick(itemWeapons.filter((w) => w.weaponType === weaponKey))
      const equipment = { 0: weapon.code }
      const equipmentGrade = { 0: GRADES[weapon.itemGrade] }
      for (const [key, slot] of Object.entries(SLOTS)) {
        const armor = pick(itemArmors.filter((a) => a.armorType === slot))
        equipment[key] = armor.code
        equipmentGrade[key] = GRADES[armor.itemGrade]
      }
      // One player in team 3 gave up: they keep the rank, team kills and time from when they left.
      const gaveUp = t === 3 && m === 2
      const rowRank = gaveUp ? Math.min(teams, rank + 2) : rank
      const rowDuration = gaveUp ? duration - 160 : duration
      const before = int(7000, 9000)
      const cost = -int(66, 72)
      const playTime = rowDuration - int(0, 60)
      rows.push({
        gameId,
        seasonId: SEASON_ID,
        matchingMode: 3,
        matchingTeamMode: 3,
        versionSeason: 12,
        versionMajor: 6,
        versionMinor: 0,
        nickname: me ? 'Player1' : `Player${nextPlayer++}`,
        teamNumber: t,
        characterNum: ch.code,
        characterLevel: int(12, 20),
        skinCode: ch.code * 1000,
        bestWeapon: weaponNumber[weaponKey],
        bestWeaponLevel: int(10, 20),
        tacticalSkillGroup: pick(tacticalGroups).group,
        tacticalSkillLevel: int(1, 2),
        traitFirstCore: traits[0 + (m % 2)],
        traitFirstSub: [traits[2], traits[3]],
        traitSecondSub: [traits[4 + (m % 3)], traits[7]],
        equipment,
        equipmentGrade,
        gameRank: rowRank,
        victory: rowRank === 1 ? 1 : 0,
        playerKill: int(0, 6),
        playerAssistant: int(0, 8),
        playerDeaths: int(0, 2),
        teamKill: gaveUp ? Math.max(0, elim + down1 + down2 - 4) : elim + down1 + down2,
        teamElimination: elim,
        teamDownCanEliminate: down1,
        teamDownCanNotEliminate: down2,
        monsterKill: int(10, 60),
        damageToPlayer: int(5000, 40000),
        damageToMonster: int(10000, 60000),
        damageFromPlayer: int(5000, 35000),
        mmrBefore: before,
        mmrGainInGame: gainInGame,
        mmrLossEntryCost: cost,
        mmrGain: gainInGame + cost,
        mmrAfter: before + gainInGame + cost,
        rankPoint: before + gainInGame + cost,
        preMade: premade[m],
        botAdded: 0,
        botRemain: 0,
        giveUp: gaveUp ? 1 : 0,
        startDtm: kst(startMs),
        expireDtm: kst(startMs + (rowDuration + 90 * 86400) * 1000),
        playTime,
        watchTime: rowDuration - playTime,
        totalTime: rowDuration,
        duration: rowDuration,
      })
    }
  }
  const avg = Math.floor(rows.reduce((s, r) => s + r.mmrBefore, 0) / rows.length)
  for (const r of rows) r.mmrAvg = avg
  return rows
}

const now = Date.UTC(2026, 9, 20, 6, 30, 7)
const games = [
  makeGame(1000002, now, 8, 2, 1),
  makeGame(1000001, now - DAY + 3600_000 * 2 + 13_000, 7, 4, 5),
]
const myRows = games.map((g) => g.find((r) => r.nickname === 'Player1'))

// Leaderboard of 1,001 made-up players; Player1 is in it.
const board = Array.from({ length: 1001 }, (_, i) => ({ nickname: `Ranker${i + 1}`, rank: i + 1, mmr: 11000 - i * 3 }))
const myRank = 950
board[myRank - 1] = { nickname: 'Player1', rank: myRank, mmr: board[myRank - 1].mmr }

const ok = (body) => ({ code: 200, message: 'Success', ...body })
const bodies = {
  '/v1/user/nickname?query=Player1': ok({ user: { userId: UID, nickname: 'Player1' } }),
  [`/v1/user/games/uid/${UID}`]: ok({ userGames: myRows }),
  [`/v1/rank/top/${SEASON_ID}/3`]: ok({ topRanks: board }),
  [`/v1/rank/uid/${UID}/${SEASON_ID}/3`]: ok({ userRank: { nickname: 'Player1', rank: myRank, mmr: board[myRank - 1].mmr } }),
  '/v2/data/Season': ok({
    data: [
      { seasonID: 39, seasonName: 'Season20', seasonStart: '2026-02-12 12:00:00', seasonEnd: '2026-05-14 09:00:00', isCurrent: 0 },
      { seasonID: 40, seasonName: 'Pre-Season21', seasonStart: '2026-05-14 12:00:00', seasonEnd: '2026-06-11 09:00:00', isCurrent: 0 },
      { seasonID: 41, seasonName: 'Season21', seasonStart: '2026-06-11 12:00:00', seasonEnd: '2026-09-10 09:00:00', isCurrent: 1 },
    ],
  }),
  '/v2/data/TacticalSkillSetGroup': ok({ data: tacticalGroups.map((g) => ({ ...g, modeType: 0, active: true })) }),
  '/v2/data/TacticalSkillSet': ok({ data: tacticalSets }),
  '/v2/data/CharacterMastery': ok({
    data: characters.map((c) => ({
      code: c.code, weapon1: c.weapons[0], weapon2: c.weapons[1], weapon3: 'None', weapon4: 'None',
    })),
  }),
  '/v2/data/ItemWeapon': ok({ data: itemWeapons }),
  '/v2/data/ItemArmor': ok({ data: itemArmors }),
}
for (const g of games) bodies[`/v1/games/${g[0].gameId}`] = ok({ userGames: g })

// Localization files, Korean then English, with only the keys the sample needs.
const TIERS = {
  UNRANK: ['언랭크', 'Unranked'], IRON: ['아이언', 'Iron'], BRONZE: ['브론즈', 'Bronze'], SILVER: ['실버', 'Silver'],
  GOLD: ['골드', 'Gold'], PLATINUM: ['플래티넘', 'Platinum'], DIAMOND: ['다이아몬드', 'Diamond'],
  METEORITE: ['메테오라이트', 'Meteorite'], MITHRIL: ['미스릴', 'Mythril'], DEMIGOD: ['데미갓', 'Titan'],
  ETERNITY: ['이터니티', 'Immortal'],
}
const GRADE_NAMES = { Epic: ['영웅', 'Epic'], Legend: ['전설', 'Legendary'], Mythic: ['초월', 'Mythic'] }
const files = {}
for (const [language, i] of [['Korean', 0], ['English', 1]]) {
  const lines = []
  for (const c of characters) lines.push([`Character/Name/${c.code}`, i ? `Sample Subject ${c.code}` : `샘플 실험체 ${c.code}`])
  for (const [key, names] of Object.entries(WEAPON_NAMES)) lines.push([`WeaponType/${key}`, names[i]])
  for (const [code, names] of Object.entries(itemNames)) lines.push([`Item/Name/${code}`, names[i]])
  for (const [k, t] of traits.entries()) lines.push([`Trait/Name/${t}`, i ? `Sample Trait ${k + 1}` : `샘플 특성 ${k + 1}`])
  for (const [k, s] of tacticalSets.entries()) {
    lines.push([`Skill/Group/Name/${s.skillCode - (s.skillCode % 1000)}`, i ? `Sample Tactical Skill ${k + 1}` : `샘플 전술 스킬 ${k + 1}`])
  }
  for (const [key, names] of Object.entries(TIERS)) lines.push([key, names[i]])
  for (const [key, names] of Object.entries(GRADE_NAMES)) lines.push([`ItemGrade/${key}`, names[i]])
  for (const [key, names] of Object.entries(SLOT_NAMES)) lines.push([`ArmorType/${key}`, names[i]])
  files[language] = lines.map(([k, v]) => `${k}┃${v}`).join('\n') + '\n'
  bodies[`/v1/l10n/${language}`] = ok({ data: { l10Path: `sample:l10n/${language}` } })
}

// The relations GUIDE.md describes must hold.
const ms = (dtm) => Date.parse(dtm.replace(/(\.\d{3})(\+\d\d)(\d\d)$/, '$1$2:$3'))
for (const rows of games) {
  for (const p of rows) {
    const holds =
      p.mmrAfter === p.mmrBefore + p.mmrGain &&
      p.mmrGain === p.mmrGainInGame + p.mmrLossEntryCost &&
      p.rankPoint === p.mmrAfter &&
      p.totalTime === p.playTime + p.watchTime &&
      Math.abs(ms(p.expireDtm) - ms(p.startDtm) - (90 * 86400 + p.duration) * 1000) <= 5000
    if (!holds) throw new Error(`field relations broke in game ${p.gameId}`)
  }
  if (!rows.some((p) => p.gameRank === 1)) throw new Error('a sample game has no winner')
}

const text = JSON.stringify({ seasonId: SEASON_ID, uid: UID, bodies, files })
mkdirSync(new URL('../samples/', import.meta.url), { recursive: true })
writeFileSync(new URL('../samples/sample.json.gz', import.meta.url), gzipSync(text, { level: 9, mtime: 0 }))
console.log('games', games.length, 'rows', games.map((g) => g.length).join('+'), 'bytes', text.length)
