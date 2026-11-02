# 이터널 리턴 Open API 실전 가이드

[ERCraft](https://ercraft.net)를 만들면서 확인한, Open API가 실제로 돌려주는 값들입니다. 항목마다 실제 응답이나 ERCraft에 저장된 경기로 확인했고, 표본에서 나온 숫자는 표본 크기를 같이 적었습니다.

이 패키지의 클라이언트는 대부분을 이미 처리합니다. 이 문서는 언어와 상관없이 API를 직접 쓰는 분들을 위한 것입니다.

[English](https://github.com/adgjmptw2/eternal-return-api/blob/main/GUIDE.md)

## 요청

- 키는 `x-api-key` 헤더에 넣습니다.
- 모든 응답 본문에 `{ code, message }`가 있습니다. HTTP 상태만 보지 말고 `code`를 확인하세요. 오류가 HTTP 200으로 올 때가 있습니다.
- 없는 플레이어나 만료된 경기는 HTTP 200에 `{ "code": 404, "message": "Not Found" }`로 옵니다.
- 요청 제한은 키마다 다릅니다. ERCraft는 초당 1회로 보내고, 429가 오면 1.5초, 3초 뒤에 다시 보냅니다.
- 번역 API `/v1/l10n/{language}`는 텍스트 파일 주소를 줍니다. 파일은 JSON이 아니고 한 줄이 `key┃value`(U+2503)입니다. ERCraft는 `Korean`, `English`를 씁니다.

## 플레이어

- 닉네임 조회는 `userId`를 돌려줍니다. 문서에는 `uid`라고 되어 있습니다. 플레이어 관련 API에는 이 값을 넣습니다.
- `userNum`으로 조회하는 방식은 더 이상 안 됩니다.
- `/v1/rank/top/{seasonId}/{teamMode}`는 한 번 호출로 전체 목록이 옵니다. 2026년 10월 기준 1,001명입니다. uid는 없고 닉네임만 있습니다.

## 시즌

`Season` 테이블 번호와 게임 안 시즌 번호가 다릅니다.

| `Season` 행 | `seasonID` | 게임 안 시즌 |
|---|---|---|
| `Season20` | 39 | 시즌 11 |
| `Season21` | 41 | 시즌 12 |

- `Season10`부터는 행 번호에서 9를 빼면 게임 안 시즌입니다.
- 일반 게임과 코발트 프로토콜은 `seasonId`가 0입니다. 시즌 값은 랭크 게임에만 들어 있습니다.
- 시즌 사이에는 `isCurrent`가 랭크가 없는 `Pre-Season` 행을 가리킬 수 있습니다.

## 경기 기록

- `/v1/user/games/uid/{uid}`는 경기마다 그 플레이어의 행만 줍니다. 한 페이지에 약 10경기이고, `next`(경기 ID)를 넘기면 더 이전 경기가 옵니다.
- 경기 목록은 `gameId` 내림차순입니다. `next`는 그 페이지 마지막 경기의 ID이고, 다음 페이지는 그 아래부터 옵니다. 아무 경기 ID나 넣어도 됩니다. `next=<gameId + 1>`이면 그 경기부터 오므로, 목록 중간으로 요청 1번에 갈 수 있습니다. 최신 경기보다 큰 값을 넣으면 첫 페이지가 옵니다. 2026년 11월 실제 API로 확인했습니다.
- 다른 팀이 아직 게임 중일 때 `/v1/games/{gameId}`를 부르면, 끝난 플레이어만 있고 `gameRank`가 1인 행이 없습니다. ERCraft는 이런 경기를 완성본으로 저장해서, 다시 받기 전까지 팀원 기록이 없다고 나왔습니다. 2026년 11월 2일 실제 API로도 확인했습니다. 시작한 지 14분 된 일반 경기를 받아 보니 6행뿐이었고 순위는 모두 6위나 7위였습니다. 8분 뒤에는 15행이었고 여전히 1등이 없었습니다. 1등 행이 있으면 끝난 경기입니다. 끝난 경기도 24행보다 적을 수 있어서 행 수로는 판단할 수 없습니다.
- `/v1/games/{gameId}`는 그 경기의 참가자 전원을 줍니다.
- 경기는 약 90일 동안 보관되고, 그보다 오래된 경기는 오지 않습니다. 각 행의 `expireDtm`은 `startDtm` + `duration` + 90일이고, 594행 모두 3초 이내로 맞았습니다.
- `startDtm`, `expireDtm`은 한국 시간(`+0900`)입니다. 확인한 모든 행에서 밀리초 자리가 초 값을 반복했으니(`15:30:59.059`) 밀리초로 읽지 마세요.
- `duration`, `playTime`, `watchTime`은 초 단위입니다. `totalTime`은 `playTime + watchTime`입니다.
- 한 행에 필드가 약 320개 있습니다. 알아 둘 만한 필드는 [`UserGame`](https://adgjmptw2.github.io/eternal-return-api/interfaces/UserGame.html)에 설명을 달았습니다.

## 팀

실제 경기 30판(594행)으로 확인했습니다. 랭크 20판, 일반 4판, 코발트 프로토콜 6판입니다.

- 같은 팀은 `gameRank`, `victory`, `teamKill`, `duration`이 같고, 랭크에서는 `mmrGainInGame`도 같습니다.
- 표본의 유일한 예외는 게임을 포기한 플레이어(`giveUp: 1`)였습니다. 그 플레이어 행은 5위, 팀 킬 14, 906초였고 팀원 행은 3위, 18, 1,070초였습니다. 팀 값은 포기하지 않은 팀원 중 `duration`이 가장 긴 사람 것을 쓰세요. `groupTeams`가 이렇게 합니다.
- `victory`는 `gameRank`가 1일 때만 1입니다.
- `preMade`는 같이 큐를 잡은 인원입니다. 1은 솔로, 2는 듀오, 3은 트리오입니다. ERCraft의 입장료 계산도 이 값을 씁니다. 이번 표본의 스쿼드 팀은 1-1-1 아니면 1-2-2였습니다.
- `teamKill`은 보통 `teamElimination + teamDownCanEliminate + teamDownCanNotEliminate`입니다. 2명 이상인 194팀 중 6팀(모두 랭크)은 1~3 더 컸습니다. 이 세 필드는 팀 단위로만 있고, 킬 종류를 플레이어별로 나눈 값은 없습니다.
- 코발트 프로토콜은 4대4라 `gameRank`가 1 아니면 2입니다. 다른 모드 순위와 섞어 평균 내지 마세요.

## RP

랭크 20판 459행으로 확인했고, 아래 식은 모든 행에서 맞았습니다. 일반과 코발트 프로토콜 행에는 `mmrBefore`, `mmrGain`, `mmrAfter`, `mmrAvg`가 없고 `mmrGainInGame`, `mmrLossEntryCost`, `rankPoint`는 0입니다.

- `mmrAfter = mmrBefore + mmrGain`
- `mmrGain = mmrGainInGame + mmrLossEntryCost`. `mmrLossEntryCost`는 입장료입니다(이번 표본은 -66~-72, ERCraft에서는 입장료가 없는 판도 봤습니다).
- `rankPoint`는 `mmrAfter`와 같습니다.
- `mmrAvg`는 그 경기 참가자 전원의 `mmrBefore` 평균을 내림한 값입니다(20판 모두).
- `rpAfter`는 어느 응답에도 없었습니다. `mmrAfter`를 쓰세요.

## 티어

API는 RP와 순위만 주고 티어는 주지 않습니다.

- 시즌 12: 미스릴은 7,600 RP부터입니다. 데미갓과 이터니티는 8,300 RP 이상에 순위가 필요합니다. 이터니티는 1~300위, 데미갓은 301~1,000위입니다.
- 시즌 10, 11에서는 미스릴 기준(7,400, 7,600 RP) 이상이면 순위만으로 데미갓과 이터니티가 정해졌습니다.
- 미스릴 아래 티어는 대부분 4~1단계로 나뉩니다. 시즌 1~12 표는 [`rankTier`](https://adgjmptw2.github.io/eternal-return-api/functions/rankTier.html)에 있습니다.
- 번역 파일의 티어 키는 `IRON` … `METEORITE`, `MITHRIL`, `DEMIGOD`, `ETERNITY`, `UNRANK`입니다. 공식 영어 이름은 Mythril, Titan, Immortal입니다.

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
- **`equipmentGrade`**도 키가 같습니다. 확인된 값은 1(일반), 4(영웅), 5(전설), 6(초월)입니다. 데이터 테이블의 `itemGrade`는 `Legend` 같은 이름이고, `ItemGrade/{itemGrade}`로 찾으면 됩니다.
- 번역 파일에는 삭제된 콘텐츠 이름도 남아 있습니다. 이름이 있다고 지금 게임에 있는 건 아니니, 현재 데이터 테이블에서 확인하세요.
