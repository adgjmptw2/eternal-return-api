import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildGameData, itemGradeOf } from '../dist/index.js'
import { createSampleClient, SAMPLE_NICKNAME } from '../dist/testing.js'

const mastery = [{ code: 1, weapon1: 'OneHandSword', weapon2: 'TwoHandSword', weapon3: 'None', weapon4: 'None' }]
const weapons = [{ code: 101104, itemType: 'Weapon', weaponType: 'OneHandSword', itemGrade: 'Common', isCompletedItem: false, makeMaterial1: 0, makeMaterial2: 0 }]
const armors = [{ code: 202503, itemType: 'Armor', armorType: 'Chest', itemGrade: 'Legend', isCompletedItem: true, makeMaterial1: 202405, makeMaterial2: 401103 }]

test('buildGameData joins weapons and items', () => {
  const data = buildGameData(mastery, weapons, armors)
  assert.deepEqual(data.weaponsOf(1), ['OneHandSword', 'TwoHandSword'])
  assert.deepEqual(data.weaponsOf(999), [])
  assert.deepEqual(data.weaponsOf(null), [])
  assert.equal(data.item(101104).slot, 'weapon')
  assert.equal(data.item(101104).materials, null)
  assert.deepEqual(data.item(202503), {
    code: 202503, slot: 'chest', grade: 'Legend', weaponType: null, completed: true, materials: [202405, 401103],
  })
  assert.equal(data.item(302102), null)
  const equip = data.equipment({ equipment: { 0: 101104, 1: 202503, 2: 999 } })
  assert.deepEqual(Object.keys(equip), ['weapon', 'chest'])
  assert.deepEqual(Object.keys(data.equipment({ equipment: [101104, 202503] })), ['weapon', 'chest'])
  assert.deepEqual(data.equipment({}), {})
})

test('itemGradeOf', () => {
  assert.equal(itemGradeOf(1), 'Common')
  assert.equal(itemGradeOf(6), 'Mythic')
  assert.equal(itemGradeOf(0), null)
  assert.equal(itemGradeOf(7), null)
  assert.equal(itemGradeOf(undefined), null)
})

test('sample game: every equipped item is known, grades match', async () => {
  const er = createSampleClient()
  const data = await er.getGameData()
  assert.equal(await er.getGameData(), data)
  const names = await er.getNames('English')
  const user = await er.getUserByNickname(SAMPLE_NICKNAME)
  const { games } = await er.getUserGames(user.uid)
  for (const p of await er.getGame(games[0].gameId)) {
    const weapons = data.weaponsOf(p.characterNum)
    assert.ok(weapons.length > 0)
    assert.ok(weapons.every((w) => names.weaponType(w)))
    for (const [key, code] of Object.entries(p.equipment)) {
      const info = data.item(code)
      assert.ok(info, `item ${code}`)
      assert.equal(info.grade, itemGradeOf(p.equipmentGrade[key]))
    }
    if (p.equipment[0]) assert.ok(weapons.includes(data.item(p.equipment[0]).weaponType))
  }
})
