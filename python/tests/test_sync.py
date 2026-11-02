from __future__ import annotations

import asyncio
import threading
from collections.abc import Callable
from typing import Any

import httpx
import pytest
from conftest import Clock, FakeApi, make_async_client, make_client, row

from eternal_return_api import (
    ErClient,
    ErrorEvent,
    GameEvent,
    MemoryCache,
    is_game_finished,
)


def ids(games: list[Any]) -> list[int]:
    return [g["gameId"] for g in games]


def test_iter_stops_at_after_without_reading_the_next_page() -> None:
    api = FakeApi(ids=[10, 9, 8, 7, 6, 5, 4])
    assert ids(list(make_client(api).iter_user_games("u", after=8))) == [10, 9]
    assert api.calls == ["/v1/user/games/uid/u"]


def test_before_starts_below_that_game_in_one_request() -> None:
    api = FakeApi(ids=[10, 9, 8, 7, 6, 5, 4])
    assert ids(list(make_client(api).iter_user_games("u", before=8, max_pages=1))) == [7, 6, 5]
    assert api.calls == ["/v1/user/games/uid/u?next=8"]


def test_sync_returns_new_games_and_the_id_to_save() -> None:
    api = FakeApi(ids=[10, 9, 8, 7, 6, 5, 4])
    er = make_client(api)
    first = er.sync_user_games("u", after=5)
    assert ids(first.games) == [10, 9, 8, 7, 6]
    assert first.newest_game_id == 10
    assert first.rest is None

    none = er.sync_user_games("u", after=10)
    assert none.games == [] and none.newest_game_id == 10

    api.ids += [11, 12]
    later = er.sync_user_games("u", after=10)
    assert ids(later.games) == [12, 11] and later.newest_game_id == 12


def test_sync_with_no_games_keeps_after() -> None:
    er = make_client(FakeApi(ids=[]))
    assert er.sync_user_games("u", after=7).newest_game_id == 7
    assert er.sync_user_games("u").newest_game_id is None


def test_sync_rest_fills_the_gap_and_never_moves_the_saved_id_early() -> None:
    er = make_client(FakeApi(ids=list(range(10, 0, -1))))
    first = er.sync_user_games("u", after=2, max_pages=1)
    assert ids(first.games) == [10, 9, 8]
    # Saving 10 now would skip 7 to 3 if the process stopped here.
    assert first.newest_game_id == 2
    assert first.rest == {"after": 2, "before": 8, "since": None, "max_pages": 1, "resume_newest_game_id": 10}

    games = list(first.games)
    last = first
    while last.rest:
        last = er.sync_user_games("u", **last.rest)
        games += last.games
        if last.rest:
            assert last.newest_game_id == 2
    assert ids(games) == [10, 9, 8, 7, 6, 5, 4, 3]
    assert last.newest_game_id == 10


@pytest.mark.parametrize("max_pages", [0, -1, 1.5, True])
def test_max_pages_must_be_a_whole_number(max_pages: Any) -> None:
    er = make_client(FakeApi(ids=[1]))
    with pytest.raises(ValueError):
        er.sync_user_games("u", max_pages=max_pages)
    with pytest.raises(ValueError):
        er.iter_user_games("u", max_pages=max_pages)


def test_since_stops_at_older_games() -> None:
    from datetime import datetime, timedelta, timezone

    api = FakeApi(ids=[10, 9, 8, 7])
    since = datetime(2026, 10, 1, tzinfo=timezone(timedelta(hours=9))) + timedelta(minutes=8)
    assert ids(make_client(api).sync_user_games("u", since=since).games) == [10, 9, 8]


def test_is_game_finished_looks_for_the_winner() -> None:
    assert not is_game_finished([])
    assert not is_game_finished([row(1, gameRank=5), row(1, gameRank=2)])
    assert is_game_finished([row(1, gameRank=5), row(1, gameRank=1)])


