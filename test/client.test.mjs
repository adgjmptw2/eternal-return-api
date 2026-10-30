import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  ErClient,
  ErApiError,
  ErNicknameMismatchError,
  SeasonCatalog,
  parseL10n,
  characterNames,
  toPlayerSeason,
  gameModeName,
  RateLimiter,
  summarizeGames,
} from '../dist/index.js'

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

/** routes: { [pathAndQuery]: Response | (() => Response) } */
function fakeClient(routes, extra = {}) {
  const calls = []
  const sleeps = []
  const client = new ErClient({
    apiKey: 'test-key',
    sleep: async (ms) => { sleeps.push(ms) },
    fetch: async (url, init) => {
      const u = new URL(url)
      const key = u.host === 'open-api.bser.io' ? u.pathname + u.search : url
      calls.push({ key, headers: init?.headers })
      const route = routes[key]
      if (!route) return json({ code: 404, message: 'Not Found' }, 404)
      return typeof route === 'function' ? route() : route
    },
    ...extra,
  })
  return { client, calls, sleeps }
}

test('sends the api key and returns the envelope', async () => {
  const { client, calls } = fakeClient({ '/v1/x': json({ code: 200, message: 'Success', a: 1 }) })
  const body = await client.request('/v1/x')
  assert.equal(body.a, 1)
  assert.equal(calls[0].headers['x-api-key'], 'test-key')
})

test('HTTP 200 with an error code in the body throws', async () => {
  const { client } = fakeClient({ '/v1/x': json({ code: 403, message: 'Forbidden' }) })
  await assert.rejects(client.request('/v1/x'), (e) => e instanceof ErApiError && e.status === 403)
})

test('retries 429 with the configured delays, then gives up', async () => {
  let n = 0
  const { client, sleeps } = fakeClient({
    '/v1/x': () => (++n < 3 ? json({ code: 429, message: 'Too Many' }, 429) : json({ code: 200, message: 'ok' })),
  })
  await client.request('/v1/x')
  assert.equal(n, 3)
  assert.ok(sleeps.includes(1500) && sleeps.includes(3000))

  n = -10
  await assert.rejects(client.request('/v1/x'), (e) => e.status === 429)
})

test('does not retry other errors', async () => {
  let n = 0
  const { client } = fakeClient({ '/v1/x': () => { n++; return json({ code: 500, message: 'x' }, 500) } })
  await assert.rejects(client.request('/v1/x'))
  assert.equal(n, 1)
})

test('nickname lookup reads userId (v11) as uid', async () => {
  const { client } = fakeClient({
    '/v1/user/nickname?query=%EB%B9%84%EC%95%99%EC%B9%B4': json({
      code: 200, message: 'Success', user: { userId: 'abc', nickname: '비앙카' },
    }),
  })
  assert.deepEqual(await client.getUserByNickname('비앙카'), { uid: 'abc', nickname: '비앙카' })
})

test('nickname lookup ignores case and width, rejects other players', async () => {
  const { client } = fakeClient({
    '/v1/user/nickname?query=abc': json({ code: 200, message: 'ok', user: { uid: 'u1', nickname: 'ＡＢＣ' } }),
    '/v1/user/nickname?query=zzz': json({ code: 200, message: 'ok', user: { uid: 'u2', nickname: 'other' } }),
  })
  assert.equal((await client.getUserByNickname('abc')).uid, 'u1')
  await assert.rejects(client.getUserByNickname('zzz'), ErNicknameMismatchError)
})

test('missing player is null, not an error', async () => {
  const { client } = fakeClient({})
  assert.equal(await client.getUserByNickname('nobody'), null)
  assert.deepEqual(await client.getGame(1), [])
  assert.equal(await client.getUserRank('u', 33), null)
})

test('iterateUserGames follows next and stops at since', async () => {
  const g = (id, day) => ({ gameId: id, startDtm: `2026-10-${day}T10:00:00.000+0900` })
  const { client, calls } = fakeClient({
    '/v1/user/games/uid/u1': json({ code: 200, message: 'ok', userGames: [g(30, 29), g(29, 28)], next: 29 }),
    '/v1/user/games/uid/u1?next=29': json({ code: 200, message: 'ok', userGames: [g(28, 20), g(27, 10)], next: 27 }),
  })
  const ids = []
  for await (const game of client.iterateUserGames('u1', { since: new Date('2026-10-15T00:00:00Z') })) {
    ids.push(game.gameId)
  }
  assert.deepEqual(ids, [30, 29, 28])
  assert.equal(calls.length, 2)
})

