# Eternal Return Open API: field guide

What the Open API actually returns, written while building [ERCraft](https://ercraft.net). Each point was checked against live responses or ERCraft's stored games. Where a number comes from a sample, the sample is named.

The client in this package already handles most of this. The guide is for anyone using the API directly, in any language.

Last checked on November 26, 2026, before the 13.2 patch. "The sample" below is 1,029 finished games in runs of consecutive game ids, all ranks and servers: 650 games of 13.0 and 13.1 (season 13) and 379 of 12.5 to 12.7, 18,495 rows in all.

[한국어](https://github.com/adgjmptw2/eternal-return-api/blob/main/GUIDE.ko.md)

## Requests

- Send the key in the `x-api-key` header.
- Every body has `{ code, message }`. Check `code`, not only the HTTP status: an error can come back with HTTP 200.
- A missing player or an expired game comes back as HTTP 200 with `{ "code": 404, "message": "Not Found" }`.
- The rate limit depends on your key. ERCraft runs at 1 request per second and retries 429 after 1.5 s, then 3 s.
- The localization endpoint `/v1/l10n/{language}` returns a URL to a text file. The file is not JSON: each line is `key┃value` (U+2503). ERCraft uses `Korean` and `English`.

## Players

- Nickname lookup returns `userId`. The docs call it `uid`. Player endpoints take this value.
- `userId` is not a stable ID. Two lookups of one nickname, seconds apart, returned different values, and both gave the same games. Use it for requests, not as a key: anything keyed by it gets a new player on every lookup. How long a value lasts is not documented; ERCraft has seen older ones keep working.
- Rows in `/v1/user/games` carry the nickname from the time of the game, so they do not tell who has a nickname now.
- During the game's maintenance, nickname lookup answers 404 for every nickname, while player games and top ranks keep working. Seen on November 12, 2026.
- Lookup by `userNum` is retired.
- `/v1/rank/uid/{uid}/{seasonId}/{teamMode}` also answers for players without a ranked game in that season: `rank` is 0 and `mmr` is the RP they would start from after the season reset. Do not show that as their tier. In season 13, 40 of 40 players with `rank` 0 had no ranked stats and 80 of 80 players with a ranked game had a `rank`. `getUserRank` returns null for rank 0.
- `/v1/rank/top/{seasonId}/{teamMode}` returns the whole list in one call: 1,001 players in October and November 2026. Rows have nicknames, not uids. Adding `/{serverCode}` gives one server's leaderboard. Players not on it have `serverRank` 0.
- `/v2/user/stats/uid/{uid}/{seasonId}/{matchingMode}` has ranked stats per season. Normal and Cobalt Protocol stats have no season: `seasonId` 0 returns a row for each, whatever the `matchingMode`. A ranked season with mode 2 returns an empty list.

## Seasons

The `Season` table and the game use different numbers.

| `Season` row | `seasonID` | Players call it |
|---|---|---|
| `Season20` | 39 | Season 11 |
| `Season21` | 41 | Season 12 |
| `Pre-Season22` | 42 | Season 13 pre-season |
| `Season22` | 43 | Season 13 |

- From `Season10` on, the player season is the row number minus 9.
- Only ranked games carry the season. Every other mode has `seasonId: 0`.
- Between seasons, the row marked `isCurrent` can be a `Pre-Season`. It has no leaderboard (`/v1/rank/top` answers 404), but its ranked games have its own `seasonId`, such as 42.

## Modes

| `matchingMode` | `matchingTeamMode` | Mode | Teams |
|---|---|---|---|
| 2 | 3 | Normal | 7 or 8 of 3 |
| 3 | 3 | Ranked | 7 or 8 of 3 |
| 6 | 4 | Cobalt Protocol | 2 of 4 |
| 9 | 1 | Lone Wolf, an event mode | 15 players |
| 13 | 3 | Rumble Out, an event mode | 5 of 3 |

- Rumble Out ran from November 12 to 18, 2026 (13.0). Event modes come and go, so handle a `matchingMode` you do not know.
- Older Cobalt Protocol records use `matchingMode` 4.
- Rank numbers mean different things per mode. Do not average them together.

## Game records

- `/v1/user/games/uid/{uid}` returns only that player's row for each game, about 10 games per page. Pass `next` (a game id) to get older games.
- A player's games come sorted by `gameId`, newest first. `next` is the id of the page's last game, and the next page starts below it. Any game id works: `next=<gameId + 1>` starts the page at that game, so you can jump to a point in the list in one request. A `next` larger than the newest game id returns the first page. Checked live in November 2026.
- `/v1/games/{gameId}` fetched while other teams are still playing has only the players who are done, and no row with `gameRank` 1. ERCraft stored such games as final, and team records showed teammates as missing until it fetched them again. Checked live on November 2, 2026: a normal game fetched 14 minutes after it started had 6 rows, all ranked 6th or 7th. Eight minutes later it had 15 rows and still no winner. A game with a rank 1 row is finished; the row count does not tell you, since finished games can have fewer than 24 rows. The reverse is not true: see AI players.
- `/v1/games/{gameId}` returns every player in the game.
- Games are kept for about 90 days; older games stop coming back. Each row's `expireDtm` is `startDtm` + `duration` + 90 days, within 4 seconds.
- `startDtm` and `expireDtm` are Korea time, `+0900`. Their milliseconds repeat the seconds (`15:30:59.059`) on every row checked, so do not read them as milliseconds.
- `duration`, `playTime` and `watchTime` are seconds. `totalTime` is `playTime + watchTime`.
- A row has about 340 fields: 330 in 12.7, and 13.0 added 12. The ones worth knowing are documented on [`UserGame`](https://adgjmptw2.github.io/eternal-return-api/interfaces/UserGame.html).

## AI players

- Games can include AI players. Some have rows like anyone else, with a nickname, a rank and RP: `isMLBot` and `mlbot` are true, and `preMade` is 0. They were in 103 of 403 normal games and 12 of 277 ranked games, up to an average of 2,657 RP, and in no Cobalt Protocol or Rumble Out game. Skip them when you count characters or win rates. `isMLBot` is only in `/v1/games` rows.
- Other AI players have no rows. A beginner game can come back with a single row.
- `botAdded` counts both kinds. `matchSize` is the number of other players.
- When an AI team wins, `victory` is 0 in every row. If that team has no rows, no row ever has rank 1: 8 of the 1,029 games.
- So a game is finished once a row has rank 1, or long enough after it started. The longest game took 27 minutes; `isGameFinished` waits an hour.

## Teams

- Members of a team share `gameRank`, `victory`, `teamKill` and `duration`. Of 5,903 teams where nobody gave up, one differed, by `duration`.
- A player who gave up (`giveUp: 1`) can keep values from when they left. One such row said 5th place, 14 team kills and 906 seconds; their teammates' rows said 3rd, 18 and 1,070. Take team values from a member who did not give up, with the longest `duration`. `groupTeams` does this.
- `preMade` is the size of the party the player queued with: 1 solo, 2 duo, 3 trio, up to 4 in Cobalt Protocol.
- `teamKill` is usually `teamElimination + teamDownCanEliminate + teamDownCanNotEliminate`. It was higher in 150 of 3,003 normal teams, 112 of 2,142 ranked teams and 9 of 624 Cobalt Protocol teams, by 5 at most, and in 36 of 180 Rumble Out teams, by 12 at most. These split fields exist only per team. The API has no per-player split of kills by type.

## RP

Checked on every ranked row of the sample (6,426 rows). In other modes `mmrBefore`, `mmrGain`, `mmrAfter` and `mmrAvg` are missing, and `mmrGainInGame`, `mmrLossEntryCost` and `rankPoint` are 0.

- `mmrAfter` is the RP after the game: `mmrBefore + mmrGainGambit` on every row but the 14 players who left. `mmrGain` is the same number, except in 19 games of 12.5 and 12.6 with `gambit: true`, where the change was doubled and `mmrGain` has the half.
- The change is `mmrGainInGame + mmrLossEntryCost`, plus or minus 50 when it crosses a tier line. Going up a tier (Silver to Gold, not Gold 4 to Gold 3) adds 50, going down takes 50. Every one of 156 rows that went up and 33 that went down has it, and no other row does.
- `rankPoint` is `mmrAfter` without that 50.
- A player who left (`giveUp: 1`) and paid the penalty has `mmrGain` and `mmrAfter` 0, and `mmrLossEntryCost` is twice the usual. Their RP is in `rankPoint`, which is `mmrBefore + mmrLossEntryCost`. It equaled the `mmrBefore` of their next ranked game in 11 of 12 cases; the twelfth was 30 lower. Not everyone with `giveUp: 1` pays it.
- Teammates of such a player can pay nothing: `mmrLossEntryCost` and `mmrGain` are 0, even when `mmrGainInGame` is not. 17 of 28 did.
- Teammates often earn different amounts: `mmrGainInGame` differed in 1,595 of 2,055 teams, by 5 in the middle case. The teammate with less RP earned more in 3,411 of 3,712 pairs that differed, and in every one of the 1,051 pairs that placed 1st or 2nd.
- `mmrLossEntryCost` is the entry cost, set by the division. It is 0 in Iron, then 10 at 600 RP up to 56 at 7,300, and 58 at 7,600 plus 2 for every 250 RP above. A party of two pays a little more. Seasons 12 and 13 have the same costs.
- `mmrAvg` is the average `mmrBefore` of every row, AI players included, rounded down (all 277 games).
- `rpAfter` was not in any response. Use `mmrAfter`.

`rpChange` gives the RP before and after with these exceptions handled.

## Tiers

The API gives RP and leaderboard rank, not tiers.

- Seasons 12 and 13: Mythril starts at 7,600 RP. Titan and Immortal need 8,300 RP and a leaderboard rank: Immortal is rank 1 to 300, Titan 301 to 1,000.
- For season 13, entry costs in 13.1 games change at every line from 600 to 7,600, and the 50 for a tier change fits every tier line. The 8,300 line leaves no trace in game records; the 13.0 and 13.1 patch notes do not change it.
- The patch notes say season rewards for Titan and Immortal go by the player's reward server (`rewardServerCode`). `serverRank` is the rank there.
- In seasons 10 and 11, players at or above the Mythril line (7,400 and 7,600 RP) got Titan or Immortal by rank alone.
- Most tiers below Mythril have divisions 4 to 1. Tables for seasons 1 to 13 are in [`rankTier`](https://adgjmptw2.github.io/eternal-return-api/functions/rankTier.html).
- Tier names in the localization file use the keys `IRON` … `METEORITE`, `MITHRIL`, `DEMIGOD`, `ETERNITY` and `UNRANK`. The official English names are Mythril, Titan and Immortal.

## Research Tasks (13.0 and 13.1)

Normal and ranked games of 13.0 and 13.1 have Research Tasks, and the 13.2 patch notes (November 26, 2026) end them.

- `experimentResultType` is the team's field: `Material`, `Energy` or `Biotechnology`. It is missing when the team cleared nothing, and in other modes.
- `questStepClear` lists cleared tasks in the order they were first cleared: `experimentGroupId`, `firstClearElapsedSeconds` and `clearCount`. It is an empty list when there are none.
- The first digit of `experimentGroupId` is the field. In 13.0, `x0001` is the first task and `x0002` the repeated one. In 13.1, `x0011` is the first and `x0021`, `x0022` and `x0023` the repeated ones.
- `crExperimentReward` and `crExperimentalCredit` are the credits from clearing tasks and from the field's buff.
- 13.0 also added `questResultType`, `questCompletedMaxRank` and four `...PaddleOccupationCount` fields. They were 0 in every row.

## Codes to names

| Field | Lookup |
|---|---|
| `characterNum` | `Character/Name/{code}` |
| `equipment` values | `Item/Name/{code}` |
| `traitFirstCore`, `traitFirstSub`, `traitSecondSub` | `Trait/Name/{code}` |
| `bestWeapon` | weapon type number, not an item code; see below |
| `tacticalSkillGroup` | through two data tables; see below |

- **`bestWeapon`** maps to a weapon type name, then to `WeaponType/{name}`. The numbers are 1 to 25 with no 12 or 17. The table is [`WEAPON_TYPES`](https://adgjmptw2.github.io/eternal-return-api/variables/WEAPON_TYPES.html).
- **`tacticalSkillGroup`**: find the `TacticalSkillSetGroup` row, take its `startCode`, find that `TacticalSkillSet` row and take `skillCode`. `skillCode` can be a string like `"4524001, 4524011"`; use the first number. Round it down to a multiple of 1,000 and look up `Skill/Group/Name/{code}`. If that key is missing, ERCraft tries the number at the end of the group's icon name.
- **`equipment`** is an object keyed by slot: `"0"` weapon, `"1"` chest, `"2"` head, `"3"` arm, `"4"` leg. Some rows lack a slot. Checked against the `ItemWeapon` and `ItemArmor` tables. Slot names are under `ArmorType/{Chest|Head|Arm|Leg}`.
- **`equipmentGrade`** uses the same keys: 1 Common, 2 Uncommon, 3 Rare, 4 Epic, 5 Legendary, 6 Mythic. All 58,728 items of the 13.0 and 13.1 games match their table grade. In data tables, `itemGrade` is a string like `Legend`; look it up with `ItemGrade/{itemGrade}`.
- The localization file keeps names of removed content. A name existing there does not mean the item is still in the game; check the current data table.