def test_get_game_does_not_cache_an_unfinished_game() -> None:
    finished = False

    def game() -> list[dict[str, Any]]:
        return [row(7, gameRank=1), row(7, gameRank=4)] if finished else [row(7, gameRank=4)]

    api = FakeApi(games={"7": game})
    er = make_client(api, cache=MemoryCache())
    assert len(er.get_game(7)) == 1
    finished = True
    assert len(er.get_game(7)) == 2
    assert len(er.get_game(7)) == 2
    assert api.calls.count("/v1/games/7") == 2


def test_request_does_not_cache_an_unfinished_game_either() -> None:
    api = FakeApi(games={"7": lambda: [row(7, gameRank=4)]})
    er = make_client(api, cache=MemoryCache())
    er.request("/v1/games/7")
    er.get_game(7)
    assert len(api.calls) == 2


def test_get_game_ignores_an_unfinished_game_in_a_shared_cache() -> None:
    cache = MemoryCache()
    cache.set("er:/v1/games/7", '{"code":200,"message":"ok","userGames":[{"gameId":7,"gameRank":4}]}', 60)
    api = FakeApi(games={"7": lambda: [row(7, gameRank=1), row(7, gameRank=4)]})
    assert len(make_client(api, cache=cache).get_game(7)) == 2


class Rounds:
    """Drives a sync watcher: each pause between rounds runs ``between(round)``;
    after ``total`` rounds it sets ``stop``."""

    def __init__(self, total: int, between: Callable[[int], None] = lambda r: None) -> None:
        self.total = total
        self.between = between
        self.round = 0
        self.stop = threading.Event()
        self.clock = Clock()

    def sleep(self, seconds: float) -> None:
        self.clock.now += seconds
        self.round += 1
        if self.round >= self.total:
            self.stop.set()
        else:
            self.between(self.round)

    def client(self, api: FakeApi) -> ErClient:
        return make_client(api, self.clock, sleep=self.sleep)


def watch(rounds: Rounds, api: FakeApi, uids: Any, **options: Any) -> list[tuple[Any, ...]]:
    events: list[tuple[Any, ...]] = []
    for e in rounds.client(api).watch_games(uids, stop=rounds.stop, **options):
        if isinstance(e, GameEvent):
            events.append((rounds.round, "game", e.uid, e.game["gameId"]))
        else:
            events.append((rounds.round, "error", e.uid))
    return events


def test_watch_reports_only_new_games_oldest_first() -> None:
    api = FakeApi(ids={"a": [5, 4], "b": []})

    def between(r: int) -> None:
        if r == 1:
            api.ids["a"] += [6, 7]
        if r == 2:
            api.ids["b"].append(1)

    events = watch(Rounds(3, between), api, ["a", "b"])
    assert events == [(1, "game", "a", 6), (1, "game", "a", 7), (2, "game", "b", 1)]


def test_watch_resumes_from_after_and_reads_every_page() -> None:
    all_ids = list(range(100, 20, -1))
    api = FakeApi(ids={"a": all_ids}, page_size=10)
    events = watch(Rounds(1), api, ["a"], after={"a": 25})
    assert [e[3] for e in events] == sorted(i for i in all_ids if i > 25)


def test_watch_reads_after_when_a_player_is_added_later() -> None:
    api = FakeApi(ids={"a": [1], "b": [5]})
    uids = ["a"]
    after: dict[str, int] = {}

    def between(r: int) -> None:
        if r == 1:
            after["b"] = 5
            uids.append("b")
            api.ids["b"].append(6)

    assert watch(Rounds(2, between), api, uids, after=after) == [(1, "game", "b", 6)]


def test_watch_reports_errors_and_keeps_watching() -> None:
    api = FakeApi(ids={"a": [1], "b": [1]})
    api.fail.add("a")

    def between(r: int) -> None:
        if r == 1:
            api.ids["b"].append(2)
        if r == 2:
            api.fail.discard("a")

    events = watch(Rounds(3, between), api, ["a", "b"])
    assert events == [(0, "error", "a"), (1, "error", "a"), (1, "game", "b", 2)]


