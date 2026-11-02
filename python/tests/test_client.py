from __future__ import annotations

import asyncio
from typing import Any

import httpx
import pytest
from conftest import Clock, FakeApi, make_async_client, make_client

from eternal_return_api import (
    AsyncErClient,
    ErApiError,
    ErClient,
    ErNicknameMismatchError,
    MemoryCache,
    RateLimiter,
    SeasonCatalog,
    parse_l10n,
)


def ok(**body: Any) -> httpx.Response:
    return httpx.Response(200, json={"code": 200, "message": "Success", **body})


def test_sends_the_key_and_returns_the_body() -> None:
    api = FakeApi(routes={"/v1/x": ok(a=1)})
    assert make_client(api).request("/v1/x")["a"] == 1
    assert api.headers[0]["x-api-key"] == "test-key"


def test_error_code_inside_http_200_raises() -> None:
    api = FakeApi(routes={"/v1/x": httpx.Response(200, json={"code": 403, "message": "Forbidden"})})
    with pytest.raises(ErApiError) as info:
        make_client(api).request("/v1/x")
    assert info.value.status == 403 and info.value.api_code == 403


def test_http_error_and_non_json() -> None:
    api = FakeApi(routes={"/v1/a": httpx.Response(502, text="<html>"), "/v1/b": httpx.Response(200, text="<html>")})
    er = make_client(api)
    with pytest.raises(ErApiError) as a:
        er.request("/v1/a")
    assert a.value.status == 502 and a.value.api_code is None
    with pytest.raises(ErApiError) as b:
        er.request("/v1/b")
    assert b.value.status == 502


def test_retries_429_with_the_configured_delays_then_gives_up(clock: Clock) -> None:
    n = {"calls": 0}

    def route() -> httpx.Response:
        n["calls"] += 1
        if n["calls"] < 3:
            return httpx.Response(429, json={"code": 429, "message": "Too Many"})
        return ok()

    make_client(FakeApi(routes={"/v1/x": route}), clock).request("/v1/x")
    assert clock.sleeps == [1.5, 3.0]

    always = FakeApi(routes={"/v1/x": lambda: httpx.Response(429, json={"code": 429, "message": "x"})})
    with pytest.raises(ErApiError) as info:
        make_client(always, retry_delays=()).request("/v1/x")
    assert info.value.status == 429 and len(always.calls) == 1


def test_timeout_becomes_504() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        raise httpx.ReadTimeout("slow", request=request)

    er = ErClient("k", http_client=httpx.Client(transport=httpx.MockTransport(handler)))
    with pytest.raises(ErApiError) as info:
        er.request("/v1/x")
    assert info.value.status == 504


@pytest.mark.parametrize("path", ["v1/x", "//evil.example/x", "@evil.example/x"])
def test_paths_that_could_leak_the_key_are_refused(path: str) -> None:
    api = FakeApi()
    with pytest.raises(ValueError):
        make_client(api).request(path)
    assert api.calls == []


def test_nickname_lookup() -> None:
    api = FakeApi(
        routes={
            "/v1/user/nickname?query=Ab%20C": ok(user={"userId": "u1", "nickname": "ab c"}),
            "/v1/user/nickname?query=other": ok(user={"userId": "u2", "nickname": "someone"}),
        }
    )
    er = make_client(api)
    assert er.get_user_by_nickname("Ab C") == {"uid": "u1", "nickname": "ab c"}
    assert er.get_user_by_nickname("missing") is None
    with pytest.raises(ErNicknameMismatchError):
        er.get_user_by_nickname("other")


def test_full_width_nickname_matches() -> None:
    api = FakeApi(routes={"/v1/user/nickname?query=%EF%BC%A1": ok(user={"uid": "u", "nickname": "A"})})
    assert make_client(api).get_user_by_nickname("Ａ") == {"uid": "u", "nickname": "A"}


