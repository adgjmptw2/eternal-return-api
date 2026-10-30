# eternal-return-api

Unofficial TypeScript client for the [Eternal Return Open API](https://developer.eternalreturn.io).

The code comes from [ERCraft](https://ercraft.net), an Eternal Return stats site that runs on this API. The parts that took debugging to get right are built in: rate limiting, 429 retries, error codes inside HTTP 200 responses, and field name changes between API versions.

[한국어](README.ko.md)

- No runtime dependencies. Uses built-in `fetch`; Node 18+ (tested on Node 22).
- ESM only: `import`, not `require`.
- Full TypeScript types for common responses. Unknown fields are preserved.

## Install

```sh
npm install eternal-return-api
```

## Use

```ts
import { ErClient, MatchingMode } from 'eternal-return-api'

const er = new ErClient({ apiKey: process.env.ER_API_KEY! })

const user = await er.getUserByNickname('Nickname')
if (!user) throw new Error('No such player')

const seasons = await er.getSeasons()
const seasonId = seasons.currentRankedSeasonId!

const rank = await er.getUserRank(user.uid, seasonId)
const stats = await er.getUserStats(user.uid, seasonId, MatchingMode.RANKED)

// Recent games, newest first, across pages
for await (const game of er.iterateUserGames(user.uid, { since: new Date('2026-10-01') })) {
  console.log(game.gameId, game.characterNum, game.gameRank)
}

// Everyone in one game
const players = await er.getGame(12345678)

// Character names from the official localization file
const names = await er.getCharacterNames('Korean')
```

Get an API key at [developer.eternalreturn.io](https://developer.eternalreturn.io). Keep it on your server. Never expose it to the browser.

## API

| Method | Endpoint | Returns when not found |
|---|---|---|
| `getUserByNickname(nickname)` | `/v1/user/nickname` | `null` |
| `getUserGames(uid, next?)` | `/v1/user/games/uid/{uid}` | `{ games: [] }` |
| `iterateUserGames(uid, { since?, maxPages? })` | same, all pages | ends |
| `getGame(gameId)` | `/v1/games/{gameId}` | `[]` |
| `getUserRank(uid, seasonId, teamMode?)` | `/v1/rank/uid/{uid}/{seasonId}/{teamMode}` | `null` |
| `getTopRanks(seasonId, teamMode?)` | `/v1/rank/top/{seasonId}/{teamMode}` | `[]` |
| `getUserStats(uid, seasonId, matchingMode?)` | `/v2/user/stats/uid/{uid}/{seasonId}/{mode}` | `[]` |
| `getData(metaType)` | `/v2/data/{metaType}` | throws |
| `getSeasons()` | `/v2/data/Season`, cached | throws |
| `getL10n(language)`, `getCharacterNames(language)` | `/v1/l10n/{language}` + file download | throws |
| `request(path)` | any path | throws |

API errors and timeouts throw `ErApiError` with `status` (HTTP status, or the body `code` when HTTP was 200) and `apiCode` (the body `code`). Network errors from `fetch` are passed through as-is.

### Options

```ts
new ErClient({
  apiKey: '...',
  requestsPerSecond: 1,      // ERCraft's setting; match your key's limit
  burst: 1,
  timeoutMs: 9000,
  retryDelaysMs: [1500, 3000], // waits after HTTP 429; [] to disable
  seasonCacheTtlMs: 300000,
})
```

All requests from one `ErClient` share one rate limiter. Use one client per key.

## Notes from running ERCraft

Things we ran into in production.

- **HTTP 200 does not mean success.** Every response has `{ code, message }`. A request can come back HTTP 200 with an error `code` in the body. The client checks `code`.
- **Nickname lookup returns `userId`, not `uid`.** The API returns `userId`, but the docs show `uid`. The client accepts both and always gives you `uid`.
- **The returned nickname is checked.** The client compares it with the one you asked for, ignoring case and full-width/half-width differences, and throws `ErNicknameMismatchError` if they differ.
- **Look players up by uid.** Lookup by `userNum` is retired.
- **`/v1/user/games` returns only that player's row.** To see all participants, call `/v1/games/{gameId}`.
- **Game history is short.** Only about 90 days are kept. Each page has about 10 games, which is undocumented. Store what you need.
- **`next` is a game id.** Pass it back to get older games.
- **Season ids are not season numbers.** The `Season` table names rows `Season20`, which players call Season 11. From `Season10` on, subtract 9. `toPlayerSeason()` does this.
- **The current season can be a pre-season.** Between seasons, `isCurrent` points at a `Pre-Season` row, which has no ranked ladder. `currentRankedSeasonId` falls back to the last ranked season.
- **Cobalt Protocol has two mode codes.** New games use `matchingMode` 6; older records use 4.
- **Localization is a file, not JSON.** `/v1/l10n/{language}` returns a URL to a text file with `key┃value` lines.
- **Top ranks are not paginated.** One response is all you get (1,001 players in Oct 2026). It has nicknames, not uids.

## Not included

- Retrying network errors other than 429. Decide that per use case.
- Caching user data. Store games yourself; they expire.
- Replay files.

## License

MIT. Not affiliated with or endorsed by Nimble Neuron.