def test_watch_forgets_removed_players() -> None:
    api = FakeApi(ids={"a": [1], "b": [1]})
    uids = ["a"]

    def between(r: int) -> None:
        if r == 1:
            uids[:] = ["b"]
            api.ids["a"].append(2)
        if r == 2:
            uids[:] = ["a", "b"]
        if r == 3:
            api.ids["a"].append(3)

    # Game 2 was played while `a` was not watched, so it is not reported.
    assert watch(Rounds(4, between), api, lambda: uids) == [(3, "game", "a", 3)]


def test_watch_reads_a_one_time_iterator_once() -> None:
    api = FakeApi(ids={"a": [1]})

    def between(r: int) -> None:
        if r == 1:
            api.ids["a"].append(2)

    assert watch(Rounds(2, between), api, iter(["a"])) == [(1, "game", "a", 2)]


def test_watch_reports_a_failing_uid_list_and_keeps_the_last_one() -> None:
    api = FakeApi(ids={"a": [1]})
    state = {"fail": False}

    def between(r: int) -> None:
        if r == 1:
            state["fail"] = True
            api.ids["a"].append(2)

    def uids() -> list[str]:
        if state["fail"]:
            raise RuntimeError("db down")
        return ["a"]

    assert watch(Rounds(2, between), api, uids) == [(1, "error", None), (1, "game", "a", 2)]


def test_watch_skips_the_cache() -> None:
    api = FakeApi(ids={"a": [1]})
    rounds = Rounds(2, lambda r: api.ids["a"].append(2))
    er = make_client(api, rounds.clock, sleep=rounds.sleep, cache=MemoryCache())
    er.get_user_games("a")
    events = [e for e in er.watch_games(["a"], stop=rounds.stop, interval=10)]
    assert [e.game["gameId"] for e in events if isinstance(e, GameEvent)] == [2]


def test_watch_waits_between_rounds_with_nothing_to_watch() -> None:
    rounds = Rounds(3)
    assert watch(rounds, FakeApi(), [], interval=0.001) == []
    assert rounds.round == 3


def test_watch_checks_its_options() -> None:
    er = make_client(FakeApi())
    for interval in (-1, 0, float("inf"), float("nan")):
        with pytest.raises(ValueError):
            er.watch_games([], interval=interval)
    with pytest.raises(TypeError):
        er.watch_games("uid")


def test_watch_ends_at_once_when_stop_is_set() -> None:
    api = FakeApi(ids={"a": [1]})
    stop = threading.Event()
    stop.set()
    assert list(make_client(api).watch_games(["a"], stop=stop)) == []
    assert api.calls == []


# Async client: same behaviour.


def test_async_sync_and_rest() -> None:
    async def main() -> None:
        async with make_async_client(FakeApi(ids=list(range(10, 0, -1)))) as er:
            first = await er.sync_user_games("u", after=2, max_pages=1)
            assert ids(first.games) == [10, 9, 8] and first.newest_game_id == 2
            games = list(first.games)
            last = first
            while last.rest:
                last = await er.sync_user_games("u", **last.rest)
                games += last.games
            assert ids(games) == [10, 9, 8, 7, 6, 5, 4, 3]
            assert last.newest_game_id == 10
            assert ids([g async for g in er.iter_user_games("u", after=8)]) == [10, 9]

    asyncio.run(main())


def test_async_watch() -> None:
    api = FakeApi(ids={"a": [5, 4], "b": []})
    stop = asyncio.Event()
    state = {"round": 0}

    async def sleep(seconds: float) -> None:
        state["round"] += 1
        if state["round"] == 1:
            api.ids["a"] += [6, 7]
            api.fail.add("b")
        if state["round"] >= 2:
            stop.set()

    async def main() -> list[tuple[Any, ...]]:
        er = make_async_client(api, sleep=sleep)
        out: list[tuple[Any, ...]] = []
        async for e in er.watch_games(["a", "b"], stop=stop):
            out.append((e.type, e.uid, e.game["gameId"] if isinstance(e, GameEvent) else None))
        return out

    assert asyncio.run(main()) == [("game", "a", 6), ("game", "a", 7), ("error", "b", None)]


