# 이터널 리턴 Open API 실전 가이드

[ERCraft](https://ercraft.net)를 만들면서 확인한, Open API가 실제로 돌려주는 값들입니다. 항목마다 실제 응답이나 ERCraft에 저장된 경기로 확인했고, 표본에서 나온 숫자는 표본 크기를 같이 적었습니다.

이 패키지의 클라이언트는 대부분을 이미 처리합니다. 이 문서는 언어와 상관없이 API를 직접 쓰는 분들을 위한 것입니다.

마지막 확인은 2026년 11월 26일, 13.2 패치 전입니다. 아래에서 "표본"은 경기 ID를 연속으로 받은 끝난 경기 1,029판(18,495행)입니다. 13.0과 13.1(시즌 13) 650판, 12.5~12.7 379판이고, 티어와 서버를 가리지 않았습니다.

[English](https://github.com/adgjmptw2/eternal-return-api/blob/main/GUIDE.md)

## 요청

- 키는 `x-api-key` 헤더에 넣습니다.
- 모든 응답 본문에 `{ code, message }`가 있습니다. HTTP 상태만 보지 말고 `code`를 확인하세요. 오류가 HTTP 200으로 올 때가 있습니다.
- 없는 플레이어나 만료된 경기는 HTTP 200에 `{ "code": 404, "message": "Not Found" }`로 옵니다.
- 요청 제한은 키마다 다릅니다. ERCraft는 초당 1회로 보내고, 429가 오면 1.5초, 3초 뒤에 다시 보냅니다.
- 번역 API `/v1/l10n/{language}`는 텍스트 파일 주소를 줍니다. 파일은 JSON이 아니고 한 줄이 `key┃value`(U+2503)입니다. ERCraft는 `Korean`, `English`를 씁니다.

## 플레이어

- 닉네임 조회는 `userId`를 돌려줍니다. 문서에는 `uid`라고 되어 있습니다. 플레이어 관련 API에는 이 값을 넣습니다.
- `userId`는 고정된 ID가 아닙니다. 같은 닉네임을 몇 초 간격으로 두 번 조회하면 서로 다른 값이 왔고, 두 값 모두 같은 경기 목록을 돌려줬습니다. 요청에만 쓰고 저장 키로는 쓰지 마세요. 이 값으로 묶으면 조회할 때마다 새 플레이어가 생깁니다. 값이 언제까지 유효한지는 문서에 없고, ERCraft에서는 예전 값도 계속 쓸 수 있었습니다.
- `/v1/user/games`의 닉네임은 경기 당시 닉네임입니다. 지금 그 닉네임을 누가 쓰는지는 알 수 없습니다.
- 게임 점검 중에는 모든 닉네임 조회가 404로 옵니다. 경기 목록과 상위 랭킹은 그대로 됩니다. 2026년 11월 12일 점검 때 확인했습니다.
- `userNum`으로 조회하는 방식은 더 이상 안 됩니다.
- `/v1/rank/uid/{uid}/{seasonId}/{teamMode}`는 그 시즌 랭크를 한 판도 안 한 플레이어에게도 값을 줍니다. 이때 `rank`는 0이고 `mmr`은 시즌 초기화 뒤 시작할 RP입니다. 이 값을 티어로 보여 주면 안 됩니다. 시즌 13에서 `rank`가 0인 40명은 모두 랭크 기록이 없었고, 랭크를 한 판이라도 한 80명은 모두 `rank`가 있었습니다. `getUserRank`는 0이면 null을 돌려줍니다.
- `/v1/rank/top/{seasonId}/{teamMode}`는 한 번 호출로 전체 목록이 옵니다. 2026년 10월과 11월 모두 1,001명이었습니다. uid는 없고 닉네임만 있습니다. 뒤에 `/{serverCode}`를 붙이면 그 서버의 순위표입니다. 순위표에 없는 플레이어는 `serverRank`가 0입니다.
- `/v2/user/stats/uid/{uid}/{seasonId}/{matchingMode}`의 시즌별 통계는 랭크만 있습니다. 일반과 코발트 프로토콜은 시즌이 없고, `seasonId`에 0을 넣으면 `matchingMode`와 상관없이 두 모드가 한 행씩 옵니다. 랭크 시즌에 모드 2를 넣으면 빈 목록입니다.

## 시즌

`Season` 테이블 번호와 게임 안 시즌 번호가 다릅니다.

| `Season` 행 | `seasonID` | 게임 안 시즌 |
|---|---|---|
| `Season20` | 39 | 시즌 11 |
| `Season21` | 41 | 시즌 12 |
| `Pre-Season22` | 42 | 시즌 13 프리시즌 |
| `Season22` | 43 | 시즌 13 |

- `Season10`부터는 행 번호에서 9를 빼면 게임 안 시즌입니다.
- 시즌 값은 랭크 게임에만 들어 있습니다. 다른 모드는 모두 `seasonId`가 0입니다.
- 시즌 사이에는 `isCurrent`가 `Pre-Season` 행을 가리킬 수 있습니다. 순위표는 없지만(`/v1/rank/top`은 404), 프리시즌 랭크 게임에는 42처럼 프리시즌 `seasonId`가 들어 있습니다.

## 모드

| `matchingMode` | `matchingTeamMode` | 모드 | 팀 |
|---|---|---|---|
| 2 | 3 | 일반 | 3명씩 7팀이나 8팀 |
| 3 | 3 | 랭크 | 3명씩 7팀이나 8팀 |
| 6 | 4 | 코발트 프로토콜 | 4명씩 2팀 |
| 9 | 1 | 론울프(이벤트 모드) | 15명 |
| 13 | 3 | 럼블 아웃(이벤트 모드) | 3명씩 5팀 |

- 럼블 아웃은 2026년 11월 12일~18일(13.0)에 열렸습니다. 이벤트 모드는 계속 바뀌니 모르는 `matchingMode`도 처리해 두세요.
- 예전 코발트 프로토콜 기록은 `matchingMode`가 4입니다.
- 모드마다 팀 수가 달라서 순위를 섞어 평균 내면 안 됩니다.

## 경기 기록

- `/v1/user/games/uid/{uid}`는 경기마다 그 플레이어의 행만 줍니다. 한 페이지에 약 10경기이고, `next`(경기 ID)를 넘기면 더 이전 경기가 옵니다.
- 경기 목록은 `gameId` 내림차순입니다. `next`는 그 페이지 마지막 경기의 ID이고, 다음 페이지는 그 아래부터 옵니다. 아무 경기 ID나 넣어도 됩니다. `next=<gameId + 1>`이면 그 경기부터 오므로, 목록 중간으로 요청 1번에 갈 수 있습니다. 최신 경기보다 큰 값을 넣으면 첫 페이지가 옵니다. 2026년 11월 실제 API로 확인했습니다.
- 다른 팀이 아직 게임 중일 때 `/v1/games/{gameId}`를 부르면, 끝난 플레이어만 있고 `gameRank`가 1인 행이 없습니다. ERCraft는 이런 경기를 완성본으로 저장해서, 다시 받기 전까지 팀원 기록이 없다고 나왔습니다. 2026년 11월 2일 실제 API로도 확인했습니다. 시작한 지 14분 된 일반 경기를 받아 보니 6행뿐이었고 순위는 모두 6위나 7위였습니다. 8분 뒤에는 15행이었고 여전히 1등이 없었습니다. 1등 행이 있으면 끝난 경기입니다. 끝난 경기도 24행보다 적을 수 있어서 행 수로는 판단할 수 없습니다. 다만 끝났는데도 1등 행이 없는 경기가 있습니다(AI 플레이어 참고).
- `/v1/games/{gameId}`는 그 경기의 참가자 전원을 줍니다.
- 경기는 약 90일 동안 보관되고, 그보다 오래된 경기는 오지 않습니다. 각 행의 `expireDtm`은 `startDtm` + `duration` + 90일이고, 4초 이내로 맞습니다.
- `startDtm`, `expireDtm`은 한국 시간(`+0900`)입니다. 확인한 모든 행에서 밀리초 자리가 초 값을 반복했으니(`15:30:59.059`) 밀리초로 읽지 마세요.
- `duration`, `playTime`, `watchTime`은 초 단위입니다. `totalTime`은 `playTime + watchTime`입니다.
- 한 행에 필드가 약 340개 있습니다. 12.7이 330개였고 13.0에서 12개가 늘었습니다. 알아 둘 만한 필드는 [`UserGame`](https://adgjmptw2.github.io/eternal-return-api/interfaces/UserGame.html)에 설명을 달았습니다.

## AI 플레이어

- 경기에 AI 플레이어가 들어올 수 있습니다. 일부는 보통 플레이어처럼 행이 있고 닉네임, 순위, RP도 있습니다. 이런 행은 `isMLBot`과 `mlbot`이 true이고 `preMade`가 0입니다. 일반 403판 중 103판, 랭크 277판 중 12판(평균 RP 2,657 이하)에 있었고, 코발트 프로토콜과 럼블 아웃에는 없었습니다. 실험체 통계나 승률을 낼 때는 빼야 합니다. `isMLBot`은 `/v1/games` 행에만 있습니다.
- 행이 없는 AI 플레이어도 있습니다. 그래서 초보 경기는 1행만 오기도 합니다.
- `botAdded`는 두 종류를 합한 AI 수이고, `matchSize`는 나머지 플레이어 수입니다.
- AI 팀이 이기면 모든 행의 `victory`가 0입니다. 행이 없는 AI 팀이 이기면 1등 행이 끝까지 없습니다. 표본 1,029판 중 8판이 그랬습니다.
- 그래서 1등 행이 있거나, AI 플레이어가 있는 경기(`botAdded`가 0보다 큼)는 시작한 지 충분히 지났으면 끝난 경기입니다. 가장 긴 경기가 27분이었고, `isGameFinished`는 넘긴 시각이 시작 1시간 뒤인지 봅니다. 그러니 받은 직후에 확인하세요.

## 팀

- 같은 팀은 `gameRank`, `victory`, `teamKill`, `duration`이 같습니다. 포기한 사람이 없는 5,903팀 중 한 팀만 `duration`이 달랐습니다.
- 포기한 플레이어(`giveUp: 1`)의 행은 나갈 때 값으로 남기도 합니다. 한 예로 그 플레이어 행은 5위, 팀 킬 14, 906초였고 팀원 행은 3위, 18, 1,070초였습니다. 팀 값은 포기하지 않은 팀원 중 `duration`이 가장 긴 사람 것을 쓰세요. `groupTeams`가 이렇게 합니다.
- `preMade`는 같이 큐를 잡은 인원입니다. 1은 솔로, 2는 듀오, 3은 트리오이고 코발트 프로토콜은 4까지 있습니다.
- `teamKill`은 보통 `teamElimination + teamDownCanEliminate + teamDownCanNotEliminate`입니다. 일반 3,003팀 중 150팀, 랭크 2,142팀 중 112팀, 코발트 프로토콜 624팀 중 9팀은 최대 5 더 컸고, 럼블 아웃은 180팀 중 36팀이 최대 12 더 컸습니다. 이 세 필드는 팀 단위로만 있고, 킬 종류를 플레이어별로 나눈 값은 없습니다.

## RP

표본의 랭크 6,426행 전부로 확인했습니다. 다른 모드에는 `mmrBefore`, `mmrGain`, `mmrAfter`, `mmrAvg`가 없고 `mmrGainInGame`, `mmrLossEntryCost`, `rankPoint`는 0입니다.

- `mmrAfter`가 경기 뒤 RP입니다. 중간에 나간 14명을 빼면 모든 행에서 `mmrBefore + mmrGainGambit`과 같습니다. `mmrGain`도 같은 값인데, 12.5와 12.6의 `gambit: true`인 19행은 변화량이 두 배로 적용됐고 `mmrGain`에는 절반만 있습니다.
- 변화량은 `mmrGainInGame + mmrLossEntryCost`이고, 티어 경계를 넘으면 50이 더해지거나 빠집니다. 티어가 오르면(실버에서 골드처럼. 골드 4에서 골드 3은 아님) +50, 내려가면 -50입니다. 티어가 오른 156행과 내려간 33행 모두 50이 더해지거나 빠졌고, 다른 행에는 없었습니다.
- `rankPoint`는 그 50을 빼고 계산한 경기 뒤 RP입니다. 중간에 나가서 `mmrAfter`가 0인 행에도 남은 RP가 들어 있습니다.
- 중간에 나가서(`giveUp: 1`) 벌점을 받은 플레이어는 `mmrGain`과 `mmrAfter`가 0이고 `mmrLossEntryCost`가 평소의 두 배입니다. 실제 RP는 `rankPoint`에 있고 `mmrBefore + mmrLossEntryCost`와 같습니다. 다음 랭크 게임의 `mmrBefore`와 12건 중 11건이 같았고, 1건은 30 낮았습니다. `giveUp: 1`이라고 모두 이 벌점을 받지는 않습니다.
- 그 팀원은 RP가 그대로인 경우가 있습니다. `mmrGainInGame`이 0이 아니어도 `mmrLossEntryCost`와 `mmrGain`이 0이고 `mmrAfter`가 `mmrBefore`와 같습니다. 28명 중 17명이 그랬습니다.
- 팀원끼리 얻는 RP는 자주 다릅니다. 2,055팀 중 1,595팀에서 `mmrGainInGame`이 달랐고, 차이의 중앙값은 5였습니다. 값이 다른 팀원 3,712쌍 중 3,411쌍에서 RP가 낮은 쪽이 더 받았고, 1·2등 팀의 1,051쌍은 모두 그랬습니다.
- `mmrLossEntryCost`는 입장료이고 단계마다 정해져 있습니다. 아이언은 0, 600 RP부터 10, 7,300 RP에서 56까지 오르고, 7,600 RP는 58에서 시작해 250 RP마다 2씩 늘어납니다. 듀오는 조금 더 냅니다. 시즌 12와 13이 같습니다.
- `mmrAvg`는 AI 플레이어를 포함한 모든 행의 `mmrBefore` 평균을 내림한 값입니다(277판 모두).
- `rpAfter`는 어느 응답에도 없었습니다. `mmrAfter`를 쓰세요.

`rpChange`는 이 예외를 처리해서 경기 전후 RP를 줍니다.

## 티어

API는 RP와 순위만 주고 티어는 주지 않습니다.

- 시즌 12와 13: 미스릴은 7,600 RP부터입니다. 데미갓과 이터니티는 8,300 RP 이상에 순위가 필요합니다. 이터니티는 1~300위, 데미갓은 301~1,000위입니다.
- 시즌 13에서는 600부터 7,600까지 모든 단계 경계에서 13.1 경기의 입장료가 바뀌고, 티어 변동 50도 모든 티어 경계에서 붙습니다. 8,300은 경기 기록으로 확인할 수 없고, 13.0과 13.1 패치노트에 바뀐다는 내용이 없습니다.
- 패치노트에 따르면 데미갓과 이터니티의 시즌 보상은 귀속 서버(`rewardServerCode`) 기준입니다. `rankTier`는 위의 전체 순위 기준만 쓰고 이 경우는 다루지 않습니다.
- 시즌 10, 11에서는 미스릴 기준(7,400, 7,600 RP) 이상이면 순위만으로 데미갓과 이터니티가 정해졌습니다.
- 미스릴 아래 티어는 대부분 4~1단계로 나뉩니다. 시즌 1~13 표는 [`rankTier`](https://adgjmptw2.github.io/eternal-return-api/functions/rankTier.html)에 있습니다.
- 번역 파일의 티어 키는 `IRON` … `METEORITE`, `MITHRIL`, `DEMIGOD`, `ETERNITY`, `UNRANK`입니다. 공식 영어 이름은 Mythril, Titan, Immortal입니다.

## 실험 과제(13.0, 13.1)

13.0과 13.1의 일반·랭크 게임에는 실험 과제가 있습니다. 13.2 패치노트(2026년 11월 26일)에 따르면 13.2에서 끝납니다.

- `experimentResultType`은 팀의 분야입니다. `Material`(재료 공학), `Energy`(에너지 공학), `Biotechnology`(생명 공학)이고, 과제를 하나도 못 깬 팀과 다른 모드에는 없습니다.
- `questStepClear`는 깬 과제를 처음 깬 순서로 담은 목록입니다. `experimentGroupId`, `firstClearElapsedSeconds`, `clearCount`가 있고, 깬 과제가 없으면 빈 목록입니다.
- `experimentGroupId`의 첫 자리가 분야입니다. 13.0은 `x0001`이 시작 과제, `x0002`가 반복 과제이고, 13.1은 `x0011`이 시작 과제, `x0021`, `x0022`, `x0023`이 반복 과제입니다.
- `crExperimentReward`는 과제를 깨서, `crExperimentalCredit`은 분야 버프로 얻은 크레딧입니다.
- 13.0에서 `questResultType`, `questCompletedMaxRank`, 이름이 `PaddleOccupationCount`로 끝나는 필드 4개도 생겼는데 모든 행에서 0이었습니다.

## 코드를 이름으로

| 필드 | 찾는 곳 |
|---|---|
| `characterNum` | `Character/Name/{code}` |
| `equipment` 값 | `Item/Name/{code}` |
| `traitFirstCore`, `traitFirstSub`, `traitSecondSub` | `Trait/Name/{code}` |
| `bestWeapon` | 아이템 코드가 아니라 무기 종류 번호, 아래 참고 |
| `tacticalSkillGroup` | 데이터 테이블 두 개를 거침, 아래 참고 |

- **`bestWeapon`**은 무기 종류 이름으로 바꾼 뒤 `WeaponType/{이름}`으로 찾습니다. 번호는 1~25이고 12와 17은 없습니다. 표는 [`WEAPON_TYPES`](https://adgjmptw2.github.io/eternal-return-api/variables/WEAPON_TYPES.html)에 있습니다.
- **`tacticalSkillGroup`**: `TacticalSkillSetGroup` 행의 `startCode`로 `TacticalSkillSet` 행을 찾아 `skillCode`를 꺼냅니다. `skillCode`는 `"4524001, 4524011"` 같은 문자열일 수 있으니 첫 숫자를 씁니다. 1,000 단위로 내린 뒤 `Skill/Group/Name/{code}`로 찾습니다. 이 키가 없으면 ERCraft는 그룹 아이콘 이름 끝의 숫자로 다시 찾습니다.
- **`equipment`**는 칸 번호가 키인 객체입니다. `"0"` 무기, `"1"` 옷, `"2"` 머리, `"3"` 팔/장식, `"4"` 다리이고, 칸이 빠진 행도 있습니다. `ItemWeapon`, `ItemArmor` 테이블과 대조했습니다. 부위 이름은 `ArmorType/{Chest|Head|Arm|Leg}`에 있습니다.
- **`equipmentGrade`**도 키가 같습니다. 1(일반), 2(고급), 3(희귀), 4(영웅), 5(전설), 6(초월)이고, 13.0과 13.1 경기의 아이템 58,728개가 모두 표의 등급과 맞았습니다. 데이터 테이블의 `itemGrade`는 `Legend` 같은 이름이고, `ItemGrade/{itemGrade}`로 찾으면 됩니다.
- 번역 파일에는 삭제된 콘텐츠 이름도 남아 있습니다. 이름이 있다고 지금 게임에 있는 건 아니니, 현재 데이터 테이블에서 확인하세요.
