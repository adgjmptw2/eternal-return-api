# eternal-return-api

[![CI](https://github.com/adgjmptw2/eternal-return-api/actions/workflows/ci.yml/badge.svg)](https://github.com/adgjmptw2/eternal-return-api/actions/workflows/ci.yml) [![npm](https://img.shields.io/npm/v/eternal-return-api)](https://www.npmjs.com/package/eternal-return-api)

Unofficial TypeScript client for the [Eternal Return Open API](https://developer.eternalreturn.io).

The code comes from [ERCraft](https://ercraft.net), an Eternal Return stats site that runs on this API. The parts that took debugging to get right are built in: rate limiting, 429 retries, error codes inside HTTP 200 responses, and field name changes between API versions.

[한국어](https://github.com/adgjmptw2/eternal-return-api/blob/main/README.ko.md) · [API reference](https://adgjmptw2.github.io/eternal-return-api/) · [Field guide](GUIDE.md)

- No runtime dependencies. Uses built-in `fetch`; Node 18+ (CI tests Node 18, 20, 22 and 24).
- ESM only: `import`, not `require`.
- Full TypeScript types for common responses. Unknown fields are preserved.

## Install

```sh
npm install eternal-return-api
```

## Use

```ts
import { ErClient, MatchingMode, groupTeams, rankTier, summarizeGames } from 'eternal-return-api'

const er = new ErClient({ apiKey: process.env.ER_API_KEY! })

const user = await er.getUserByNickname('Nickname')
if (!user) throw new Error('No such player')

const seasons = await er.getSeasons()
const seasonId = seasons.currentRankedSeasonId!

const rank = await er.getUserRank(user.uid, seasonId)
const stats = await er.getUserStats(user.uid, seasonId, MatchingMode.RANKED)

// Names from the official localization file
const names = await er.getNames('English')

// Tier from RP. The top two tiers also need the leaderboard rank.
const tier = rankTier(rank?.mmr ?? 0, { rank: rank?.rank, season: seasons.playerSeasonOf(seasonId) })
console.log(tier.name, names.tier(tier.tier)) // "Diamond 2" "Diamond"

// Recent games, newest first, across pages
const games = []
for await (const game of er.iterateUserGames(user.uid, { since: new Date('2026-10-01') })) {
  games.push(game)
  console.log(names.character(game.characterNum), names.weapon(game.bestWeapon), game.gameRank)
}

// Win rate, average rank and kills, overall and per character
const { overall, characters } = summarizeGames(games)

// Everyone in one game, grouped by team
const teams = groupTeams(await er.getGame(12345678))
```

`getNames` turns the codes in game records into names: `character`, `item`, `trait`, `weapon` (`bestWeapon`) and `tacticalSkill` (`tacticalSkillGroup`). Each returns `null` for unknown codes.

`rankTier` turns RP into a tier and division, using the same season tables as ERCraft. Titan and Immortal (keys `demigod` and `eternity`) depend on leaderboard rank, so pass `rank`. Without it, the highest result is Mythril. Seasons newer than the package use the latest table. `names.tier` returns just the tier name in the chosen language, without the division.

`groupTeams` sorts teams by placement and adds team kills, assists and damage.

`summarizeGames` combines all modes passed in. Filter by `matchingMode` first if you need one mode.

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
| `getNames(language)` | l10n + `TacticalSkillSetGroup`, `TacticalSkillSet`, cached | throws |
| `getGameData()` | `CharacterMastery`, `ItemWeapon`, `ItemArmor`, cached | throws |
| `request(path)` | any path | throws |

API errors and timeouts throw `ErApiError` with `status` (HTTP status, or the body `code` when HTTP was 200) and `apiCode` (the body `code`). Network errors from `fetch` are passed through as-is.

### Cache

The API allows about one request per second, so a bot with many users hits the rate limit quickly. A cache answers repeated lookups without calling the API. Disabled by default.

```ts
import { ErClient, MemoryCache } from 'eternal-return-api'

const er = new ErClient({ apiKey, cache: new MemoryCache({ maxEntries: 1000 }) })
```

Only successful responses are cached. While one request is in flight, the same request from other callers waits for it instead of calling the API again. A cache that fails or takes longer than `cacheTimeoutMs` (default 1 second) to answer counts as a miss, so it never blocks requests.

| Kind | Default |
|---|---|
| `nickname` | 10 minutes |
| `userGames`, `rank` | 1 minute |
| `topRanks`, `stats` | 5 minutes |
| `game`, `data` | 1 hour |

Change them with `cacheTtlMs`, for example `{ userGames: 30_000 }`. `0` turns a kind off.

To share a cache between processes, pass any object with `get` and `set`. With [node-redis](https://github.com/redis/node-redis):

```ts
const cache = {
  get: (key) => redis.get(key),
  set: (key, value, ttlMs) => redis.set(key, value, { PX: ttlMs }),
}
```

### Options

```ts
new ErClient({
  apiKey: '...',
  requestsPerSecond: 1,      // ERCraft's setting; match your key's limit
  burst: 1,
  timeoutMs: 9000,
  retryDelaysMs: [1500, 3000], // waits after HTTP 429; [] to disable
  seasonCacheTtlMs: 300000,
  cache: new MemoryCache(),  // off by default; see Cache
  cacheTtlMs: { userGames: 60000 },
})
```

All requests from one `ErClient` share one rate limiter. Use one client per key.

## Game data

`getGameData()` joins the character and item tables once, so you do not have to.

```ts
const data = await er.getGameData()
data.weaponsOf(game.characterNum)  // ["OneHandSword", "TwoHandSword", ...]
data.equipment(game).chest         // { code, slot, grade: "Legend", completed, materials, ... }
names.weaponType('Glove')          // weapon type name in the chosen language
```

`itemGradeOf(5)` gives `"Legend"`: it turns an `equipmentGrade` number into `"Common"` … `"Mythic"`.

## Testing without an API key

`eternal-return-api/testing` serves anonymized real responses: two ranked games with every player, the leaderboard, and the tables and localization keys they need. Nicknames and game IDs are replaced, and RP and times are shifted, so rows do not point back at real players.

```ts
import { createSampleClient, SAMPLE_NICKNAME } from 'eternal-return-api/testing'

const er = createSampleClient()
const user = await er.getUserByNickname(SAMPLE_NICKNAME)
```

Requests not in the sample get the real API's not-found answer: HTTP 200 with `code: 404`. `sampleFetch()` is the `fetch` behind it, if you build the client yourself.

## Discord bot example

[examples/discord-bot](https://github.com/adgjmptw2/eternal-return-api/tree/main/examples/discord-bot) is a bot with one command, `/er nickname`. It shows current ranked RP, a recent games summary, most played characters and the last five games.

## MCP server

The package includes an [MCP](https://modelcontextprotocol.io) server, so AI assistants such as Claude can look up players and games.

```json
{
  "mcpServers": {
    "eternal-return": {
      "command": "npx",
      "args": ["-y", "-p", "eternal-return-api", "eternal-return-mcp"],
      "env": { "ER_API_KEY": "your key" }
    }
  }
}
```

| Tool | Input | Returns |
|---|---|---|
| `player_profile` | `nickname`, `games` (1-50, default 20) | ranked tier and RP, recent games summary (Cobalt Protocol excluded), most played characters, recent games with names |
| `game_detail` | `gameId` | everyone in the game, by team |
| `top_ranks` | `limit` (1-100, default 20) | top players of the current ranked season |

Names are in Korean by default. Set `ER_LANGUAGE` (for example `English`) to change it.

## Notes from running ERCraft

Things we ran into in production. The [field guide](GUIDE.md) has more: teams, RP, tiers and code lookups.

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
