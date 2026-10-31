import { test } from 'node:test'
import assert from 'node:assert/strict'
import { rankTier, buildGameNames, parseL10n } from '../dist/index.js'

const name = (rp, options) => rankTier(rp, options).name

test('rankTier: divisions and boundaries (season 12)', () => {
  assert.equal(name(0), 'Unranked')
  assert.equal(name(1), 'Iron 4')
  assert.equal(name(149), 'Iron 4')
  assert.equal(name(150), 'Iron 3')
  assert.equal(name(6399), 'Diamond 1')
  assert.equal(name(6400), 'Meteorite 4')
  assert.deepEqual(rankTier(7599), { tier: 'meteorite', division: 1, name: 'Meteorite 1', minRp: 7300, maxRp: 7599 })
  assert.equal(name(7600), 'Mythril')
})

test('rankTier: season 12 leaderboard needs 8300 RP and a rank', () => {
  assert.equal(name(8299, { rank: 1 }), 'Mythril')
  assert.equal(name(8300, { rank: 300 }), 'Immortal')
  assert.equal(name(8300, { rank: 301 }), 'Titan')
  assert.equal(name(8300, { rank: 1001 }), 'Mythril')
  assert.equal(name(9000), 'Mythril')
  assert.equal(rankTier(9000, { rank: 5 }).minRp, 8300)
})

test('rankTier: older seasons', () => {
  assert.equal(name(7600, { season: 11 }), 'Mythril')
  assert.equal(name(7600, { season: 11, rank: 1000 }), 'Titan')
  assert.equal(name(7300, { season: 10 }), 'Meteorite 1')
  assert.equal(name(6400, { season: 5 }), 'Meteorite')
  assert.equal(name(6799, { season: 4 }), 'Diamond 1')
  assert.equal(name(999, { season: 2 }), 'Unranked')
  assert.equal(name(1000, { season: 1 }), 'Bronze 4')
  assert.equal(name(7100, { season: 8 }), 'Mythril')
  assert.equal(name(7000, { season: 99 }), 'Meteorite 2')
  assert.equal(name(7000, { season: null }), 'Meteorite 2')
  assert.equal(name(7000, { season: NaN }), 'Meteorite 2')
  assert.equal(name(6400, { season: 7.5 }), 'Meteorite')
})

test('rankTier: odd RP values', () => {
  assert.equal(name(149.5), 'Iron 4')
  assert.equal(name(0.5), 'Unranked')
  assert.equal(name(-10), 'Unranked')
  assert.equal(name(NaN), 'Unranked')
  assert.equal(name(8300.9, { rank: 1 }), 'Immortal')
})

test('GameNames.tier reads the official names', () => {
  const l10n = parseL10n('GOLD┃골드\nUNRANK┃언랭크\n')
  const names = buildGameNames(l10n, [], [])
  assert.equal(names.tier(rankTier(2700).tier), '골드')
  assert.equal(names.tier('unranked'), '언랭크')
  assert.equal(names.tier('iron'), null)
})
