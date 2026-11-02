# Eternal Return Open API: field guide

What the Open API actually returns, written while building [ERCraft](https://ercraft.net). Each point was checked against live responses or ERCraft's stored games. Where a number comes from a sample, the sample is named.

The client in this package already handles most of this. The guide is for anyone using the API directly, in any language.

[한국어](https://github.com/adgjmptw2/eternal-return-api/blob/main/GUIDE.ko.md)

## Requests

- Send the key in the `x-api-key` header.
- Every body has `{ code, message }`. Check `code`, not only the HTTP status: an error can come back with HTTP 200.
- A missing player or an expired game comes back as HTTP 200 with `{ "code": 404, "message": "Not Found" }`.
- The rate limit depends on your key. ERCraft runs at 1 request per second and retries 429 after 1.5 s, then 3 s.
- The localization endpoint `/v1/l10n/{language}` returns a URL to a text file. The file is not JSON: each line is `key┃value` (U+2503). ERCraft uses `Korean` and `English`.

## Players

- Nickname lookup returns `userId`. The docs call it `uid`. Player endpoints take this value.
- Lookup by `userNum` is retired.
- `/v1/rank/top/{seasonId}/{teamMode}` returns the whole list in one call: 1,001 players in October 2026. Rows have nicknames, not uids.

## Seasons

The `Season` table and the game use different numbers.

| `Season` row | `seasonID` | Players call it |
|---|---|---|
| `Season20` | 39 | Season 11 |
| `Season21` | 41 | Season 12 |

- From `Season10` on, the player season is the row number minus 9.
- Normal and Cobalt Protocol games have `seasonId: 0`. Only ranked games carry the season.
- Between seasons, the row marked `isCurrent` can be a `Pre-Season`, which has no ranked ladder.

## Game records

- `/v1/user/games/uid/{uid}` returns only that player's row for each game, about 10 games per page. Pass `next` (a game id) to get older games.
- A player's games come sorted by `gameId`, newest first. `next` is the id of the page's last game, and the next page starts below it. Any game id works: `next=<gameId + 1>` starts the page at that game, so you can jump to a point in the list in one request. A `next` larger than the newest game id returns the first page. Checked live in November 2026.
- `/v1/games/{gameId}` fetched while other teams are still playing has only the players who are done, and no row with `gameRank` 1. ERCraft stored such games as final, and team records showed teammates as missing until it fetched them again. Checked live on November 2, 2026: a normal game fetched 14 minutes after it started had 6 rows, all ranked 6th or 7th. Eight minutes later it had 15 rows and still no winner. A game with a rank 1 row is finished; the row count does not tell you, since finished games can have fewer than 24 rows.
- `/v1/games/{gameId}` returns every player in the game.
- Games are kept for about 90 days; older games stop coming back. Each row's `expireDtm` is `startDtm` + `duration` + 90 days, within 3 seconds on all 594 rows.
- `startDtm` and `expireDtm` are Korea time, `+0900`. Their milliseconds repeat the seconds (`15:30:59.059`) on every row checked, so do not read them as milliseconds.
- `duration`, `playTime` and `watchTime` are seconds. `totalTime` is `playTime + watchTime`.
- A row has about 320 fields. The ones worth knowing are documented on [`UserGame`](https://adgjmptw2.github.io/eternal-return-api/interfaces/UserGame.html).

## Teams

Checked on 30 live games (594 rows): 20 ranked, 4 normal, 6 Cobalt Protocol.

- Members of a team share `gameRank`, `victory`, `teamKill`, `duration` and, in ranked, `mmrGainInGame`.
- The one exception in the sample was a player who gave up (`giveUp: 1`). Their row said 5th place, 14 team kills and 906 seconds; their teammates' rows said 3rd, 18 and 1,070. Take team values from a member who did not give up, with the longest `duration`. `groupTeams` does this.
- `victory` is 1 exactly when `gameRank` is 1.
- `preMade` is the size of the party the player queued with: 1 solo, 2 duo, 3 trio. ERCraft's entry cost check relies on it. In this sample's squads, a team was 1-1-1 or 1-2-2.
- `teamKill` is usually `teamElimination + teamDownCanEliminate + teamDownCanNotEliminate`. In 6 of 194 teams with two or more players, all ranked, it was 1 to 3 higher. These split fields exist only per team. The API has no per-player split of kills by type.
- Cobalt Protocol is 4 vs 4, so `gameRank` is 1 or 2. Do not average it with other modes' ranks.

## RP

Checked on 459 ranked rows from 20 games; each line held on every row. In normal and Cobalt Protocol rows, `mmrBefore`, `mmrGain`, `mmrAfter` and `mmrAvg` are missing, and `mmrGainInGame`, `mmrLossEntryCost` and `rankPoint` are 0.

- `mmrAfter = mmrBefore + mmrGain`
- `mmrGain = mmrGainInGame + mmrLossEntryCost`. `mmrLossEntryCost` is the entry cost (-66 to -72 here; ERCraft has seen games with no entry cost).
- `rankPoint` equals `mmrAfter`.
- `mmrAvg` is the average `mmrBefore` of everyone in the game, rounded down (all 20 games).
- `rpAfter` was not in any response. Use `mmrAfter`.

## Tiers

The API gives RP and leaderboard rank, not tiers.

- Season 12: Mythril starts at 7,600 RP. Titan and Immortal need 8,300 RP and a leaderboard rank: Immortal is rank 1 to 300, Titan 301 to 1,000.
- In seasons 10 and 11, players at or above the Mythril line (7,400 and 7,600 RP) got Titan or Immortal by rank alone.
- Most tiers below Mythril have divisions 4 to 1. Tables for seasons 1 to 12 are in [`rankTier`](https://adgjmptw2.github.io/eternal-return-api/functions/rankTier.html).
- Tier names in the localization file use the keys `IRON` … `METEORITE`, `MITHRIL`, `DEMIGOD`, `ETERNITY` and `UNRANK`. The official English names are Mythril, Titan and Immortal.

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
- **`equipmentGrade`** uses the same keys. Seen values: 1 Common, 4 Epic, 5 Legendary, 6 Mythic. In data tables, `itemGrade` is a string like `Legend`; look it up with `ItemGrade/{itemGrade}`.
- The localization file keeps names of removed content. A name existing there does not mean the item is still in the game; check the current data table.
