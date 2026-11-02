import { test } from 'node:test'
import assert from 'node:assert/strict'
import { ErClient, MemoryCache, isGameFinished } from '../dist/index.js'

function json(body) {
  return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } })
}

const row = (gameId, extra = {}) => ({
  gameId,
  gameRank: 3,
  startDtm: new Date(Date.UTC(2026, 9, 1) + gameId * 60_000).toISOString(),
  ...extra,
})

/**
 * A fake API for one player's game list, served like the real one: newest
 * first, `pageSize` per page, `next` is the last game id of the page and a
 * request with `next` starts below it.
 */
function server({ ids = [], pageSize = 3, games = {} } = {}) {
  const state = { ids: structuredClone(ids), calls: [], fail: new Set() }
  const fetch = async (url) => {
    const u = new URL(url)
    state.calls.push(u.pathname + u.search)
    const m = /^\/v1\/user\/games\/uid\/([^/]+)$/.exec(u.pathname)
    if (m) {
      const uid = decodeURIComponent(m[1])
      if (state.fail.has(uid)) return new Response('boom', { status: 500 })
      const list = (state.ids[uid] ?? state.ids).slice().sort((a, b) => b - a)
      const next = u.searchParams.get('next')
      const below = next === null ? list : list.filter((id) => id < Number(next))
      const page = below.slice(0, pageSize)
      const body = { code: 200, message: 'Success', userGames: page.map((id) => row(id)) }
      if (below.length > pageSize) body.next = page.at(-1)
      return json(body)
    }
    const g = /^\/v1\/games\/(\d+)$/.exec(u.pathname)
    if (g && games[g[1]]) return json({ code: 200, message: 'Success', userGames: games[g[1]]() })
    return json({ code: 404, message: 'Not Found' })
  }
  return { state, fetch }
}

function client(fetch, extra = {}) {
  let clock = 0
  const c = new ErClient({
    apiKey: 'k',
    fetch,
    requestsPerSecond: 1000,
    burst: 1000,
    sleep: async (ms) => { clock += ms },
    now: () => clock,
    ...extra,
  })
  return c
}

async function collect(iterable) {
  const out = []
  for await (const x of iterable) out.push(x)
  return out
}

test('iterateUserGames stops at after without reading the next page', async () => {
  const { state, fetch } = server({ ids: [10, 9, 8, 7, 6, 5, 4] })
  const games = await collect(client(fetch).iterateUserGames('u', { after: 8 }))
  assert.deepEqual(games.map((g) => g.gameId), [10, 9])
  assert.deepEqual(state.calls, ['/v1/user/games/uid/u'])
})

test('iterateUserGames before starts below that game in one request', async () => {
  const { state, fetch } = server({ ids: [10, 9, 8, 7, 6, 5, 4] })
  const games = await collect(client(fetch).iterateUserGames('u', { before: 8, maxPages: 1 }))
  assert.deepEqual(games.map((g) => g.gameId), [7, 6, 5])
  assert.deepEqual(state.calls, ['/v1/user/games/uid/u?next=8'])
})

test('syncUserGames returns new games and the id to save', async () => {
  const { state, fetch } = server({ ids: [10, 9, 8, 7, 6, 5, 4] })
  const er = client(fetch)
  const first = await er.syncUserGames('u', { after: 5 })
  assert.deepEqual(first.games.map((g) => g.gameId), [10, 9, 8, 7, 6])
  assert.equal(first.newestGameId, 10)
  assert.equal(first.rest, undefined)

  const none = await er.syncUserGames('u', { after: 10 })
  assert.deepEqual(none.games, [])
  assert.equal(none.newestGameId, 10)

  state.ids.push(11, 12)
  const later = await er.syncUserGames('u', { after: 10 })
  assert.deepEqual(later.games.map((g) => g.gameId), [12, 11])
  assert.equal(later.newestGameId, 12)
})

test('syncUserGames with no games keeps after', async () => {
  const { fetch } = server({ ids: [] })
  const er = client(fetch)
  assert.deepEqual(await er.syncUserGames('u', { after: 7 }), { games: [], newestGameId: 7 })
  assert.deepEqual(await er.syncUserGames('u'), { games: [], newestGameId: undefined })
})