test('iterateUserGames respects maxPages', async () => {
  const { client, calls } = fakeClient({
    '/v1/user/games/uid/u1': json({ code: 200, message: 'ok', userGames: [{ gameId: 2, startDtm: '2026-10-29T00:00:00Z' }], next: 1 }),
  })
  const games = []
  for await (const game of client.iterateUserGames('u1', { maxPages: 1 })) games.push(game)
  assert.equal(games.length, 1)
  assert.equal(calls.length, 1)
})

test('season table is cached and shared by concurrent callers', async () => {
  const rows = [
    { seasonID: 31, seasonName: 'Season19', isCurrent: 0 },
    { seasonID: 32, seasonName: 'Pre-Season20', isCurrent: 0 },
    { seasonID: 33, seasonName: 'Season20', isCurrent: 1 },
  ]
  const { client, calls } = fakeClient({ '/v2/data/Season': json({ code: 200, message: 'ok', data: rows }) })
  const [a, b] = await Promise.all([client.getSeasons(), client.getSeasons()])
  await client.getSeasons()
  assert.equal(calls.length, 1)
  assert.equal(a.currentRankedSeasonId, 33)
  assert.equal(b.playerSeasonOf(33), 11)
  assert.equal(a.seasonIdOf(10), 31)
})

test('pre-season as current falls back to the last ranked season', () => {
  const catalog = new SeasonCatalog([
    { seasonID: 33, seasonName: 'Season20', isCurrent: 0 },
    { seasonID: 34, seasonName: 'Pre-Season21', isCurrent: 1 },
  ])
  assert.equal(catalog.current.seasonID, 34)
  assert.equal(catalog.currentRankedSeasonId, 33)
  assert.equal(catalog.playerSeasonOf(34), 12)
  assert.equal(catalog.seasonIdOf(12), null)
})

test('season numbering', () => {
  assert.equal(toPlayerSeason(20), 11)
  assert.equal(toPlayerSeason(10), 1)
  assert.equal(toPlayerSeason(9), 9)
})

test('l10n file is parsed and downloaded once', async () => {
  const file = 'Character/Name/1┃재키\r\nCharacter/Name/2┃아야\nItem/Name/101┃단검\nbroken line\n'
  const { client, calls } = fakeClient({
    '/v1/l10n/Korean': json({ code: 200, message: 'ok', data: { l10Path: 'https://cdn.example/ko.txt' } }),
    'https://cdn.example/ko.txt': new Response(file),
  })
  const names = await client.getCharacterNames('Korean')
  await client.getL10n('Korean')
  assert.deepEqual([...names], [[1, '재키'], [2, '아야']])
  assert.equal(calls.length, 2)
  assert.equal(calls[1].headers, undefined)
})

test('parseL10n keeps separators inside values', () => {
  const map = parseL10n('a┃x┃y\n')
  assert.equal(map.get('a'), 'x┃y')
  assert.equal(characterNames(map).size, 0)
})

test('game mode names', () => {
  assert.equal(gameModeName(3), 'rank')
  assert.equal(gameModeName(4), 'cobalt')
  assert.equal(gameModeName(6), 'cobalt')
  assert.equal(gameModeName(99), 'unknown')
})

test('rate limiter spaces requests by the interval', async () => {
  let clock = 0
  const waits = []
  const limiter = new RateLimiter(1000, 1, () => clock, async (ms) => { waits.push(ms); clock += ms })
  await Promise.all([limiter.acquire(), limiter.acquire(), limiter.acquire()])
  assert.deepEqual(waits, [1000, 1000])
})

test('timeout becomes ErApiError 504', async () => {
  const client = new ErClient({
    apiKey: 'k',
    timeoutMs: 20,
    fetch: (url, init) => new Promise((_, reject) => {
      init.signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })))
    }),
  })
  await assert.rejects(client.request('/v1/x'), (e) => e instanceof ErApiError && e.status === 504)
})

test('limiter does not let two requests through 1ms apart at the start', async () => {
  let clock = 0
  const waits = []
  const limiter = new RateLimiter(1000, 1, () => clock, async (ms) => { waits.push(ms); clock += ms })
  clock = 999
  await limiter.acquire()
  clock = 1000
  await limiter.acquire()
  assert.deepEqual(waits, [999])
})