def test_not_found_gives_empty_values() -> None:
    er = make_client(FakeApi())
    assert er.get_user_games("nobody").games == []
    assert er.get_game(1) == []
    assert er.get_user_rank("u", 41) is None
    assert er.get_top_ranks(41) == []
    assert er.get_user_stats("u", 41) == []
    with pytest.raises(ErApiError):
        er.get_data("Nothing")


def test_paging_cursor_loop_is_caught() -> None:
    api = FakeApi(
        routes={
            "/v1/user/games/uid/u": ok(userGames=[{"gameId": 9}], next=9),
            "/v1/user/games/uid/u?next=9": ok(userGames=[{"gameId": 8}], next=9),
        }
    )
    with pytest.raises(ErApiError):
        list(make_client(api).iter_user_games("u"))


def test_cache_hit_and_broken_cache(clock: Clock) -> None:
    api = FakeApi(routes={"/v1/rank/top/41/3": ok(topRanks=[{"nickname": "a", "rank": 1, "mmr": 1}])})
    er = make_client(api, clock, cache=MemoryCache(clock=clock))
    er.get_top_ranks(41)
    er.get_top_ranks(41)
    assert len(api.calls) == 1
    clock.now += 301
    er.get_top_ranks(41)
    assert len(api.calls) == 2

    class Broken:
        def get(self, key: str) -> str | None:
            raise RuntimeError("down")

        def set(self, key: str, value: str, ttl: float) -> None:
            raise RuntimeError("down")

    assert make_client(api, cache=Broken()).get_top_ranks(41)[0]["rank"] == 1


def test_async_cache_accepts_coroutine_stores() -> None:
    api = FakeApi(routes={"/v1/rank/top/41/3": ok(topRanks=[{"rank": 1}])})
    store: dict[str, str] = {}

    class AsyncStore:
        async def get(self, key: str) -> str | None:
            return store.get(key)

        async def set(self, key: str, value: str, ttl: float) -> None:
            store[key] = value

    async def main() -> None:
        er = make_async_client(api, cache=AsyncStore())
        await er.get_top_ranks(41)
        await asyncio.sleep(0)
        await er.get_top_ranks(41)

    asyncio.run(main())
    assert len(api.calls) == 1 and "er:/v1/rank/top/41/3" in store


def test_seasons_and_l10n() -> None:
    rows = [
        {"seasonID": 39, "seasonName": "Season20", "isCurrent": 0},
        {"seasonID": 40, "seasonName": "Pre-Season21", "isCurrent": 1},
    ]
    api = FakeApi(
        routes={
            "/v2/data/Season": ok(data=rows),
            "/v1/l10n/Korean": ok(data={"l10Path": "https://cdn.example/ko.txt"}),
            "/ko.txt": httpx.Response(200, text="Character/Name/1┃재키\r\nbad line\n"),
        }
    )
    er = make_client(api)
    seasons = er.get_seasons()
    er.get_seasons()
    assert seasons.current_ranked_season_id == 39
    assert seasons.player_season_of(39) == 11
    assert api.calls.count("/v2/data/Season") == 1
    assert er.get_l10n("Korean") == {"Character/Name/1": "재키"}
    # The CDN gets no key.
    assert "x-api-key" not in api.headers[api.calls.index("/ko.txt")]


def test_season_catalog_and_parse_l10n() -> None:
    catalog = SeasonCatalog([{"seasonID": 41, "seasonName": "Season21", "isCurrent": 1}])
    assert catalog.current_ranked_season_id == 41 and catalog.season_id_of(12) == 41
    assert parse_l10n("a┃b\nc┃ d \n┃x") == {"a": "b", "c": "d"}


def test_rate_limiter_spaces_requests() -> None:
    clock = Clock()
    limiter = RateLimiter(1.0, 1, clock, clock.sleep)
    for _ in range(3):
        limiter.acquire()
    assert clock.now == pytest.approx(2.0)