def test_async_watch_can_be_cancelled_while_waiting() -> None:
    api = FakeApi(ids={"a": [1]})

    async def main() -> None:
        er = make_async_client(api, sleep=None)
        events: list[Any] = []

        async def run() -> None:
            async for e in er.watch_games(["a"], interval=60):
                events.append(e)

        task = asyncio.create_task(run())
        await asyncio.sleep(0.05)
        task.cancel()
        with pytest.raises(asyncio.CancelledError):
            await task
        assert events == [] and api.calls == ["/v1/user/games/uid/a"]

    asyncio.run(main())


def test_async_watch_stop_event_ends_the_wait() -> None:
    api = FakeApi(ids={"a": [1]})

    async def main() -> None:
        er = make_async_client(api, sleep=None)
        stop = asyncio.Event()
        asyncio.get_running_loop().call_later(0.05, stop.set)
        events = [e async for e in er.watch_games(["a"], interval=60, stop=stop)]
        assert events == []

    asyncio.run(asyncio.wait_for(main(), 5))


def test_async_get_game_shares_one_request_and_skips_unfinished_cache() -> None:
    api = FakeApi(games={"7": lambda: [row(7, gameRank=1)], "8": lambda: [row(8, gameRank=4)]})

    async def main() -> None:
        er = make_async_client(api, cache=MemoryCache())
        a, b = await asyncio.gather(er.get_game(7), er.get_game(7))
        assert a == b and a is not b
        await er.get_game(7)
        await er.get_game(8)
        await er.get_game(8)
        assert api.calls.count("/v1/games/7") == 1
        assert api.calls.count("/v1/games/8") == 2

    asyncio.run(main())


def test_error_event_has_the_error() -> None:
    api = FakeApi(ids={"a": [1]})
    api.fail.add("a")
    rounds = Rounds(1)
    events = list(rounds.client(api).watch_games(["a"], stop=rounds.stop))
    assert isinstance(events[0], ErrorEvent)
    assert getattr(events[0].error, "status", None) == 500


def test_http_client_is_left_open_when_passed_in() -> None:
    http = httpx.Client(transport=httpx.MockTransport(FakeApi().handle))
    with ErClient("k", http_client=http):
        pass
    assert not http.is_closed


def test_sync_reads_the_first_page_fresh_even_with_a_cache() -> None:
    api = FakeApi(ids=[2, 1])
    er = make_client(api, cache=MemoryCache())
    er.get_user_games("u")
    api.ids.append(3)
    assert ids(er.sync_user_games("u", after=2).games) == [3]


def test_watch_treats_a_string_from_the_uid_function_as_an_error() -> None:
    api = FakeApi(ids={"a": [1]})
    state = {"bad": False}

    def between(r: int) -> None:
        if r == 1:
            state["bad"] = True
            api.ids["a"].append(2)

    events = watch(Rounds(2, between), api, lambda: "a" if state["bad"] else ["a"])
    assert events == [(1, "error", None), (1, "game", "a", 2)]


def test_watch_stops_partway_through_a_player_without_reporting() -> None:
    api = FakeApi(ids={"a": list(range(100, 70, -1))}, page_size=10)
    stop = threading.Event()

    def handle(request: httpx.Request) -> httpx.Response:
        if "next=" in str(request.url):
            stop.set()
        return api.handle(request)

    er = ErClient("k", http_client=httpx.Client(transport=httpx.MockTransport(handle)), requests_per_second=1000, burst=1000)
    assert list(er.watch_games(["a"], after={"a": 75}, stop=stop)) == []
    assert len(api.calls) == 2
