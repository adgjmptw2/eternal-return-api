# eternal-return-api

[![CI](https://github.com/adgjmptw2/eternal-return-api/actions/workflows/ci.yml/badge.svg)](https://github.com/adgjmptw2/eternal-return-api/actions/workflows/ci.yml) [![npm](https://img.shields.io/npm/v/eternal-return-api)](https://www.npmjs.com/package/eternal-return-api)

[이터널 리턴 Open API](https://developer.eternalreturn.io)용 비공식 TypeScript 클라이언트입니다.

전적 사이트 [ERCraft](https://ercraft.net)에서 쓰는 코드를 떼어 냈습니다. 요청 속도 제한, 429 재시도, HTTP 200 안에 든 오류 코드, API 버전마다 다른 필드 이름처럼 운영하면서 맞춰 온 부분이 들어 있습니다.

[API 문서](https://adgjmptw2.github.io/eternal-return-api/) · [실전 가이드](GUIDE.ko.md)

- 런타임 의존성 없음. 내장 `fetch` 사용, Node 18 이상(CI에서 Node 18, 20, 22, 24 테스트).
- ESM 전용: `require`가 아니라 `import`로 씁니다.
- 자주 쓰는 응답은 타입이 있고, 모르는 필드도 그대로 남습니다.

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

## 디스코드 봇 예제

[examples/discord-bot](https://github.com/adgjmptw2/eternal-return-api/tree/main/examples/discord-bot)은 `/er 닉네임` 명령 하나짜리 봇입니다. 현재 랭크 RP, 최근 경기 요약, 많이 한 실험체, 최근 5경기를 보여 줍니다.

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
- **`next`는 경기 ID입니다.** 다음 요청에 그대로 넘기면 더 오래된 경기를 받습니다.
- **시즌 ID와 시즌 번호가 다릅니다.** `Season` 표의 `Season20`이 게임 안의 시즌 11입니다. `Season10`부터는 9를 빼면 됩니다. `toPlayerSeason()`으로 바꿀 수 있습니다.
- **현재 시즌이 프리시즌일 수 있습니다.** 시즌 사이에는 `isCurrent`가 랭크가 없는 `Pre-Season` 행을 가리킵니다. `currentRankedSeasonId`는 이때 직전 랭크 시즌을 돌려줍니다.
- **코발트 프로토콜 모드 코드는 두 개입니다.** 지금 경기는 `matchingMode` 6, 예전 기록은 4입니다.
- **번역은 JSON이 아니라 파일입니다.** `/v1/l10n/{language}`는 `키┃값` 줄로 된 텍스트 파일 주소를 줍니다.
- **상위 랭킹은 페이지가 없습니다.** 한 번 받은 응답이 전부입니다(2026년 10월 기준 1,001명). uid 없이 닉네임만 옵니다.

## 넣지 않은 것

- 429 말고 다른 네트워크 오류 재시도. 쓰는 곳에 맞게 직접 정하세요.
- 사용자 데이터 캐시. 경기 기록은 사라지니 직접 저장하세요.
- 리플레이 파일.

## 라이선스

MIT. 님블뉴런과 관계없는 비공식 프로젝트입니다.
