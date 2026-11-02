# eternal-return-api (Python)

Unofficial Python client for the [Eternal Return Open API](https://developer.eternalreturn.io), with sync and asyncio clients.

The code comes from [ERCraft](https://ercraft.net), an Eternal Return stats site that runs on this API. It is the Python version of the [npm package](https://www.npmjs.com/package/eternal-return-api) of the same name, and handles what stats sites and bots need beyond plain requests:

- **New games only.** `sync_user_games` stops at the newest game you have, so a player with a few new games costs one request.
- **Unfinished games.** A game fetched while other teams are still playing has no winner yet. `is_game_finished` tells you, and `get_game` does not cache it.
- **Watching players.** `watch_games` reports games as players finish them, for Discord bots and alerts.
- Rate limiting, 429 retries, and error codes inside HTTP 200 responses.
- Teams (`group_teams`), tiers from RP (`rank_tier`), and names for characters, items, traits, weapons and tactical skills from the official localization file.

[한국어](https://github.com/adgjmptw2/eternal-return-api/blob/main/python/README.ko.md) · [Field guide](https://github.com/adgjmptw2/eternal-return-api/blob/main/GUIDE.md)

Python 3.10+. One dependency: [httpx](https://www.python-httpx.org). Rows are plain dicts with the API's own field names, typed with `TypedDict`.

## Install

```sh
pip install eternal-return-api
```

## Use

```python
import os
from eternal_return_api import ErClient, group_teams, rank_tier, summarize_games

with ErClient(os.environ["ER_API_KEY"]) as er:
    user = er.get_user_by_nickname("Nickname")
    if user is None:
        raise SystemExit("No such player")

    seasons = er.get_seasons()
    season_id = seasons.current_ranked_season_id
    rank = er.get_user_rank(user["uid"], season_id)

    names = er.get_names("English")
    if rank:
        tier = rank_tier(rank["mmr"], rank=rank["rank"], season=seasons.player_season_of(season_id))
        print(tier.name)  # "Diamond 2"

    games = list(er.iter_user_games(user["uid"], max_pages=2))
    for game in games:
        print(names.character(game["characterNum"]), names.weapon(game.get("bestWeapon")), game["gameRank"])

    summary = summarize_games(games)
    teams = group_teams(er.get_game(games[0]["gameId"]))
```

`AsyncErClient` has the same methods as coroutines:

```python
from eternal_return_api import AsyncErClient

async with AsyncErClient(api_key) as er:
    user = await er.get_user_by_nickname("Nickname")
    async for game in er.iter_user_games(user["uid"], max_pages=1):
        ...
```

Get an API key at [developer.eternalreturn.io](https://developer.eternalreturn.io). Keep it on your server.

## Keeping up with new games

Stats sites and bots fetch the same players again and again, so paging through the whole list each time wastes requests.

```python
from eternal_return_api import is_game_finished

result = er.sync_user_games(uid, after=saved_newest)  # one request when there are a few
db.save_games(result.games)
db.save_newest(uid, result.newest_game_id)

# A game fetched while other teams are still playing has no winner yet.
players = er.get_game(result.games[0]["gameId"])
if is_game_finished(players):
    db.save_game(players)
```

- A player's games are sorted by `gameId`, newest first, and the API's `next` cursor is a game id. `after` stops at a game you have; `before` starts below a given game in one request.
- With `max_pages`, `sync_user_games` may stop before reaching `after`. It then sets `rest`: call `er.sync_user_games(uid, **result.rest)` until no `rest` is returned. Until then `newest_game_id` stays at the old `after`, so saving it never skips games.
- Without `after`, it reads the whole list (about 90 days). Pass `since` or `max_pages` for a first sync.

ERCraft once stored games fetched mid-game as final, and team records showed teammates as missing. On the live API, a normal game fetched 14 minutes after it started had 6 rows; eight minutes later it had 15 and still no winner. A finished game has a row with `gameRank` 1. Row count alone is not enough: finished games can have fewer than 24 rows.

## Watching players

```python
import asyncio
from eternal_return_api import AsyncErClient, GameEvent

watched = {uid}

async def post_results(er: AsyncErClient) -> None:
    async for event in er.watch_games(lambda: watched, interval=60):
        if isinstance(event, GameEvent):
            print(event.uid, event.game["gameRank"], event.game["playerKill"])
        else:
            print("failed", event.uid, event.error)
```

- The first round only notes each player's newest game; past games are not reported. To resume after a restart, pass `after={uid: game_id}` with the last game you handled.
- Each round costs one request per player when nothing is new, and skips the cache. At the default 1 request per second, 60 players take a minute per round.
- A failed request for one player comes as an `ErrorEvent`. Watching goes on, and the next round tries again.
- `uids` may be a function: it is called before every round, so you can add and remove players. A removed player starts fresh when added back.
- Stop by cancelling the task, or pass `stop=asyncio.Event()` and set it. The sync client takes a `threading.Event`.
- `event.game` is the player's own row. Other teams may still be playing, so check `is_game_finished` before storing `get_game` results.

## API

| Method | Returns when not found |
|---|---|
| `get_user_by_nickname(nickname)` | `None` |
| `get_user_games(uid, next=None)` | empty page |
| `iter_user_games(uid, *, after, before, since, max_pages)` | ends |
| `sync_user_games(uid, *, after, before, since, max_pages)` | no games |
| `watch_games(uids, *, interval, after, max_pages, stop)` | keeps watching |
| `get_game(game_id)` | `[]` |
| `get_user_rank(uid, season_id, team_mode=3)` | `None` |
| `get_top_ranks(season_id, team_mode=3)` | `[]` |
| `get_user_stats(uid, season_id, matching_mode=3)` | `[]` |
| `get_data(meta_type)` | raises |
| `get_seasons()` | raises |
| `get_l10n(language)`, `get_names(language)` | raises |
| `request(path)` | raises |

API errors and timeouts raise `ErApiError` with `status` and `api_code`. A nickname lookup that returns a different player raises `ErNicknameMismatchError`. Network errors from httpx are passed through.

### Options

```python
ErClient(
    api_key,
    requests_per_second=1,   # match your key's limit
    burst=1,
    timeout=9.0,             # seconds, per request
    retry_delays=(1.5, 3.0), # waits before each retry after HTTP 429; () disables
    cache=None,              # MemoryCache() or your own store
    cache_ttl=None,          # seconds per kind, e.g. {"userGames": 30}
    http_client=None,        # your own httpx.Client
)
```

### Cache

Off by default. `MemoryCache()` keeps responses in memory; any object with `get(key)` and `set(key, value, ttl)` works, and the async client also accepts coroutine methods (for example an async Redis client). Default times: nickname 10 minutes, user games and rank 1 minute, top ranks and stats 5 minutes, games and data tables 1 hour. A failing cache counts as a miss. In the async client, concurrent calls for the same cached path share one request.

## Testing without an API key

`eternal_return_api.testing` serves made-up responses in the shape of the real API: two ranked games with every player, the leaderboard, and the tables and localization keys they need. Nothing in them comes from the API: names, codes and numbers are invented. The field names and the relations between fields follow the real API, as described in the field guide.

```python
from eternal_return_api.testing import SAMPLE_NICKNAME, sample_client

er = sample_client()
user = er.get_user_by_nickname(SAMPLE_NICKNAME)
```

`async_sample_client()` is the async version, and `sample_transport()` is the httpx transport behind both.

## Not included

- Retrying network errors other than 429.
- Storing games. Games expire after about 90 days, so keep them in your own database.
- Replay files.

## License

MIT, for the code of this library only. Game data, text and other resources belong to Nimble Neuron and are not covered by this license. This is an unofficial project, not affiliated with or endorsed by Nimble Neuron.
