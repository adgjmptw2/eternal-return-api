# eternal-return-api (Python)

[이터널 리턴 Open API](https://developer.eternalreturn.io)용 비공식 Python 클라이언트입니다. 동기 클라이언트와 asyncio 클라이언트가 있습니다.

이터널 리턴 전적 사이트 [ERCraft](https://ercraft.net)에서 쓰는 코드를 옮겼습니다. 같은 이름의 [npm 패키지](https://www.npmjs.com/package/eternal-return-api)의 Python 버전이고, 단순 요청 말고도 전적 사이트나 봇에 필요한 것들을 넣었습니다.

- **새 경기만 받기.** `sync_user_games`는 이미 가진 최신 경기에서 멈춥니다. 새 경기가 몇 판뿐이면 요청 1번으로 끝납니다.
- **끝나지 않은 경기.** 다른 팀이 아직 게임 중일 때 받은 경기에는 1등이 없습니다. `is_game_finished`로 알 수 있고, `get_game`은 이런 경기를 캐시하지 않습니다.
- **플레이어 감시.** `watch_games`는 플레이어가 경기를 끝내면 알려 줍니다. 디스코드 봇 알림에 쓸 수 있습니다.
- 요청 속도 제한, 429 재시도, HTTP 200 안의 오류 코드 처리.
- 팀 묶기(`group_teams`), RP로 티어 계산(`rank_tier`), 공식 번역 파일로 실험체·아이템·특성·무기·전술 스킬 이름 찾기.

[English](https://github.com/adgjmptw2/eternal-return-api/blob/main/python/README.md) · [실전 가이드](https://github.com/adgjmptw2/eternal-return-api/blob/main/GUIDE.ko.md)

Python 3.10 이상. 의존성은 [httpx](https://www.python-httpx.org) 하나입니다. 경기 행은 API 필드 이름 그대로인 dict이고, `TypedDict`로 타입을 붙였습니다.

## 설치

```sh
pip install eternal-return-api
```

## 사용

```python
import os
from eternal_return_api import ErClient, group_teams, rank_tier, summarize_games

with ErClient(os.environ["ER_API_KEY"]) as er:
    user = er.get_user_by_nickname("닉네임")
    if user is None:
        raise SystemExit("없는 플레이어")

    seasons = er.get_seasons()
    season_id = seasons.current_ranked_season_id
    rank = er.get_user_rank(user["uid"], season_id)

    names = er.get_names("Korean")
    if rank:
        tier = rank_tier(rank["mmr"], rank=rank["rank"], season=seasons.player_season_of(season_id))
        print(names.tier(tier.tier), tier.division)  # "다이아몬드" 2

    games = list(er.iter_user_games(user["uid"], max_pages=2))
    for game in games:
        print(names.character(game["characterNum"]), names.weapon(game.get("bestWeapon")), game["gameRank"])

    summary = summarize_games(games)
    teams = group_teams(er.get_game(games[0]["gameId"]))
```

`AsyncErClient`는 같은 메서드를 코루틴으로 제공합니다.

```python
from eternal_return_api import AsyncErClient

async with AsyncErClient(api_key) as er:
    user = await er.get_user_by_nickname("닉네임")
    async for game in er.iter_user_games(user["uid"], max_pages=1):
        ...
```

API 키는 [developer.eternalreturn.io](https://developer.eternalreturn.io)에서 받습니다. 키는 서버에만 두세요.

## 새 경기만 받기

전적 사이트나 봇은 같은 플레이어를 계속 다시 조회합니다. 매번 목록을 처음부터 넘기면 요청이 낭비됩니다.

```python
from eternal_return_api import is_game_finished

result = er.sync_user_games(uid, after=saved_newest)  # 몇 판이면 요청 1번
db.save_games(result.games)
db.save_newest(uid, result.newest_game_id)

# 다른 팀이 아직 게임 중일 때 받은 경기에는 1등이 없습니다.
players = er.get_game(result.games[0]["gameId"])
if is_game_finished(players):
    db.save_game(players)
```

- 경기 목록은 `gameId` 내림차순이고, API의 `next` 커서가 경기 ID입니다. `after`는 가진 경기에서 멈추고, `before`는 지정한 경기 바로 아래부터 요청 1번에 시작합니다.
- `max_pages`를 주면 `after`에 닿기 전에 멈출 수 있습니다. 이때 `rest`가 오니 `rest`가 더 안 올 때까지 `er.sync_user_games(uid, **result.rest)`를 부르세요. 그 전까지 `newest_game_id`는 예전 `after` 그대로라서, 저장해도 경기를 건너뛰지 않습니다.
- `after` 없이 부르면 목록 전체(약 90일)를 읽습니다. 처음 받을 때는 `since`나 `max_pages`를 주세요.

ERCraft는 경기 도중에 받은 기록을 완성본으로 저장해서, 팀원 기록이 없다고 나온 적이 있습니다. 실제 API로 확인해 보니, 시작한 지 14분 된 일반 경기는 6행뿐이었고 8분 뒤에는 15행이었는데 여전히 1등이 없었습니다. 끝난 경기에는 `gameRank`가 1인 행이 있습니다. 끝난 경기도 24행보다 적을 수 있어서 행 수로는 알 수 없습니다.

## 플레이어 감시

```python
from eternal_return_api import AsyncErClient, GameEvent

watched = {uid}

async def post_results(er: AsyncErClient) -> None:
    async for event in er.watch_games(lambda: watched, interval=60):
        if isinstance(event, GameEvent):
            print(event.uid, event.game["gameRank"], event.game["playerKill"])
        else:
            print("실패", event.uid, event.error)
```

- 첫 바퀴는 플레이어마다 최신 경기만 기억하고, 지난 경기는 알리지 않습니다. 재시작 후 이어서 보려면 마지막으로 처리한 경기를 `after={uid: game_id}`로 넘기세요. `after`는 플레이어가 처음 나타날 때 읽으니, 봇에서 플레이어를 추가하기 전에 값을 넣어 두면 됩니다.
- 플레이어마다 오래된 경기부터 오고, 지난 바퀴 이후 몇 판을 했든 빠뜨리지 않습니다.
- 새 경기가 없으면 한 바퀴에 플레이어당 요청 1번이고, 캐시를 쓰지 않습니다. 기본값인 초당 1회면 60명 한 바퀴에 1분이 걸립니다.
- 한 플레이어의 요청이 실패하면 `ErrorEvent`가 옵니다. 감시는 계속되고 다음 바퀴에 다시 시도합니다.
- `uids`에 list나 set을 넣으면 매 바퀴 다시 읽고, 함수를 넣으면 매 바퀴 호출합니다. 빠졌다가 다시 들어온 플레이어는 처음부터 다시 봅니다.
- 멈추려면 태스크를 취소하거나 `stop=asyncio.Event()`를 넘기고 set하세요. 동기 클라이언트는 `threading.Event`를 받습니다.
- `event.game`은 그 플레이어 본인의 행입니다. 다른 팀은 아직 게임 중일 수 있으니, `get_game` 결과를 저장하기 전에 `is_game_finished`로 확인하세요.

## API

| 메서드 | 없을 때 |
|---|---|
| `get_user_by_nickname(nickname)` | `None` |
| `get_user_games(uid, next=None)` | 빈 페이지 |
| `iter_user_games(uid, *, after, before, since, max_pages)` | 끝남 |
| `sync_user_games(uid, *, after, before, since, max_pages)` | 경기 없음 |
| `watch_games(uids, *, interval, after, stop)` | 계속 감시 |
| `get_game(game_id)` | `[]` |
| `get_user_rank(uid, season_id, team_mode=3)` | `None` |
| `get_top_ranks(season_id, team_mode=3)` | `[]` |
| `get_user_stats(uid, season_id, matching_mode=3)` | `[]` |
| `get_data(meta_type)` | 예외 |
| `get_seasons()` | 예외 |
| `get_l10n(language)`, `get_names(language)` | 예외 |
| `request(path)` | 예외 |

API 오류와 시간 초과는 `status`, `api_code`가 있는 `ErApiError`로 올라옵니다. 닉네임 조회가 다른 플레이어를 돌려주면 `ErNicknameMismatchError`입니다. httpx의 네트워크 오류는 그대로 올라옵니다.

### 옵션

```python
ErClient(
    api_key,
    requests_per_second=1,   # 키 한도에 맞추세요
    burst=1,
    timeout=9.0,             # 요청당 초
    retry_delays=(1.5, 3.0), # 429 뒤 재시도 전 대기, ()이면 재시도 안 함
    cache=None,              # MemoryCache() 또는 직접 만든 저장소
    cache_ttl=None,          # 종류별 초, 예: {"userGames": 30}
    http_client=None,        # 직접 만든 httpx.Client
)
```

### 캐시

기본은 꺼져 있습니다. `MemoryCache()`는 메모리에 저장합니다. `get(key)`, `set(key, value, ttl)`이 있는 객체면 무엇이든 되고, 비동기 클라이언트는 코루틴 메서드도 받습니다(비동기 Redis 클라이언트 등). 기본 보관 시간은 닉네임 10분, 경기 목록·랭크 1분, 상위 랭킹·통계 5분, 경기·데이터 표 1시간입니다. 캐시가 실패하면 없는 것으로 칩니다. 비동기 클라이언트에서는 같은 경로를 동시에 부르면 요청 하나를 같이 씁니다.

## API 키 없이 테스트

`eternal_return_api.testing`은 실제 API 응답과 같은 모양으로 지어낸 샘플을 돌려줍니다. 랭크 2판의 참가자 전원, 상위 랭킹, 필요한 데이터 표와 번역 키가 들어 있습니다. API에서 가져온 것은 없고 이름, 코드, 숫자는 모두 지어낸 값입니다. 필드 이름과 필드 사이의 관계는 실전 가이드에 적은 실제 API 그대로입니다.

```python
from eternal_return_api.testing import SAMPLE_NICKNAME, sample_client

er = sample_client()
user = er.get_user_by_nickname(SAMPLE_NICKNAME)
```

`async_sample_client()`는 비동기 버전이고, `sample_transport()`는 둘이 쓰는 httpx transport입니다.

## 넣지 않은 것

- 429 말고 다른 네트워크 오류 재시도.
- 경기 저장. 경기는 약 90일 뒤 사라지니 직접 DB에 저장하세요.
- 리플레이 파일.

## 라이선스

MIT 라이선스는 이 라이브러리의 코드에만 적용됩니다. 게임 데이터, 텍스트 등 리소스의 권리는 님블뉴런에 있으며 이 라이선스와 별개입니다. 님블뉴런과 관계없는 비공식 프로젝트입니다.
