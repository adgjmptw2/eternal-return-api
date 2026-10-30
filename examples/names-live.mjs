// Live check for getNames and summarizeGames. Usage: ER_API_KEY=... node examples/names-live.mjs <nickname>
import { ErClient, summarizeGames } from '../dist/index.js'
const er = new ErClient({ apiKey: process.env.ER_API_KEY })
const names = await er.getNames('Korean')
const user = await er.getUserByNickname(process.argv[2])
const games = []
for await (const game of er.iterateUserGames(user.uid, { maxPages: 2 })) games.push(game)
const g = games[0]
console.log(names.character(g.characterNum), names.weapon(g.bestWeapon), names.tacticalSkill(g.tacticalSkillGroup),
  names.trait(g.traitFirstCore), (g.traitFirstSub ?? []).map(names.trait), Object.values(g.equipment ?? {}).map(names.item))
const s = summarizeGames(games)
console.log(s.overall, s.characters.slice(0, 3).map((c) => [names.character(c.characterNum), c.games, c.averageRank.toFixed(1)]))
const unknown = { weapon: new Set(), tactical: new Set(), trait: new Set(), item: new Set() }
for (const x of games) {
  if (!names.weapon(x.bestWeapon)) unknown.weapon.add(x.bestWeapon)
  if (x.tacticalSkillGroup && !names.tacticalSkill(x.tacticalSkillGroup)) unknown.tactical.add(x.tacticalSkillGroup)
  for (const t of [x.traitFirstCore, ...(x.traitFirstSub ?? []), ...(x.traitSecondSub ?? [])]) if (t && !names.trait(t)) unknown.trait.add(t)
  for (const i of Object.values(x.equipment ?? {})) if (i && !names.item(i)) unknown.item.add(i)
}
console.log('unknown', unknown)
