# eternal-return-api

[![CI](https://github.com/adgjmptw2/eternal-return-api/actions/workflows/ci.yml/badge.svg)](https://github.com/adgjmptw2/eternal-return-api/actions/workflows/ci.yml) [![npm](https://img.shields.io/npm/v/eternal-return-api)](https://www.npmjs.com/package/eternal-return-api)

[이터널 리턴 Open API](https://developer.eternalreturn.io)용 비공식 TypeScript 클라이언트입니다.

전적 사이트 [ERCraft](https://ercraft.net)에서 쓰는 코드를 떼어 냈습니다. 요청 속도 제한, 429 재시도, HTTP 200 안에 든 오류 코드, API 버전마다 다른 필드 이름처럼 운영하면서 맞춰 온 부분이 들어 있습니다.

[API 문서](https://adgjmptw2.github.io/eternal-return-api/) · [실전 가이드](GUIDE.ko.md)

- 런타임 의존성 없음. 내장 `fetch` 사용, Node 18 이상(CI에서 Node 18, 20, 22, 24 테스트).
- ESM 전용: `require`가 아니라 `import`로 씁니다.
- 자주 쓰는 응답은 타입이 있고, 모르는 필드도 그대로 남습니다.
- Python 버전: [`pip install eternal-return-api`](python/README.ko.md). 새 경기만 받기, 감시, 팀, 티어, 이름 찾기가 똑같이 들어 있습니다.

## 설치

```sh
npm install eternal-return-api
```

## 사용

```ts
import { ErClient, MatchingMode, groupTeams, rankTier, summarizeGames } from 'eternal-return-api'

const er = new ErClient({ apiKey: process.env.ER_API_KEY! })

const user = await er.getUserByNickname('닉네임')
if (!user) throw new Error('없는 플레이어')

const seasons = await er.getSeasons()
const seasonId = seasons.currentRankedSeasonId!

const rank = await er.getUserRank(user.uid, seasonId)
const stats = await er.getUserStats(user.uid, seasonId, MatchingMode.RANKED)

// 공식 번역 파일의 이름
const names = await er.getNames('Korean')

// RP로 티어 계산(데미갓·이터니티는 순위도 필요)
const tier = rankTier(rank?.mmr ?? 0, { rank: rank?.rank, season: seasons.playerSeasonOf(seasonId) })
console.log(names.tier(tier.tier), tier.division) // "다이아몬드" 2

// 최근 경기, 최신순, 페이지를 넘겨 가며
const games = []
for await (const game of er.iterateUserGames(user.uid, { since: new Date('2026-10-01') })) {
  games.push(game)
  console.log(names.character(game.characterNum), names.weapon(game.bestWeapon), game.gameRank)
}

// 전체와 실험체별 승률, 평균 순위, 킬
const { overall, characters } = summarizeGames(games)

// 한 경기의 참가자 전원, 팀별로
const teams = groupTeams(await er.getGame(12345678))
```

`getNames`는 경기 기록의 숫자 코드를 이름으로 바꿉니다. 실험체(`character`), 아이템(`item`), 특성(`trait`), 무기(`weapon`, `bestWeapon` 값), 전술 스킬(`tacticalSkill`, `tacticalSkillGroup` 값)을 지원하고, 모르는 코드는 `null`을 돌려줍니다.

`rankTier`는 RP를 티어와 단계로 바꿉니다. 시즌별 구간은 ERCraft와 같은 표를 씁니다. 데미갓과 이터니티는 순위로 정해지니 `rank`를 넣어야 하고, 없으면 미스릴까지만 나옵니다. 패키지에 없는 새 시즌은 마지막 시즌 표를 씁니다. `names.tier`는 언어별 티어 이름만 돌려주니, 단계 숫자는 직접 붙이세요.

`groupTeams`는 팀을 순위순으로 정렬하고 팀 킬, 어시스트, 딜량을 더해 줍니다.

`summarizeGames`는 넣은 경기를 모드 구분 없이 합칩니다. 한 모드만 보려면 `matchingMode`로 먼저 거르세요.

API 키는 [developer.eternalreturn.io](https://developer.eternalreturn.io)에서 받습니다. 키는 서버에만 두고 브라우저 코드에 넣지 마세요.

## 새 경기만 받기

전적 사이트나 봇은 같은 플레이어를 계속 다시 조회합니다. 매번 목록을 처음부터 넘기면 요청이 낭비됩니다. ERCraft는 첫 검색에 5.3초가 걸린 적이 있는데, 이미 저장한 경기를 찾으려고 최신 경기부터 페이지를 넘겼기 때문입니다. `next` 커서로 그 위치로 바로 건너뛰게 바꿔 1.75초로 줄였습니다.

```ts
import { isGameFinished } from 'eternal-return-api'

// 가진 경기 중 가장 최신 것보다 새 경기만. 몇 판이면 요청 1번.
const { games, newestGameId } = await er.syncUserGames(uid, { after: saved })
await db.saveGames(games)
await db.saveNewest(uid, newestGameId)

// 다른 팀이 아직 게임 중일 때 받은 경기에는 1등이 없습니다.
// 끝난 경기만 확정 저장하고, 나머지는 나중에 다시 받으세요.
const players = await er.getGame(games[0].gameId)
if (isGameFinished(players)) await db.saveGame(players)
```

- 플레이어의 경기 목록은 `gameId` 내림차순이고, API의 `next` 커서가 경기 ID입니다. `after`는 가진 경기에서 멈추고, `before`는 지정한 경기 바로 아래부터 요청 1번에 시작합니다.
- `maxPages`를 주면 `syncUserGames`가 `after`에 닿기 전에 멈출 수 있습니다. 이때 `rest`가 같이 오니 `rest`가 더 안 올 때까지 그대로 다시 넘기세요. 그 전까지 `newestGameId`는 예전 `after` 그대로라서, 저장해도 경기를 건너뛰지 않습니다.
- `getGame`은 끝나지 않은 경기를 캐시하지 않습니다.

ERCraft는 경기 도중에 받은 기록을 완성본으로 저장해서, 팀원 기록이 없다고 나온 적이 있습니다. 끝난 경기에는 `gameRank`가 1인 행이 있습니다. 끝난 경기도 24행보다 적을 수 있어서 행 수만으로는 판단할 수 없습니다.

### 새 경기 알림

`watchGames`는 플레이어가 경기를 끝내면 오래된 순서로 알려 줍니다. 디스코드 봇에서 결과를 올릴 때 쓸 수 있습니다.

```ts
const watched = new Set([uid])
for await (const event of er.watchGames({ uids: () => watched, intervalMs: 60_000, signal })) {
  if (event.type === 'game') console.log(event.uid, event.game.gameRank, event.game.playerKill)
  else console.error(event.uid, event.error)
}
```

- 첫 바퀴는 플레이어마다 최신 경기만 기억하고, 지난 경기는 알리지 않습니다. 재시작 후 이어서 보려면 마지막으로 처리한 경기를 `after: { [uid]: gameId }`로 넘기세요. `after`는 플레이어가 처음 나타날 때 읽으니, 봇에서 플레이어를 추가하기 전에 값을 넣어 두면 됩니다.
- 플레이어마다 오래된 경기부터 오고, 지난 바퀴 이후 몇 판을 했든 빠뜨리지 않습니다.
- `uids`에 배열이나 Set을 넣으면 매 바퀴 다시 읽으니, 나중에 추가해도 반영됩니다. 함수를 넣으면 매 바퀴 호출합니다.
- 새 경기가 없으면 한 바퀴에 플레이어당 요청 1번이고, 캐시를 쓰지 않습니다. 기본값인 초당 1회면 60명 한 바퀴에 1분이 걸립니다.
- 한 플레이어의 요청이 실패하면 `error` 이벤트가 옵니다. 감시는 계속되고 다음 바퀴에 다시 시도합니다.
- `event.game`은 그 플레이어 본인의 행입니다. 다른 팀은 아직 게임 중일 수 있으니, `getGame` 결과를 저장하기 전에 `isGameFinished`로 확인하세요.

## 캐시

API는 초당 1회 정도만 허용해서, 사용자가 많은 봇은 금방 막힙니다. 캐시를 켜면 같은 조회는 API를 다시 부르지 않습니다. 기본적으로 꺼져 있습니다.

```ts
import { ErClient, MemoryCache } from 'eternal-return-api'

const er = new ErClient({ apiKey, cache: new MemoryCache({ maxEntries: 1000 }) })
```

성공한 응답만 저장합니다. 같은 요청이 진행 중이면 다른 호출은 새로 부르지 않고 그 결과를 기다립니다. 캐시가 오류를 내거나 `cacheTimeoutMs`(기본 1초) 안에 답하지 않으면 없는 것으로 보고 API를 부르므로, 캐시 때문에 요청이 멈추지는 않습니다.

| 종류 | 기본 |
|---|---|
| `nickname` | 10분 |
| `userGames`, `rank` | 1분 |
| `topRanks`, `stats` | 5분 |
| `game`, `data` | 1시간 |

`cacheTtlMs`로 바꿀 수 있습니다(예: `{ userGames: 30_000 }`). `0`이면 그 종류는 저장하지 않습니다.

여러 프로세스가 캐시를 함께 쓰려면 `get`과 `set`이 있는 객체를 넘기면 됩니다. [node-redis](https://github.com/redis/node-redis) 예:

```ts
const cache = {
  get: (key) => redis.get(key),
  set: (key, value, ttlMs) => redis.set(key, value, { PX: ttlMs }),
}
```

메서드 목록과 옵션은 [영문 README](README.md#api)에 있습니다. 기본 설정은 초당 1회 요청이고, 키 한도에 맞게 `requestsPerSecond`를 바꾸면 됩니다.

API 오류와 타임아웃은 `ErApiError`(`status`, `apiCode`)로 던지고, `fetch`의 네트워크 오류는 그대로 전파됩니다.

## 게임 데이터

`getGameData()`는 실험체 테이블과 아이템 테이블을 한 번에 합쳐 줍니다.

```ts
const data = await er.getGameData()
data.weaponsOf(game.characterNum)  // ["OneHandSword", "TwoHandSword", ...]
data.equipment(game).chest         // { code, slot, grade: "Legend", completed, materials, ... }
names.weaponType('Glove')          // 고른 언어의 무기 종류 이름
```

`itemGradeOf(5)`는 `"Legend"`입니다. `equipmentGrade` 숫자를 `"Common"` … `"Mythic"`으로 바꿉니다.

## API 키 없이 테스트

`eternal-return-api/testing`은 실제 응답으로 만든 샘플을 돌려줍니다. 실제 플레이어를 찾을 수 없게 닉네임과 경기 ID는 바꾸고, RP와 시간은 옮겼습니다. 랭크 2판의 참가자 전원, 상위 랭킹, 필요한 테이블과 번역 키가 들어 있습니다.

```ts
import { createSampleClient, SAMPLE_NICKNAME } from 'eternal-return-api/testing'

const er = createSampleClient()
const user = await er.getUserByNickname(SAMPLE_NICKNAME)
```

샘플에 없는 요청은 실제 API처럼 HTTP 200에 `code: 404`로 옵니다. 클라이언트를 직접 만들 때는 `sampleFetch()`를 `fetch`로 넣으면 됩니다.

## 디스코드 봇 예제

[examples/discord-bot](https://github.com/adgjmptw2/eternal-return-api/tree/main/examples/discord-bot)에는 명령이 두 개 있습니다. `/er 닉네임`은 현재 랭크 RP, 최근 경기 요약, 많이 한 실험체, 최근 5경기를 보여 주고, `/er-watch 닉네임`은 `watchGames`로 그 플레이어가 경기를 끝낼 때마다 채널에 결과를 올립니다.

## MCP 서버

[MCP](https://modelcontextprotocol.io) 서버가 들어 있어서, Claude 같은 AI가 전적과 경기를 직접 조회할 수 있습니다.

```json
{
  "mcpServers": {
    "eternal-return": {
      "command": "npx",
      "args": ["-y", "-p", "eternal-return-api", "eternal-return-mcp"],
      "env": { "ER_API_KEY": "API 키" }
    }
  }
}
```

| 도구 | 입력 | 결과 |
|---|---|---|
| `player_profile` | `nickname`, `games`(1~50, 기본 20) | 랭크 티어와 RP, 최근 경기 요약(코발트 제외), 많이 한 실험체, 이름으로 바꾼 최근 경기 |
| `game_detail` | `gameId` | 그 경기의 참가자 전원, 팀별로 |
| `top_ranks` | `limit`(1~100, 기본 20) | 현재 랭크 시즌 상위 플레이어 |

기본 언어는 한국어입니다. `ER_LANGUAGE`(예: `English`)로 바꿀 수 있습니다.

## ERCraft 운영 메모

운영하면서 부딪힌 것들입니다. 팀, RP, 티어, 코드 찾기는 [실전 가이드](GUIDE.ko.md)에 더 있습니다.

- **HTTP 200이 성공이 아닙니다.** 모든 응답에 `{ code, message }`가 있고, HTTP 200인데 본문 `code`가 오류일 수 있습니다. 클라이언트는 `code`를 확인합니다.
- **닉네임 조회는 `uid`가 아니라 `userId`를 줍니다.** 실제 응답은 `userId`, 문서는 `uid`입니다. 둘 다 받아서 항상 `uid`로 돌려줍니다.
- **돌아온 닉네임을 확인합니다.** 요청한 닉네임과 비교해(대소문자, 전각·반각 차이는 무시) 다르면 `ErNicknameMismatchError`를 던집니다.
- **플레이어는 uid로 찾습니다.** `userNum` 조회는 없어졌습니다.
- **`/v1/user/games`에는 그 플레이어 한 명의 기록만 있습니다.** 한 경기의 참가자 전원은 경기마다 `/v1/games/{gameId}`로 받아야 합니다.
- **경기 기록은 오래 남지 않습니다.** 약 90일만 남습니다. 한 페이지에 약 10경기씩 오는데, 문서에는 없는 내용입니다. 필요한 건 직접 저장하세요.
- **`next`는 경기 ID입니다.** 다음 요청에 그대로 넘기면 더 오래된 경기를 받습니다. 다음 페이지는 그 경기 바로 아래부터라서, `next=<gameId + 1>`이면 그 경기부터 옵니다.
- **경기 도중 받은 기록은 완성본이 아닙니다.** 끝난 플레이어만 있고 1등이 없습니다.
- **시즌 ID와 시즌 번호가 다릅니다.** `Season` 표의 `Season20`이 게임 안의 시즌 11입니다. `Season10`부터는 9를 빼면 됩니다. `toPlayerSeason()`으로 바꿀 수 있습니다.
- **현재 시즌이 프리시즌일 수 있습니다.** 시즌 사이에는 `isCurrent`가 랭크가 없는 `Pre-Season` 행을 가리킵니다. `currentRankedSeasonId`는 이때 직전 랭크 시즌을 돌려줍니다.
- **코발트 프로토콜 모드 코드는 두 개입니다.** 지금 경기는 `matchingMode` 6, 예전 기록은 4입니다.
- **번역은 JSON이 아니라 파일입니다.** `/v1/l10n/{language}`는 `키┃값` 줄로 된 텍스트 파일 주소를 줍니다.
- **상위 랭킹은 페이지가 없습니다.** 한 번 받은 응답이 전부입니다(2026년 10월 기준 1,001명). uid 없이 닉네임만 옵니다.

## 넣지 않은 것

- 429 말고 다른 네트워크 오류 재시도. 쓰는 곳에 맞게 직접 정하세요.
- 경기 저장. 경기 기록은 사라지니 직접 DB에 저장하세요. 무엇이 새 경기인지는 `syncUserGames`가 알려 줍니다.
- 리플레이 파일.

## 라이선스

MIT. 님블뉴런과 관계없는 비공식 프로젝트입니다.
