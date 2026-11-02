# 이터널 리턴 Open API 게임 데이터 표

`/v2/data/{이름}`으로 받는 표마다 무엇이 들어 있는지, 표끼리 어떻게 이어지는지, 경기 기록과 어떻게 이어지는지 정리했습니다. 2026년 11월 2일(시즌 12)에 표 전체로 확인했습니다.

[English](https://github.com/adgjmptw2/eternal-return-api/blob/main/DATA.md) · [실전 가이드](GUIDE.ko.md)

- `/v2/data/hash`는 표 이름마다 숫자 하나를 붙여 모든 표를 알려 줍니다. 이날 기준 44개입니다.
- 행은 `data`에 들어 있습니다. 필드 이름은 API가 보내는 그대로 적었습니다.
- 표의 용도는 필드 이름, 공식 번역 파일, 아래 연결 관계를 바탕으로 정리했습니다. 연결 개수는 모든 행을 확인한 결과이고, 100%가 아니면 확인된 개수를 적었습니다.
- 이름은 표가 아니라 번역 파일(`/v1/l10n/{language}`)에 있습니다. 표마다 번역 키를 적었습니다.

## 경기 기록에서 표로

| 경기 기록 필드 | 표 | 확인 |
|---|---|---|
| `characterNum` | `Character.code` | 45행 중 45 |
| `skinCode` | `CharacterSkin.code`. 그 행의 `characterCode`가 `characterNum`과 같음 | 45행 중 45 |
| `equipment` 값 | `ItemWeapon.code`, `ItemArmor.code` | 45행의 모든 아이템 |
| `bestWeapon` | 무기 종류 번호. 패키지의 `WEAPON_TYPES`가 `WeaponTypeInfo.type`에 쓰는 이름을 알려 줌 | 45행 중 45 |
| `traitFirstCore`, `traitFirstSub`, `traitSecondSub` | `Trait.code` | 코드 225개 중 225 |
| `tacticalSkillGroup` | `TacticalSkillSetGroup.group` | 45행 중 45 |
| `seasonId` | `Season.seasonID` | 랭크 경기 |

개수는 2026년 11월에 실제 랭크 경기 2판(45행)으로 센 것입니다.

## 표 안의 모드 번호

데이터 표의 `modeType`(또는 `mode`)은 경기 기록의 `matchingMode`와 번호가 다릅니다. 코발트 프로토콜 지역은 `4`, 루미아 섬 지역은 `1,2,3,5,6`입니다. 대부분의 행(853개)은 `0`입니다. `1,5`와 `2,3,6`으로 나뉜 행도 있는데, 이 구분이 무엇인지는 확인하지 않았습니다. 값은 숫자이거나 쉼표로 이은 문자열입니다.

## 실험체

| 표 | 행 | 내용 | 연결 |
|---|---|---|---|
| `Character` | 91 | 실험체 기본 능력치: `maxHp`, `attackPower`, `defense`, `attackSpeed`, `moveSpeed`, `hpRegen`. 역할(`charArcheType1`, `charArcheType2`)과 근거리·원거리(`weaponRangeType`)도 있음. | 이름: `Character/Name/{code}` |
| `CharacterLevelUpStat` | 91 | 레벨당 오르는 능력치. 코드와 필드가 `Character`와 같음. | `code` = `Character.code` |
| `CharacterExp` | 20 | 게임 안 레벨 1~20에 필요한 경험치. 20레벨은 0. | |
| `CharacterMastery` | 91 | 실험체가 쓸 수 있는 무기 종류(`weapon1`~`weapon4`, 없으면 `None`). 패키지의 `getGameData()`가 이 표를 읽음. | `code` = `Character.code`, 무기 = `WeaponTypeInfo.type` |
| `CharacterAttributes` | 119 | 실험체·무기별 1~5 평가: `controlDifficulty`, `attack`, `defense`, `disruptor`, `move`, `assistance`. | `characterCode` = `Character.code`, `mastery` = `WeaponTypeInfo.type` |
| `CharacterModeModifier` | 211 | 실험체·무기별, 모드별 보정 퍼센트: 주는 피해·받는 피해, 회복, 보호막, 궁극기 쿨다운. 앞에 `solo`, `duo`, `squad`, `cobalt`가 붙음. `squad` 값은 모두 100(추가 피해 항목은 0). | `characterCode` = `Character.code` |
| `CharacterSkin` | 419 | 스킨: `characterCode`, `grade`, `purchaseType`, 리소스 경로. 실험체마다 `index` 0인 스킨이 하나씩 있고, 이름이 실험체 이름과 같음. | `characterCode` = `Character.code`, 이름: `Skin/Name/{code}` |
| `RecommendedList` | 120 | 실험체·무기별 코발트 프로토콜 설정: 추천 전술 스킬(`cobaltRecommendTacticalSkill`), 무기 선택 가능 여부. | `cobaltRecommendTacticalSkill` = `TacticalSkillSetGroup.group`(12개 중 12) |

## 무기·생존 숙련도

| 표 | 행 | 내용 | 연결 |
|---|---|---|---|
| `WeaponTypeInfo` | 23 | 무기 종류별 기본 `attackSpeed`, `attackRange`. | 이름: `WeaponType/{type}` |
| `MasteryLevel` | 560 | 숙련도 레벨(1~20)별 경험치. 무기 23종과 `Craft`, `Defense`, `Hunt`, `Move`, `Search`까지 28종. | 이름: `MasteryType/{type}` |
| `MasteryExp` | 77 | 행동별 숙련도 경험치. 예: `CraftWeapon`, `AttackDamageToPlayer`. 아이템 등급별로 다름. | |
| `MasteryStat` | 124 | 실험체·숙련도 종류별로 오르는 능력치. 각각 네 구간. | `characterCode` = `Character.code` |

## 아이템

아이템 표 다섯 개는 코드가 서로 겹치지 않아서, 아이템 코드 하나는 한 표에만 있습니다. 이름: `Item/Name/{code}`.

| 표 | 행 | 내용 | 연결 |
|---|---|---|---|
| `ItemWeapon` | 418 | 무기: `weaponType`, `itemGrade`, 능력치, 재료(`makeMaterial1`, `makeMaterial2`). | 재료는 아이템 코드(216개 중 216) |
| `ItemArmor` | 254 | 방어구: `armorType`(`Head`, `Chest`, `Arm`, `Leg`), 등급, 능력치, 재료. | 재료는 아이템 코드(112개 중 112) |
| `ItemConsumable` | 54 | 음식 등 소모품: `consumableType`, `hpRecover`. | 재료는 아이템 코드 |
| `ItemMisc` | 62 | 제작 재료. | 재료는 아이템 코드 |
| `ItemSpecial` | 22 | 카메라, 드론 같은 특수 아이템: `specialItemType`, `summonCode`. | `summonCode` = `SummonObjectStat.code`(7개 중 7) |
| `ItemSearchOptionV2` | 672 | 아이템별 검색 태그 최대 3개. 예: `Main_Attack`, `Sub1_AttackSpeed`. | 672개 중 671개가 무기·방어구·소모품 코드 |
| `BulletCapacity` | 53 | 총기별 탄창 수와 장전 시간. | 53개 중 52개가 `ItemWeapon` 코드 |
| `RandomEquipment` | 796 | `group`(부위나 무기 종류, 일부는 `RANDOM`으로 시작)과 등급별 아이템 목록. | `itemcode` = 아이템 코드(434개 중 434) |

`itemGrade`는 `Legend` 같은 문자열이고, `ItemGrade/{itemGrade}`로 이름을 찾습니다. 경기 기록은 등급을 숫자로 줍니다. 실전 가이드를 보세요.

## 지도와 채집

| 표 | 행 | 내용 | 연결 |
|---|---|---|---|
| `Area` | 33 | 지역: `areaType`(`Lumia` 20개, `Cobalt` 4개 등), 시작 지역, 하이퍼루프. | 이름: `Area/Name/{name}`. `code`가 아니라 `name`으로 찾음 |
| `NearByArea` | 86 | 서로 붙어 있는 지역 쌍. | 두 열 모두 `Area.code` |
| `ItemSpawn` | 1,418 | 지역마다 처음에 놓이는 아이템과 개수. | `areaCode` = `Area.code`, `itemCode` = 아이템 코드 |
| `Collectible` | 14 | 물, 나무, 돌, 물고기 같은 채집 지점(`castingActionType` 기준 12종): 아이템, 쿨다운, 개수. | 아이템 코드(14개 중 14) |
| `NaviCollectAndHunt` | 12 | 채집 아이템이 나오는 지역 목록. | `areaCodeList` = `Area.code`, `itemCode` = 아이템 코드 |
| `ActionCost` | 60 | 휴식, 상자 열기, 채집, 제작 같은 행동에 걸리는 시간(`time1`, `time2`). | |

지역 이름은 `code`가 아니라 `name`으로 찾아야 합니다. `Area/Name/Harbor`는 항구인데, 항구의 `code`가 10이어도 `Area/Name/10`은 양궁장입니다.

## 야생동물과 드롭

| 표 | 행 | 내용 | 연결 |
|---|---|---|---|
| `Monster` | 74 | 야생동물과 보스(`Chicken`, `Bear`, `Wickline`, `Alpha`, `Omega`, `Gamma` 등): 능력치, 낮·밤 등장, 재등장 시간. 한 `code`에 모드별로 여러 행이 있을 수 있음. | 이름: `Monster/Name/{code}`(74개 중 72) |
| `MonsterLevelUpStat` | 73 | 야생동물 레벨당 오르는 능력치. | `code` = `Monster.code` |
| `MonsterSpawnLevel` | 920 | 플레이어 레벨에 따른 야생동물 레벨. | `monsterCode` = `Monster.code` |
| `MonsterDropGroup` | 674 | 야생동물·레벨별 드롭 그룹. | `monsterCode` = `Monster.code`. `dropGroup`은 51개 중 34개만 `DropGroup.groupCode`에 있음 |
| `DropGroup` | 259 | 드롭 그룹별 아이템, 확률, 개수. `dropType`에 `Random`, `Exclusive`, `PityProbability` 등이 있음. | `itemCode` = 아이템 코드(39개 중 39) |
| `SummonObjectStat` | 155 | 카메라, 드론, 덫 같은 설치물의 능력치. `name`은 한국어. | |

`MonsterDropGroup`이 쓰는 드롭 그룹 17개(예: `3001`~`3006`)는 `DropGroup`에 행이 없습니다.

## 특성, 전술 스킬, 코발트 프로토콜

| 표 | 행 | 내용 | 연결 |
|---|---|---|---|
| `Trait` | 148 | 특성: `traitGroup`(`Havoc`, `Fortification`, `Support`, `Chaos`, `Cobalt`), `traitType`(`Core`, `Sub1`, `Sub2`, `Cobalt`). 92행이 코발트 프로토콜용. | 이름: `Trait/Name/{code}` |
| `TacticalSkillSetGroup` | 43 | 전술 스킬 묶음. `group`이 경기 기록의 `tacticalSkillGroup`. | `startCode` = `TacticalSkillSet.code`(43개 중 43) |
| `TacticalSkillSet` | 78 | 강화 단계별 행: `nextUpgradeCode`, `upgradeCredit`, `skillCode`. | 이름: 실전 가이드의 전술 스킬 찾기 참고 |
| `InfusionProduct` | 110 | 코발트 프로토콜 인퓨전: 종류(`Trait`, `TacticalSkill`, `Item` 등), 가격, 재고. | `productType`에 따라 `productCode` = `Trait.code`(81개 중 81), 전술 스킬 코드(21개 중 21), 아이템 코드(3개 중 3) |

## 크레딧, 경험치, 점수

| 표 | 행 | 내용 |
|---|---|---|
| `VFCredit` | 179 | 처치, 페이즈 시작 등으로 얻는 크레딧: `conditionType`, `acquireSelf`, `acquireTeam`. |
| `GainExp` | 9 | 시간 구간(0~900초)별로 얻는 경험치. |
| `GainScore` | 14 | 페이즈·조건별 점수. 예: `Kill`, `DeadByMonster`. |
| `BattleZoneReward` | 15 | 전투 구역 보상(아이템 코드). |
| `Level` | 600 | 레벨 1~600에 필요한 경험치와 보상(`rewardAcoin`, `reward`). |

## 문구와 시즌

| 표 | 행 | 내용 | 연결 |
|---|---|---|---|
| `GameTip` | 92 | 루미아 섬과 코발트 프로토콜 게임 팁. | `titleTextKey`, `contentTextKey`가 번역 키(92개 중 92) |
| `LoadingTip` | 598 | 로딩 화면 팁. | `textKey`가 번역 키(598개 중 598) |
| `Season` | 42 | 시즌과 시작·종료 시각. 번호 읽는 법은 실전 가이드에 있음. | `seasonID` = 경기 기록의 `seasonId` |

## 참고

- 어떤 필드는 행에 따라 숫자이기도 하고 문자열이기도 합니다. 예: `modeType`, `DropGroup`의 `itemCode`. 비교하기 전에 형을 맞추세요.
- 표 전체를 다시 배포하지 마세요. 각자 자기 키로 API에서 받아 쓰세요.
- 이 문서는 공개된 Open API 표만 다룹니다. MIT 라이선스는 이 라이브러리의 코드에만 적용됩니다. 게임 데이터, 텍스트 등 리소스의 권리는 님블뉴런에 있으며 이 라이선스와 별개입니다.
