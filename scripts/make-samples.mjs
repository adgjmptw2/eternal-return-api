// Builds samples/sample.json.gz from live API responses. Nicknames and game
// IDs are replaced, and RP and times are shifted, so rows cannot be matched
// back to real players. Run after `npm run build`:
//   ER_API_KEY=... node scripts/make-samples.mjs <leaderboard rank of the sample player>
import { randomInt } from 'node:crypto'
import { writeFileSync, mkdirSync } from 'node:fs'
import { gzipSync } from 'node:zlib'
import { ErClient, MatchingMode, buildGameNames } from '../dist/index.js'

const er = new ErClient({ apiKey: process.env.ER_API_KEY })
const seasons = await er.getSeasons()
const seasonId = seasons.currentRankedSeasonId
const top = await er.getTopRanks(seasonId)
const wantRank = Number(process.argv[2] ?? 950)
const entry = top.find((p) => p.rank === wantRank)
if (!entry) throw new Error(`no player at rank ${wantRank}`)
const real = await er.getUserByNickname(entry.nickname)

// Two ranked games, newest first.
const page = await er.getUserGames(real.uid)
const picked = page.games.filter((g) => g.matchingMode === MatchingMode.RANKED).slice(0, 2)
if (picked.length < 2) throw new Error('the player has fewer than two ranked games on the first page')
const games = []
for (const g of picked) games.push(await er.getGame(g.gameId))

const alias = new Map([[real.nickname, 'Player1']])
const name = (n) => {
  if (!alias.has(n)) alias.set(n, `Player${alias.size + 1}`)
  return alias.get(n)
}
for (const game of games) for (const p of game) name(p.nickname)
const realTopNames = new Set(top.map((p) => p.nickname))

// Game IDs are replaced: a real one would let anyone look the game up.
const gameIds = new Map(picked.map((g, i) => [g.gameId, 1_000_000 + picked.length - i]))
// One RP offset and one whole-day shift for everything, so the relations
// between fields still hold (mmrAfter = mmrBefore + mmrGain, expireDtm, ...).
const rpOffset = -(100 + randomInt(201))
const dayShift = -(7 + randomInt(22))
const RP_FIELDS = ['mmrBefore', 'mmrAfter', 'mmrAvg', 'rankPoint']
const shiftDate = (s) => {
  const m = /^(\d{4})-(\d\d)-(\d\d)(T.*)$/.exec(s)
  if (!m || Number(m[1]) < 2000) return s
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]) + dayShift))
  return `${d.toISOString().slice(0, 10)}${m[4]}`
}

const NICK_FIELDS = ['nickname', 'killDetail', 'killDetail2', 'killDetail3']
const clean = (row) => {
  const out = { ...row }
  for (const k of NICK_FIELDS) if (typeof out[k] === 'string' && out[k]) out[k] = name(out[k])
  out.gameId = gameIds.get(out.gameId)
  for (const k of RP_FIELDS) if (typeof out[k] === 'number') out[k] += rpOffset
  for (const k of Object.keys(out)) if (k.endsWith('Dtm') && typeof out[k] === 'string') out[k] = shiftDate(out[k])
  return out
}

// Leaderboard: shifted, with noise on every row, re-sorted. getUserRank for
// the sample player answers from their noisy row.
const board = top
  .map((p) => ({ me: p.nickname === real.nickname, mmr: p.mmr + rpOffset + randomInt(-20, 21) }))
  .sort((a, b) => b.mmr - a.mmr)
const myRank = board.findIndex((p) => p.me) + 1
if (!myRank) throw new Error('the sample player is not on the leaderboard')

const uid = 'sample-uid-1'
const bodies = {
  [`/v1/user/nickname?query=Player1`]: { code: 200, message: 'Success', user: { userId: uid, nickname: 'Player1' } },
  [`/v1/user/games/uid/${uid}`]: { code: 200, message: 'Success', userGames: picked.map(clean) },
  [`/v1/rank/top/${seasonId}/3`]: {
    code: 200,
    message: 'Success',
    topRanks: board.map((p, i) => ({ nickname: p.me ? 'Player1' : `Ranker${i + 1}`, rank: i + 1, mmr: p.mmr })),
  },
  [`/v1/rank/uid/${uid}/${seasonId}/3`]: {
    code: 200,
    message: 'Success',
    userRank: { nickname: 'Player1', rank: myRank, mmr: board[myRank - 1].mmr },
  },
}
for (const game of games) {
  bodies[`/v1/games/${gameIds.get(game[0].gameId)}`] = { code: 200, message: 'Success', userGames: game.map(clean) }
}
for (const table of ['Season', 'TacticalSkillSetGroup', 'TacticalSkillSet', 'CharacterMastery', 'ItemWeapon', 'ItemArmor']) {
  bodies[`/v2/data/${table}`] = { code: 200, message: 'Success', data: await er.getData(table) }
}