test('syncUserGames rest fills the gap left by maxPages', async () => {
  const { fetch } = server({ ids: [10, 9, 8, 7, 6, 5, 4, 3, 2, 1] })
  const er = client(fetch)
  const first = await er.syncUserGames('u', { after: 2, maxPages: 1 })
  assert.deepEqual(first.games.map((g) => g.gameId), [10, 9, 8])
  // Saving 10 now would skip 7 to 3 if the process stopped here.
  assert.equal(first.newestGameId, 2)
  assert.deepEqual(first.rest, { after: 2, maxPages: 1, before: 8, resumeNewestGameId: 10 })

  const all = [...first.games]
  let last = first
  while (last.rest) {
    last = await er.syncUserGames('u', last.rest)
    all.push(...last.games)
    if (last.rest) assert.equal(last.newestGameId, 2)
  }
  assert.deepEqual(all.map((g) => g.gameId), [10, 9, 8, 7, 6, 5, 4, 3])
  assert.equal(last.newestGameId, 10)
})

test('maxPages must be a whole number, 1 or more', async () => {
  const { fetch } = server({ ids: [1] })
  for (const maxPages of [0, -1, 1.5, NaN]) {
    await assert.rejects(client(fetch).syncUserGames('u', { maxPages }), RangeError)
    await assert.rejects(collect(client(fetch).iterateUserGames('u', { maxPages })), RangeError)
  }
})

test('syncUserGames gives rest whenever maxPages stops it', async () => {
  const { fetch } = server({ ids: [6, 5, 4, 3, 2, 1] })
  const result = await client(fetch).syncUserGames('u', { after: 3, maxPages: 1 })
  assert.deepEqual(result.games.map((g) => g.gameId), [6, 5, 4])
  // Page 2 was never read, so whether 3 is next is unknown.
  assert.deepEqual(result.rest, { after: 3, maxPages: 1, before: 4, resumeNewestGameId: 6 })
  const more = await client(fetch).syncUserGames('u', result.rest)
  assert.deepEqual(more.games, [])
  assert.equal(more.rest, undefined)
  assert.equal(more.newestGameId, 6)
})

test('isGameFinished looks for the winner, not the row count', () => {
  assert.equal(isGameFinished([]), false)
  assert.equal(isGameFinished([row(1, { gameRank: 5 }), row(1, { gameRank: 2 })]), false)
  assert.equal(isGameFinished([row(1, { gameRank: 5 }), row(1, { gameRank: 1 })]), true)
})

test('getGame does not cache a game still being played', async () => {
  let finished = false
  const { state, fetch } = server({
    games: { 7: () => (finished ? [row(7, { gameRank: 1 }), row(7, { gameRank: 4 })] : [row(7, { gameRank: 4 })]) },
  })
  const er = client(fetch, { cache: new MemoryCache() })
  assert.equal((await er.getGame(7)).length, 1)
  finished = true
  assert.equal((await er.getGame(7)).length, 2)
  assert.equal((await er.getGame(7)).length, 2)
  assert.equal(state.calls.filter((c) => c === '/v1/games/7').length, 2)
})

test('request does not cache an unfinished game either', async () => {
  const { state, fetch } = server({ games: { 7: () => [row(7, { gameRank: 4 })] } })
  const er = client(fetch, { cache: new MemoryCache() })
  await er.request('/v1/games/7')
  await er.getGame(7)
  assert.equal(state.calls.length, 2)
})

test('getGame ignores an unfinished game left in a shared cache', async () => {
  const cache = new MemoryCache()
  cache.set('er:/v1/games/7', JSON.stringify({ code: 200, message: 'ok', userGames: [row(7, { gameRank: 4 })] }), 60_000)
  const { fetch } = server({ games: { 7: () => [row(7, { gameRank: 1 }), row(7, { gameRank: 4 })] } })
  assert.equal((await client(fetch, { cache }).getGame(7)).length, 2)
})

function watchClient(fetch, rounds, between) {
  let clock = 0
  let round = 0
  const controller = new AbortController()
  const er = new ErClient({
    apiKey: 'k',
    fetch,
    requestsPerSecond: 1000,
    burst: 1000,
    now: () => clock,
    sleep: async (ms) => {
      clock += ms
      // The limiter never sleeps at this rate, so a sleep is the pause between rounds.
      round++
      if (round >= rounds) controller.abort()
      else await between(round)
    },
  })
  return { er, signal: controller.signal, round: () => round }
}

test('watchGames reports only games played after it started, oldest first', async () => {
  const { state, fetch } = server({ ids: { a: [5, 4], b: [] }, pageSize: 3 })
  const { er, signal, round } = watchClient(fetch, 3, (r) => {
    if (r === 1) state.ids.a.push(6, 7)
    if (r === 2) state.ids.b.push(1)
  })
  const events = []
  for await (const e of er.watchGames({ uids: ['a', 'b'], signal, intervalMs: 1000 })) {
    events.push([round(), e.type, e.uid, e.game?.gameId])
  }
  assert.deepEqual(events, [
    [1, 'game', 'a', 6],
    [1, 'game', 'a', 7],
    [2, 'game', 'b', 1],
  ])
})

