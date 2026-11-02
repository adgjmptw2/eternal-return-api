from __future__ import annotations

import threading
import time
from collections import OrderedDict
from collections.abc import Awaitable, Callable, Mapping
from typing import Literal, Protocol

CacheKind = Literal["nickname", "userGames", "game", "rank", "topRanks", "stats", "data", "other"]

#: Default time to keep each kind of response, in seconds. 0 means do not cache.
DEFAULT_CACHE_TTL: Mapping[CacheKind, float] = {
    "nickname": 600,
    "userGames": 60,
    # A finished game never changes. Unfinished games are not cached.
    "game": 3600,
    "rank": 60,
    "topRanks": 300,
    "stats": 300,
    "data": 3600,
    "other": 0,
}


class CacheStore(Protocol):
    """Where a client keeps responses. Values are JSON strings.

    The async client also accepts stores whose methods are coroutines, so an
    async Redis client fits with a small adapter. In the async client, plain
    methods run on the event loop, so they must not wait on the network.
    The sync client calls the store from many threads.
    """

    def get(self, key: str) -> str | None | Awaitable[str | None]: ...

    def set(self, key: str, value: str, ttl: float) -> object: ...


def cache_kind_of(path: str) -> CacheKind:
    if path.startswith("/v1/user/nickname"):
        return "nickname"
    if path.startswith("/v1/user/games/"):
        return "userGames"
    if path.startswith("/v1/games/"):
        return "game"
    if path.startswith("/v1/rank/top/"):
        return "topRanks"
    if path.startswith("/v1/rank/"):
        return "rank"
    if path.startswith("/v2/user/stats/"):
        return "stats"
    if path.startswith("/v2/data/"):
        return "data"
    return "other"


class MemoryCache:
    """In-memory cache with a size limit; drops the least recently used entry first. Thread-safe."""

    def __init__(self, max_entries: int = 1000, clock: Callable[[], float] = time.monotonic) -> None:
        self._entries: OrderedDict[str, tuple[str, float]] = OrderedDict()
        self._max = max_entries
        self._clock = clock
        self._lock = threading.Lock()

    def __len__(self) -> int:
        return len(self._entries)

    def get(self, key: str) -> str | None:
        with self._lock:
            entry = self._entries.pop(key, None)
            if entry is None or entry[1] <= self._clock():
                return None
            self._entries[key] = entry
            return entry[0]

    def set(self, key: str, value: str, ttl: float) -> None:
        with self._lock:
            self._entries.pop(key, None)
            if ttl <= 0 or self._max <= 0:
                return
            self._entries[key] = (value, self._clock() + ttl)
            while len(self._entries) > self._max:
                self._entries.popitem(last=False)