// Localization: whole name groups, plus only the items the sample games use.
const groups = bodies['/v2/data/TacticalSkillSetGroup'].data
const sets = bodies['/v2/data/TacticalSkillSet'].data
const PREFIXES = ['Character/Name/', 'Trait/Name/', 'WeaponType/', 'Skill/Group/Name/', 'ItemGrade/', 'ArmorType/']
const TIERS = ['IRON', 'BRONZE', 'SILVER', 'GOLD', 'PLATINUM', 'DIAMOND', 'METEORITE', 'MITHRIL', 'DEMIGOD', 'ETERNITY', 'UNRANK']
const items = new Set(games.flat().flatMap((p) => Object.values(p.equipment ?? {})).map((c) => `Item/Name/${c}`))
const files = {}
for (const language of ['Korean', 'English']) {
  const full = await er.getL10n(language)
  const small = new Map([...full].filter(([k]) => PREFIXES.some((x) => k.startsWith(x)) || TIERS.includes(k) || items.has(k)))
  // The small file must give the same names as the full one for every sample row.
  const a = buildGameNames(full, groups, sets)
  const b = buildGameNames(small, groups, sets)
  for (const p of games.flat()) {
    const codes = [p.traitFirstCore, ...(p.traitFirstSub ?? []), ...(p.traitSecondSub ?? [])]
    const same =
      a.character(p.characterNum) === b.character(p.characterNum) &&
      a.weapon(p.bestWeapon) === b.weapon(p.bestWeapon) &&
      a.tacticalSkill(p.tacticalSkillGroup) === b.tacticalSkill(p.tacticalSkillGroup) &&
      codes.every((c) => a.trait(c) === b.trait(c)) &&
      Object.values(p.equipment ?? {}).every((c) => a.item(c) === b.item(c))
    if (!same) throw new Error(`names differ for ${language}`)
  }
  files[language] = [...small].map(([k, v]) => `${k}┃${v}`).join('\n') + '\n'
  bodies[`/v1/l10n/${language}`] = { code: 200, message: 'Success', data: { l10Path: `sample:l10n/${language}` } }
}

const out = { seasonId, uid, bodies, files }
const text = JSON.stringify(out)
// Every string must be free of real nicknames. Game terms are skipped: a
// ranker named like a weapon ("Glove") is not a leak in `killerWeapon`.
const GAME_TERMS = /^(killerWeapon|killerCharacter|causeOfDeath|placeOf)/
const leaks = new Set()
const walk = (v, path, key = '') => {
  if (typeof v === 'string') {
    if (GAME_TERMS.test(key)) return
    for (const n of [...alias.keys(), ...realTopNames]) if (n.length > 1 && v.includes(n)) leaks.add(path.replace(/\.\d+/g, '[]'))
  } else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) walk(x, `${path}.${k}`, k)
}
// Data tables are game data with no player names; only player responses are checked.
for (const [path, body] of Object.entries(out.bodies)) if (!path.startsWith('/v2/data/')) walk(body, `bodies.${path}`)
if (leaks.size) throw new Error(`real nicknames left in: ${[...leaks].join(', ')}`)
for (const id of gameIds.keys()) if (text.includes(String(id))) throw new Error('a real game id is left in the sample')
// Rows carry no player IDs, and the shifts keep the relations between fields.
const ms = (dtm) => Date.parse(dtm.replace(/(\.\d{3})(\+\d\d)(\d\d)$/, '$1$2:$3'))
for (const [path, body] of Object.entries(bodies)) {
  if (!path.startsWith('/v1/games/')) continue
  const rows = body.userGames
  for (const p of rows) {
    if (['uid', 'userId', 'userNum'].some((k) => k in p)) throw new Error('a row has a player id')
    const ok =
      p.mmrAfter === p.mmrBefore + p.mmrGain &&
      p.rankPoint === p.mmrAfter &&
      p.mmrAvg === Math.floor(rows.reduce((n, x) => n + x.mmrBefore, 0) / rows.length) &&
      Math.abs(ms(p.expireDtm) - ms(p.startDtm) - (90 * 86400 + p.duration) * 1000) <= 5000
    if (!ok) throw new Error(`field relations broke in ${path}`)
  }
}
mkdirSync(new URL('../samples/', import.meta.url), { recursive: true })
writeFileSync(new URL('../samples/sample.json.gz', import.meta.url), gzipSync(text, { level: 9 }))
console.log('games', games.length, 'modes', picked.map((g) => g.matchingMode).join(','), 'players', alias.size, 'bytes', text.length)