test('watchGames resumes from after and reads every page needed', async () => {
  const ids = Array.from({ length: 80 }, (_, i) => 100 - i)
  const { fetch } = server({ ids: { a: ids }, pageSize: 10 })
  const { er, signal } = watchClient(fetch, 1, () => {})
  const events = []
  for await (const e of er.watchGames({ uids: ['a'], signal, after: new Map([['a', 25]]) })) events.push(e.game.gameId)
  // Nothing skipped, even past many pages.
  assert.deepEqual(events, ids.filter((id) => id > 25).reverse())
})

test('watchGames reads after when a player is added later', async () => {
  const { state, fetch } = server({ ids: { a: [1], b: [5] } })
  const uids = ['a']
  const after = new Map()
  const { er, signal, round } = watchClient(fetch, 2, (r) => {
    if (r === 1) {
      // A bot adds b with the game it saw, then b finishes one before the round.
      after.set('b', 5)
      uids.push('b')
      state.ids.b.push(6)
    }
  })
  const events = []
  for await (const e of er.watchGames({ uids, signal, after })) events.push([round(), e.uid, e.game.gameId])
  assert.deepEqual(events, [[1, 'b', 6]])
})

test('watchGames reads a one-time iterator once', async () => {
  const { state, fetch } = server({ ids: { a: [1] } })
  const { er, signal } = watchClient(fetch, 2, (r) => {
    if (r === 1) state.ids.a.push(2)
  })
  const events = []
  for await (const e of er.watchGames({ uids: new Map([['a', true]]).keys(), signal })) events.push(e.game.gameId)
  assert.deepEqual(events, [2])
})

test('watchGames reports a failing uid list and keeps the last one', async () => {
  const { state, fetch } = server({ ids: { a: [1] } })
  let fail = false
  const { er, signal, round } = watchClient(fetch, 2, (r) => {
    if (r === 1) {
      fail = true
      state.ids.a.push(2)
    }
  })
  const events = []
  const uids = () => {
    if (fail) throw new Error('db down')
    return ['a']
  }
  for await (const e of er.watchGames({ uids, signal })) events.push([round(), e.type, e.uid, e.game?.gameId])
  assert.deepEqual(events, [[1, 'error', null, undefined], [1, 'game', 'a', 2]])
})

test('watchGames waits between rounds even with nothing to watch', async () => {
  const { fetch } = server()
  const { er, signal, round } = watchClient(fetch, 3, () => {})
  const events = await collect(er.watchGames({ uids: [], signal, intervalMs: 1 }))
  assert.deepEqual(events, [])
  assert.equal(round(), 3)
})

test('watchGames reports an error and keeps watching', async () => {
  const { state, fetch } = server({ ids: { a: [1], b: [1] } })
  state.fail.add('a')
  const { er, signal, round } = watchClient(fetch, 3, (r) => {
    if (r === 1) state.ids.b.push(2)
    if (r === 2) state.fail.delete('a')
  })
  const events = []
  for await (const e of er.watchGames({ uids: ['a', 'b'], signal })) {
    events.push([round(), e.type, e.uid, e.game?.gameId])
  }
  assert.deepEqual(events, [
    [0, 'error', 'a', undefined],
    [1, 'error', 'a', undefined],
    [1, 'game', 'b', 2],
  ])
})

test('watchGames reads the uid list every round and forgets removed players', async () => {
  const { state, fetch } = server({ ids: { a: [1], b: [1] } })
  let uids = ['a']
  const { er, signal, round } = watchClient(fetch, 4, (r) => {
    if (r === 1) {
      uids = ['b']
      state.ids.a.push(2)
    }
    if (r === 2) uids = ['a', 'b']
    if (r === 3) state.ids.a.push(3)
  })
  const events = []
  for await (const e of er.watchGames({ uids: () => uids, signal })) events.push([round(), e.uid, e.game.gameId])
  // Game 2 was played while `a` was not watched, so it is not reported.
  assert.deepEqual(events, [[3, 'a', 3]])
})

test('watchGames skips the cache', async () => {
  const { state, fetch } = server({ ids: { a: [1] } })
  const cache = new MemoryCache()
  let clock = 0
  let rounds = 0
  const controller = new AbortController()
  const er = new ErClient({
    apiKey: 'k',
    fetch,
    cache,
    requestsPerSecond: 1000,
    burst: 1000,
    now: () => clock,
    sleep: async (ms) => {
      clock += ms
      if (++rounds === 1) state.ids.a.push(2)
      else controller.abort()
    },
  })
  await er.getUserGames('a')
  const events = []
  for await (const e of er.watchGames({ uids: ['a'], signal: controller.signal, intervalMs: 10 })) events.push(e.game.gameId)
  assert.deepEqual(events, [2])
})

