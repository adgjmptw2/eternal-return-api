# eternal-return-api

[![CI](https://github.com/adgjmptw2/eternal-return-api/actions/workflows/ci.yml/badge.svg)](https://github.com/adgjmptw2/eternal-return-api/actions/workflows/ci.yml) [![npm](https://img.shields.io/npm/v/eternal-return-api)](https://www.npmjs.com/package/eternal-return-api)

[이터널 리턴 Open API](https://developer.eternalreturn.io)용 비공식 TypeScript 클라이언트입니다.

전적 사이트 [ERCraft](https://ercraft.net)에서 쓰는 코드를 떼어 냈습니다. 요청 속도 제한, 429 재시도, HTTP 200 안에 든 오류 코드, API 버전마다 다른 필드 이름처럼 운영하면서 맞춰 온 부분이 들어 있습니다.

- 런타임 의존성 없음. 내장 `fetch` 사용, Node 18 이상(CI에서 Node 18, 20, 22, 24 테스트).
- ESM 전용: `require`가 아니라 `import`로 씁니다.
- 자주 쓰는 응답은 타입이 있고, 모르는 필드도 그대로 남습니다.

## 설치

```sh
npm install eternal-return-api
```

## 사용

```ts
import { ErClient, MatchingMode } from 'eternal-return-api'

const er = new ErClient({ apiKey: process.env.ER_API_KEY! })

const user = await er.getUserByNickname('닉네임')
if (!user) throw new Error('없는 플레이어')

const seasons = await er.getSeasons()
const seasonId = seasons.currentRankedSeasonId!

const rank = await er.getUserRank(user.uid, seasonId)
const stats = await er.getUserStats(user.uid, seasonId, MatchingMode.RANKED)

// 최근 경기, 최신순, 페이지를 넘겨 가며
for await (const game of er.iterateUserGames(user.uid, { since: new Date('2026-10-01') })) {
  console.log(game.gameId, game.characterNum, game.gameRank)
}

// 한 경기의 참가자 전원
const players = await er.getGame(12345678)

// 공식 번역 파일의 캐릭터 이름
const names = await er.getCharacterNames('Korean')
```

API 키는 [developer.eternalreturn.io](https://developer.eternalreturn.io)에서 받습니다. 키는 서버에만 두고 브라우저 코드에 넣지 마세요.

메서드 목록과 옵션은 [영문 README](README.md#api)에 있습니다. 기본 설정은 초당 1회 요청이고, 키 한도에 맞게 `requestsPerSecond`를 바꾸면 됩니다.

API 오류와 타임아웃은 `ErApiError`(`status`, `apiCode`)로 던지고, `fetch`의 네트워크 오류는 그대로 전파됩니다.

## ERCraft 운영 메모

운영하면서 부딪힌 것들입니다.

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
