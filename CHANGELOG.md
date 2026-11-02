# Changelog

## 0.7.0

- `syncUserGames(uid, { after })`: only games newer than the newest one you have. Paging stops at `after`, so a few new games cost one request. With `maxPages`, `rest` fetches the games in between, and `newestGameId` does not move past them until they are fetched.
- `iterateUserGames` takes `after` and `before`. `before` jumps to a point in the list in one request, since the API's `next` cursor is a game id.
- `isGameFinished(players)`: a game fetched while other teams are still playing has no winner yet. The cache no longer keeps unfinished games, from `getGame` or `request`.
- `watchGames({ uids })`: reports games as players finish them. One request per player per round when nothing is new, no games skipped, and errors for one player do not stop the others.
- Discord bot example: `/er-watch nickname` posts a player's results in the channel.
- Python version: `pip install eternal-return-api` (see `python/`).

## 0.6.0

- Field guide (`GUIDE.md`, `GUIDE.ko.md`), checked against 30 live games.
- Notes on `UserGame` fields.
- `eternal-return-api/testing`: a sample client with anonymized real responses, for use without an API key.
- `getGameData()`: character weapons and item slots, grades and materials.
- `groupTeams` takes team values from the member who stayed longest without giving up.

## 0.5.0

- API reference site. No code changes.

## 0.4.0

- `rankTier`: tier and division from RP, with season tables for seasons 1 to 12.
- `GameNames.tier`.

## 0.3.0

- Response cache (`MemoryCache` or your own store), with per-kind times and shared in-flight requests.
- `groupTeams`.

## 0.2.0

- `getNames(language)`: names for characters, items, traits, weapons and tactical skills.
- `summarizeGames`.
- Discord bot example and MCP server (`eternal-return-mcp`).

## 0.1.1

- CI on Node 18 to 24, and publishing from tags.

## 0.1.0

- First release: the Open API client from ERCraft, with rate limiting, 429 retries and error codes inside HTTP 200 responses.