test('watchGames ends at once when the signal is already aborted', async () => {
  const { state, fetch } = server({ ids: { a: [1] } })
  const controller = new AbortController()
  controller.abort()
  const events = await collect(client(fetch).watchGames({ uids: ['a'], signal: controller.signal }))
  assert.deepEqual(events, [])
  assert.deepEqual(state.calls, [])
})

test('watchGames checks its options', async () => {
  const { fetch } = server()
  for (const intervalMs of [-1, 0, Infinity, NaN]) {
    await assert.rejects(collect(client(fetch).watchGames({ uids: [], intervalMs })), RangeError)
  }
  await assert.rejects(collect(client(fetch).watchGames({ uids: 'uid' })), TypeError)
})

test('watchGames stops partway through a player without reporting', async () => {
  const ids = Array.from({ length: 30 }, (_, i) => 100 - i)
  const { state, fetch } = server({ ids: { a: ids }, pageSize: 10 })
  const controller = new AbortController()
  const er = client(async (url, init) => {
    // Abort while the second page is loading.
    if (String(url).includes('next=')) controller.abort()
    return fetch(url, init)
  })
  const events = await collect(er.watchGames({ uids: ['a'], signal: controller.signal, after: { a: 70 } }))
  assert.deepEqual(events, [])
  assert.equal(state.calls.length, 2)
})

test('watchGames treats a string from the uid function as an error', async () => {
  const { state, fetch } = server({ ids: { a: [1] } })
  let bad = false
  const { er, signal, round } = watchClient(fetch, 2, (r) => {
    if (r === 1) {
      bad = true
      state.ids.a.push(2)
    }
  })
  const events = []
  for await (const e of er.watchGames({ uids: () => (bad ? 'a' : ['a']), signal })) events.push([round(), e.type, e.uid])
  assert.deepEqual(events, [[1, 'error', null], [1, 'game', 'a']])
})

test('getUserGames fresh skips the cache', async () => {
  const { state, fetch } = server({ ids: [2, 1] })
  const er = client(fetch, { cache: new MemoryCache() })
  await er.getUserGames('u')
  await er.getUserGames('u')
  await er.getUserGames('u', undefined, { fresh: true })
  assert.equal(state.calls.length, 2)
})

test('syncUserGames reads the first page fresh even with a cache', async () => {
  const { state, fetch } = server({ ids: [2, 1] })
  const er = client(fetch, { cache: new MemoryCache() })
  await er.getUserGames('u')
  state.ids.push(3)
  assert.deepEqual((await er.syncUserGames('u', { after: 2 })).games.map((g) => g.gameId), [3])
})

test('requests do not follow redirects', async () => {
  const inits = []
  const er = client(async (url, init) => {
    inits.push(init)
    return new Response(null, { status: 302, headers: { location: 'https://evil.example/x' } })
  })
  await assert.rejects(er.request('/v1/x'), (e) => e.status === 302)
  assert.equal(inits[0].redirect, 'manual')
})

test('Retry-After is honoured up to a minute', async () => {
  let n = 0
  const sleeps = []
  const er = new ErClient({
    apiKey: 'k',
    requestsPerSecond: 1000,
    burst: 1000,
    sleep: async (ms) => { sleeps.push(ms) },
    fetch: async () => {
      n++
      if (n === 1) return new Response('{"code":429,"message":"x"}', { status: 429, headers: { 'retry-after': '5' } })
      if (n === 2) return new Response('{"code":429,"message":"x"}', { status: 429, headers: { 'retry-after': '3600' } })
      return json({ code: 200, message: 'ok' })
    },
  })
  await er.request('/v1/x')
  assert.deepEqual(sleeps, [5000, 60000])
})

test('cache keys include a custom base URL', async () => {
  const cache = new MemoryCache()
  const calls = []
  const fetch = async (url) => {
    calls.push(url)
    return json({ code: 200, message: 'ok', topRanks: [] })
  }
  await client(fetch, { cache }).getTopRanks(41)
  await client(fetch, { cache, baseUrl: 'https://test.example' }).getTopRanks(41)
  assert.equal(calls.length, 2)
})

test('getSeasons skips the response cache', async () => {
  let clock = 0
  const calls = []
  const er = new ErClient({
    apiKey: 'k',
    now: () => clock,
    cache: new MemoryCache({ now: () => clock }),
    fetch: async (url) => {
      calls.push(url)
      return json({ code: 200, message: 'ok', data: [{ seasonID: 41, seasonName: 'Season21', isCurrent: 1 }] })
    },
  })
  await er.getSeasons()
  clock += 5 * 60_000 + 1
  await er.getSeasons()
  assert.equal(calls.length, 2)
})
