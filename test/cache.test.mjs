import { test } from 'node:test'
import assert from 'node:assert/strict'
import { ErClient, MemoryCache, groupTeams, cacheKindOf } from '../dist/index.js'

function json(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}

function setup(routes, options = {}) {
  let clock = 0
  const calls = []
  const cache = options.cache ?? new MemoryCache({ now: () => clock })
  const client = new ErClient({
    apiKey: 'k',
    // The limiter waits through sleep, so sleeping must move the clock.
    sleep: async (ms) => { clock += ms },
    now: () => clock,
    cache,
    fetch: async (url) => {
      const key = new URL(url).pathname
      calls.push(key)
      const route = routes[key]
      if (!route) return json({ code: 404, message: 'Not Found' }, 404)
      return typeof route === 'function' ? route() : route
    },
    ...options.client,
  })
  return { client, calls, cache, tick: (ms) => { clock += ms } }
}

const game = (id) => json({ code: 200, message: 'ok', userGames: [{ gameId: id, teamNumber: 1, gameRank: 1 }] })

test('cache: hit skips the API, expires after the ttl', async () => {
  const { client, calls, tick } = setup({ '/v1/games/1': () => game(1) })
  await client.getGame(1)
  await client.getGame(1)
  assert.equal(calls.length, 1)
  tick(60 * 60_000)
  await client.getGame(1)
  assert.equal(calls.length, 2)
})

test('cache: concurrent calls share one request but not one object', async () => {
  const { client, calls } = setup({ '/v1/games/1': () => game(1) })
  const [a, b] = await Promise.all([client.getGame(1), client.getGame(1)])
  assert.equal(calls.length, 1)
  assert.deepEqual(a, b)
  assert.notEqual(a, b)
})

test('cache: errors and not-found are not cached', async () => {
  let n = 0
  const { client, calls } = setup({ '/v1/games/2': () => (++n === 1 ? json({ code: 500, message: 'x' }, 500) : game(2)) })
  await assert.rejects(client.getGame(2))
  assert.equal((await client.getGame(2)).length, 1)
  await client.getGame(3)
  await client.getGame(3)
  assert.equal(calls.length, 4)
})

test('cache: ttl 0 turns one kind off, a broken store is ignored', async () => {
  const { client, calls } = setup({ '/v1/games/1': () => game(1) }, { client: { cacheTtlMs: { game: 0 } } })
  await client.getGame(1)
  await client.getGame(1)
  assert.equal(calls.length, 2)

  const broken = { get: () => { throw new Error('down') }, set: async () => { throw new Error('down') } }
  const b = setup({ '/v1/games/1': () => game(1) }, { cache: broken })
  assert.equal((await b.client.getGame(1)).length, 1)
})

test('cache: a store that never answers does not block requests', async () => {
  const hung = { get: () => new Promise(() => {}), set: () => new Promise(() => {}) }
  const { client, calls } = setup({ '/v1/games/1': () => game(1) }, { cache: hung, client: { cacheTimeoutMs: 20 } })
  assert.equal((await client.getGame(1)).length, 1)
  assert.equal((await client.getGame(1)).length, 1)
  assert.equal(calls.length, 2)
})

test('cache: a slow miss still shares one request with a concurrent caller', async () => {
  let release
  const gate = new Promise((r) => { release = r })
  const store = new Map()
  const slow = { get: async (k) => { await gate; return store.get(k) }, set: (k, v) => { store.set(k, v) } }
  const { client, calls } = setup({ '/v1/games/1': () => game(1) }, { cache: slow })
  const a = client.getGame(1)
  const b = client.getGame(1)
  release()
  await Promise.all([a, b])
  assert.equal(calls.length, 1)
})

test('MemoryCache drops the least recently used entry', () => {
  const cache = new MemoryCache({ maxEntries: 2 })
  cache.set('a', '1', 1000)
  cache.set('b', '2', 1000)
  cache.get('a')
  cache.set('c', '3', 1000)
  assert.equal(cache.get('b'), undefined)
  assert.equal(cache.get('a'), '1')
  assert.equal(cache.size, 2)
})