def test_options_are_checked() -> None:
    with pytest.raises(ValueError):
        ErClient("")
    with pytest.raises(ValueError):
        ErClient("k", requests_per_second=0)
    with pytest.raises(ValueError):
        ErClient("k", burst=0)


def test_redirects_are_not_followed() -> None:
    api = FakeApi(routes={"/v1/x": httpx.Response(302, headers={"location": "https://evil.example/x"})})
    http = httpx.Client(transport=httpx.MockTransport(api.handle), follow_redirects=True)
    with pytest.raises(ErApiError) as info:
        ErClient("k", http_client=http).request("/v1/x")
    assert info.value.status == 302 and api.calls == ["/v1/x"]


def test_retry_after_is_honoured_up_to_a_minute(clock: Clock) -> None:
    n = {"calls": 0}

    def route() -> httpx.Response:
        n["calls"] += 1
        if n["calls"] == 1:
            return httpx.Response(429, headers={"retry-after": "5"}, json={"code": 429, "message": "x"})
        if n["calls"] == 2:
            return httpx.Response(429, headers={"retry-after": "3600"}, json={"code": 429, "message": "x"})
        return ok()

    make_client(FakeApi(routes={"/v1/x": route}), clock).request("/v1/x")
    assert clock.sleeps == [5.0, 60.0]


def test_cache_keys_include_a_custom_base_url() -> None:
    cache = MemoryCache()
    api = FakeApi(routes={"/v1/rank/top/41/3": ok(topRanks=[{"rank": 1}])})
    make_client(api, cache=cache).get_top_ranks(41)
    make_client(api, cache=cache, base_url="https://test.example").get_top_ranks(41)
    assert len(api.calls) == 2


def test_seasons_skip_the_response_cache(clock: Clock) -> None:
    rows = [{"seasonID": 41, "seasonName": "Season21", "isCurrent": 1}]
    api = FakeApi(routes={"/v2/data/Season": lambda: ok(data=rows)})
    er = make_client(api, clock, cache=MemoryCache(clock=clock))
    er.get_seasons()
    clock.now += 301
    er.get_seasons()
    assert api.calls.count("/v2/data/Season") == 2


def test_l10n_is_read_only_and_loaded_once_across_threads() -> None:
    import threading

    api = FakeApi(
        routes={
            "/v1/l10n/Korean": ok(data={"l10Path": "https://cdn.example/ko.txt"}),
            "/ko.txt": httpx.Response(200, text="Character/Name/1┃재키\n"),
            "/v2/data/TacticalSkillSetGroup": ok(data=[]),
            "/v2/data/TacticalSkillSet": ok(data=[]),
        }
    )
    er = make_client(api)
    threads = [threading.Thread(target=er.get_names, args=("Korean",)) for _ in range(8)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    assert api.calls.count("/ko.txt") == 1 and api.calls.count("/v2/data/TacticalSkillSet") == 1
    table = er.get_l10n("Korean")
    with pytest.raises(TypeError):
        table["x"] = "y"  # type: ignore[index]


@pytest.mark.parametrize("rps", [float("inf"), float("nan"), -1])
def test_bad_rates_are_refused(rps: float) -> None:
    with pytest.raises(ValueError):
        ErClient("k", requests_per_second=rps)


def test_aclose_cancels_running_requests() -> None:
    started = asyncio.Event()

    async def main() -> None:
        async def slow(request: httpx.Request) -> httpx.Response:
            started.set()
            await asyncio.sleep(10)
            return ok()

        er = AsyncErClient("k", http_client=httpx.AsyncClient(transport=httpx.MockTransport(slow)), cache=MemoryCache())
        caller = asyncio.ensure_future(er.request("/v1/rank/top/41/3"))
        await started.wait()
        caller.cancel()
        await asyncio.wait_for(er.aclose(), 2)
        assert not er._tasks

    asyncio.run(main())
