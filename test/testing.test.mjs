import { test } from 'node:test'
import assert from 'node:assert/strict'
import { groupTeams, rankTier, summarizeGames } from '../dist/index.js'
import { createSampleClient, sampleFetch, SAMPLE_NICKNAME } from '../dist/testing.js'

test('sample client: player, games, teams, names, ranks', async () => {
  const er = createSampleClient()
  const user = await er.getUserByNickname(SAMPLE_NICKNAME)
  assert.equal(user.nickname, SAMPLE_NICKNAME)

  const { games } = await er.getUserGames(user.uid)
  assert.ok(games.length >= 2)
  assert.ok(games.every((g) => g.nickname === SAMPLE_NICKNAME))
  assert.equal(summarizeGames(games).overall.games, games.length)

  const players = await er.getGame(games[0].gameId)
  assert.ok(players.length >= 18)
  assert.ok(players.some((p) => p.nickname === SAMPLE_NICKNAME))
  assert.equal(groupTeams(players)[0].gameRank, 1)

  for (const language of ['Korean', 'English']) {
    const names = await er.getNames(language)
    for (const p of players) {
      assert.ok(names.character(p.characterNum), `character ${p.characterNum}`)
      assert.ok(names.weapon(p.bestWeapon), `weapon ${p.bestWeapon}`)
      for (const code of Object.values(p.equipment)) assert.ok(names.item(code), `item ${code}`)
    }
    assert.ok(names.tier('diamond'))
  }

  const seasons = await er.getSeasons()
  const seasonId = seasons.currentRankedSeasonId
  const top = await er.getTopRanks(seasonId)
  assert.equal(top[0].rank, 1)
  const rank = await er.getUserRank(user.uid, seasonId)
  assert.ok(rank.mmr > 0)
  assert.ok(rankTier(rank.mmr, { rank: rank.rank, season: seasons.playerSeasonOf(seasonId) }).name)
})

test('sample client: anything else is not found, like the real API', async () => {
  const er = createSampleClient()
  assert.equal(await er.getUserByNickname('nobody'), null)
  assert.deepEqual(await er.getGame(1), [])
  const res = await sampleFetch()('https://open-api.bser.io/v1/unknown')
  assert.equal(res.status, 200)
  assert.deepEqual(await res.json(), { code: 404, message: 'Not Found' })
})

test('sample data uses only made-up names and ids', async () => {
  const er = createSampleClient()
  const seasons = await er.getSeasons()
  const top = await er.getTopRanks(seasons.currentRankedSeasonId)
  assert.ok(top.length > 100)
  assert.ok(top.every((p) => /^(Ranker\d+|Player1)$/.test(p.nickname)))
  const user = await er.getUserByNickname(SAMPLE_NICKNAME)
  const { games } = await er.getUserGames(user.uid)
  for (const g of games) {
    assert.ok(g.gameId < 2_000_000)
    for (const p of await er.getGame(g.gameId)) {
      for (const k of ['nickname', 'killDetail', 'killDetail2', 'killDetail3']) {
        if (p[k]) assert.match(p[k], /^Player\d+$/, k)
      }
    }
  }
})

test('sample games keep the field relations described in GUIDE.md', async () => {
  const er = createSampleClient()
  const user = await er.getUserByNickname(SAMPLE_NICKNAME)
  const { games } = await er.getUserGames(user.uid)
  const ms = (dtm) => Date.parse(dtm.replace(/(\.\d{3})(\+\d\d)(\d\d)$/, '$1$2:$3'))
  for (const g of games) {
    const rows = await er.getGame(g.gameId)
    const avg = Math.floor(rows.reduce((n, p) => n + p.mmrBefore, 0) / rows.length)
    for (const p of rows) {
      assert.equal(p.mmrAfter, p.mmrBefore + p.mmrGain)
      assert.equal(p.mmrGain, p.mmrGainInGame + p.mmrLossEntryCost)
      assert.equal(p.rankPoint, p.mmrAfter)
      assert.equal(p.mmrAvg, avg)
      assert.ok(Math.abs(ms(p.expireDtm) - ms(p.startDtm) - (90 * 86400 + p.duration) * 1000) <= 5000)
      const [, sec, milli] = /:(\d\d)\.(\d{3})/.exec(p.startDtm)
      assert.equal(Number(milli), Number(sec))
      assert.ok(!('userNum' in p) && !('uid' in p))
    }
  }
})