test('cacheKindOf', () => {
  assert.equal(cacheKindOf('/v1/user/nickname?query=a'), 'nickname')
  assert.equal(cacheKindOf('/v1/rank/top/33/3'), 'topRanks')
  assert.equal(cacheKindOf('/v1/rank/uid/u/33/3'), 'rank')
  assert.equal(cacheKindOf('/v1/l10n/Korean'), 'other')
})

test('groupTeams groups by team, best placement first', () => {
  const p = (teamNumber, gameRank, playerKill, extra = {}) =>
    ({ teamNumber, gameRank, playerKill, playerAssistant: 1, damageToPlayer: 100, victory: gameRank === 1 ? 1 : 0, ...extra })
  const teams = groupTeams([
    p(2, 3, 1, { teamKill: 5 }), p(1, 1, 2), p(2, 3, 4, { teamKill: 5 }), p(1, 1, 6), p(undefined, 0, 0),
  ])
  assert.deepEqual(teams.map((t) => [t.teamNumber, t.gameRank, t.teamKills]), [[1, 1, 8], [2, 3, 5], [null, 0, 0]])
  assert.equal(teams[0].victory, true)
  assert.deepEqual(teams[0].players.map((x) => x.playerKill), [6, 2])
  assert.equal(teams[1].damageToPlayer, 200)
})

test('groupTeams takes rank and team kills from the member who stayed longest', () => {
  // Live game: the player who gave up kept rank 5 and 14 team kills from when they left.
  const p = (gameRank, teamKill, duration, giveUp) =>
    ({ teamNumber: 1, gameRank, teamKill, duration, giveUp, playerKill: 1, victory: 0 })
  const [team] = groupTeams([p(5, 14, 906, 1), p(3, 18, 1070, 0), p(3, 18, 1070, 0)])
  assert.equal(team.gameRank, 3)
  assert.equal(team.teamKills, 18)
})

test('groupTeams prefers members who did not give up, then the longest duration', () => {
  const p = (gameRank, teamKill, duration, giveUp) =>
    ({ teamNumber: 1, gameRank, teamKill, duration, giveUp, playerKill: 1, victory: 0 })
  const pick = (rows) => { const [t] = groupTeams(rows); return [t.gameRank, t.teamKills] }
  // Longest duration wins, in either order.
  assert.deepEqual(pick([p(4, 10, 900, 0), p(3, 18, 1070, 0)]), [3, 18])
  assert.deepEqual(pick([p(3, 18, 1070, 0), p(4, 10, 900, 0)]), [3, 18])
  // Tie on duration: the member who gave up loses even when first.
  assert.deepEqual(pick([p(5, 14, 1070, 1), p(3, 18, 1070, 0)]), [3, 18])
  // A longer duration from a member who gave up still loses.
  assert.deepEqual(pick([p(5, 14, 2000, 1), p(3, 18, 1070, 0)]), [3, 18])
  // Missing or NaN duration does not hide a real one.
  assert.deepEqual(pick([p(5, 14, NaN, 0), p(3, 18, 1070, 0)]), [3, 18])
  assert.deepEqual(pick([p(5, 14, undefined, 0), p(3, 18, 1070, 0)]), [3, 18])
  // Everyone gave up: the one who stayed longest.
  assert.deepEqual(pick([p(5, 14, 900, 1), p(4, 16, 1000, 1)]), [4, 16])
  // Chosen row lacks teamKill: highest among members who did not give up.
  assert.deepEqual(pick([p(3, undefined, 1070, 0), p(3, 12, 900, 0), p(5, 20, 800, 1)]), [3, 12])
  // No teamKill anywhere: sum of kills.
  assert.deepEqual(pick([p(3, undefined, 1070, 0), p(3, undefined, 900, 0)]), [3, 2])
})