test('HTTP status wins over the body code', async () => {
  let n = 0
  const { client } = fakeClient({
    '/v1/a': () => { n++; return json({ code: 500, message: 'x' }, 429) },
    '/v1/games/1': json({ code: 404, message: 'x' }, 500),
  })
  await assert.rejects(client.request('/v1/a'), (e) => e.status === 429 && e.apiCode === 500)
  assert.equal(n, 3)
  await assert.rejects(client.getGame(1), (e) => e.status === 500)
})

test('repeated paging cursor stops with an error', async () => {
  const g = { gameId: 1, startDtm: '2026-10-29T00:00:00Z' }
  const { client } = fakeClient({
    '/v1/user/games/uid/u': json({ code: 200, message: 'ok', userGames: [g], next: 5 }),
    '/v1/user/games/uid/u?next=5': json({ code: 200, message: 'ok', userGames: [g], next: 6 }),
    '/v1/user/games/uid/u?next=6': json({ code: 200, message: 'ok', userGames: [g], next: 5 }),
  })
  const run = async () => { for await (const _ of client.iterateUserGames('u')) { /* drain */ } }
  await assert.rejects(run(), /cursor repeated/)
})

test('paths that could leave the API host are refused', async () => {
  const { client, calls } = fakeClient({})
  await assert.rejects(client.request('.evil.example/x'), TypeError)
  await assert.rejects(client.request('//evil.example/x'), TypeError)
  assert.equal(calls.length, 0)
})

test('timeout also covers reading the body', async () => {
  const client = new ErClient({
    apiKey: 'k',
    timeoutMs: 20,
    fetch: async (url, init) => ({
      ok: true,
      status: 200,
      text: () => new Promise((_, reject) => {
        init.signal.addEventListener('abort', () => reject(new Error('stream aborted')))
      }),
    }),
  })
  await assert.rejects(client.request('/v1/x'), (e) => e instanceof ErApiError && e.status === 504)
})

test('getNames resolves every kind of code, loading tables once', async () => {
  const file = [
    'Character/Name/1┃재키', 'Item/Name/101101┃가위', 'Trait/Name/7000201┃<color=yellow>벽력</color>',
    'WeaponType/Glove┃글러브', 'Skill/Group/Name/4000000┃블링크', 'Skill/Group/Name/4511000┃블레싱: 명상',
  ].join('\n')
  const { client, calls } = fakeClient({
    '/v1/l10n/Korean': json({ code: 200, message: 'ok', data: { l10Path: 'https://cdn.example/ko.txt' } }),
    'https://cdn.example/ko.txt': () => new Response(file),
    '/v2/data/TacticalSkillSetGroup': json({ code: 200, message: 'ok', data: [
      { group: 30, startCode: 31, icon: 'VSkillIcon_4000000' },
      { group: 500010, startCode: 500011, icon: 'VSkillIcon_4511000' },
    ] }),
    '/v2/data/TacticalSkillSet': json({ code: 200, message: 'ok', data: [
      { code: 31, skillCode: 4000001 },
      { code: 500011, skillCode: '4501001, 4501011' },
    ] }),
  })
  const [names] = await Promise.all([client.getNames('Korean'), client.getNames('Korean')])
  assert.equal(names.character(1), '재키')
  assert.equal(names.item(101101), '가위')
  assert.equal(names.trait(7000201), '벽력')
  assert.equal(names.weapon(1), '글러브')
  assert.equal(names.weapon(12), null)
  assert.equal(names.tacticalSkill(30), '블링크')
  assert.equal(names.tacticalSkill(500010), '블레싱: 명상')
  assert.equal(names.item(999), null)
  assert.equal(calls.length, 4)
})

test('summarizeGames counts per character, most played first', () => {
  const g = (characterNum, gameRank, victory, playerKill, damageToPlayer) =>
    ({ characterNum, gameRank, victory, playerKill, playerAssistant: 1, damageToPlayer })
  const s = summarizeGames([g(2, 1, 1, 5, 10000), g(1, 4, 0, 1, undefined), g(2, 3, 0, 2, 20000), g(2, 0, 0, 0, undefined)])
  assert.equal(s.overall.games, 4)
  assert.equal(s.overall.wins, 1)
  assert.equal(s.overall.top3, 2)
  assert.equal(s.overall.averageRank, (1 + 4 + 3) / 3)
  assert.equal(s.overall.averageKills, 2)
  assert.equal(s.overall.averageDamage, 15000)
  assert.deepEqual(s.characters.map((c) => [c.characterNum, c.games]), [[2, 3], [1, 1]])
  assert.equal(s.characters[1].averageDamage, null)
  assert.equal(summarizeGames([]).overall.winRate, 0)
})
