from __future__ import annotations

import copy
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from typing import Any, Callable

import httpx
import pytest

from eternal_return_api import AsyncErClient, ErClient

KST = timezone(timedelta(hours=9))


def row(game_id: int, **extra: Any) -> dict[str, Any]:
    start = datetime(2026, 10, 1, tzinfo=KST) + timedelta(minutes=game_id)
    text = start.strftime("%Y-%m-%dT%H:%M:%S.000%z")
    return {"gameId": game_id, "gameRank": 3, "startDtm": text, **extra}


@dataclass
class FakeApi:
    """One or more players' game lists, served like the real API: newest
    first, ``page_size`` per page, ``next`` is the last id of the page and a
    request with ``next`` starts below it."""

    ids: Any = field(default_factory=list)
    page_size: int = 3
    games: dict[str, Callable[[], list[dict[str, Any]]]] = field(default_factory=dict)
    routes: dict[str, Any] = field(default_factory=dict)
    calls: list[str] = field(default_factory=list)
    fail: set[str] = field(default_factory=set)
    headers: list[httpx.Headers] = field(default_factory=list)

    def __post_init__(self) -> None:
        self.ids = copy.deepcopy(self.ids)

    def handle(self, request: httpx.Request) -> httpx.Response:
        url = request.url
        key = url.path + (f"?{url.query.decode()}" if url.query else "")
        self.calls.append(key)
        self.headers.append(request.headers)
        if key in self.routes:
            route = self.routes[key]
            return route() if callable(route) else route
        if url.path.startswith("/v1/user/games/uid/"):
            uid = url.path.rsplit("/", 1)[1]
            if uid in self.fail:
                return httpx.Response(500, text="boom")
            ids = self.ids[uid] if isinstance(self.ids, dict) else self.ids
            ordered = sorted(ids, reverse=True)
            nxt = url.params.get("next")
            below = ordered if nxt is None else [i for i in ordered if i < int(nxt)]
            page = below[: self.page_size]
            body: dict[str, Any] = {"code": 200, "message": "Success", "userGames": [row(i) for i in page]}
            if len(below) > self.page_size:
                body["next"] = page[-1]
            return httpx.Response(200, json=body)
        if url.path.startswith("/v1/games/"):
            game = self.games.get(url.path.rsplit("/", 1)[1])
            if game:
                return httpx.Response(200, json={"code": 200, "message": "Success", "userGames": game()})
        return httpx.Response(200, json={"code": 404, "message": "Not Found"})


class Clock:
    def __init__(self) -> None:
        self.now = 0.0
        self.sleeps: list[float] = []

    def __call__(self) -> float:
        return self.now

    def sleep(self, seconds: float) -> None:
        self.sleeps.append(seconds)
        self.now += seconds

    async def async_sleep(self, seconds: float) -> None:
        self.sleep(seconds)


def make_client(api: FakeApi, clock: Clock | None = None, **options: Any) -> ErClient:
    clock = clock or Clock()
    options = {"requests_per_second": 1000, "burst": 1000, "clock": clock, "sleep": clock.sleep, **options}
    return ErClient("test-key", http_client=httpx.Client(transport=httpx.MockTransport(api.handle)), **options)


def make_async_client(api: FakeApi, clock: Clock | None = None, **options: Any) -> AsyncErClient:
    clock = clock or Clock()
    options = {"requests_per_second": 1000, "burst": 1000, "clock": clock, "sleep": clock.async_sleep, **options}
    return AsyncErClient(
        "test-key", http_client=httpx.AsyncClient(transport=httpx.MockTransport(api.handle)), **options
    )


@pytest.fixture
def clock() -> Clock:
    return Clock()
