// Live check against the real API. Uses about 6 requests.
//   ER_API_KEY=... node examples/smoke.mjs <nickname>
import { ErClient } from '../dist/index.js'

const nickname = process.argv[2]
if (!process.env.ER_API_KEY || !nickname) {
  console.error('usage: ER_API_KEY=... node examples/smoke.mjs <nickname>')
  process.exit(1)
}

const er = new ErClient({ apiKey: process.env.ER_API_KEY })

const seasons = await er.getSeasons()
console.log('current season row:', seasons.current?.seasonName, '-> ranked id', seasons.currentRankedSeasonId)

const user = await er.getUserByNickname(nickname)
console.log('user:', user)
if (!user) process.exit(0)

const page = await er.getUserGames(user.uid)
console.log('games on first page:', page.games.length, 'next:', page.next)

const first = page.games[0]
if (first) {
  const players = await er.getGame(first.gameId)
  console.log('players in game', first.gameId, ':', players.length)
}

const rank = await er.getUserRank(user.uid, seasons.currentRankedSeasonId)
console.log('rank:', rank?.rank, 'mmr:', rank?.mmr)

const names = await er.getCharacterNames('Korean')
console.log('characters:', names.size, first ? `(${first.characterNum} = ${names.get(first.characterNum)})` : '')
