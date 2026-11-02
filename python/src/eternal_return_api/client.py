from __future__ import annotations

import asyncio
import inspect
import json
import math
import re
import threading
import time
import unicodedata
from collections.abc import (
    AsyncIterator,
    Awaitable,
    Callable,
    Coroutine,
    Iterable,
    Iterator,
    Mapping,
    Sequence,
)
from dataclasses import dataclass, field
from datetime import datetime
from types import MappingProxyType
from typing import Any, Literal, TypeVar
from urllib.parse import quote

import httpx

from .cache import DEFAULT_CACHE_TTL, CacheKind, CacheStore, cache_kind_of
from .errors import ErApiError, ErNicknameMismatchError
from .games import is_game_finished
from .limiter import AsyncRateLimiter, RateLimiter
from .modes import MatchingMode, TeamMode
from .names import GameNames, parse_l10n
from .seasons import SeasonCatalog
from .types import Envelope, ErUser, UserGame

DEFAULT_BASE_URL = "https://open-api.bser.io"

T = TypeVar("T")
_Stop = Literal["done", "max_pages"]
Uids = Iterable[str] | Callable[[], Iterable[str]]

#: Longest wait taken from a ``Retry-After`` header.
_MAX_RETRY_AFTER = 60.0


@dataclass
class UserGamesPage:
    games: list[UserGame]
    #: Pass to the next call to get older games. None on the last page.
    next: int | None = None


@dataclass
class SyncResult:
    #: Games newer than ``after``, newest first.
    games: list[UserGame]
    #: Save this and pass it as ``after`` next time. Equals ``after`` when
    #: nothing is new, and while ``rest`` is set, so saving it never skips games.
    newest_game_id: int | None
    #: Set when ``max_pages`` stopped the walk before ``after``, ``since`` or
    #: the end: older new games are still missing. Call
    #: ``sync_user_games(uid, **rest)`` until no ``rest`` comes back; the last
    #: call's ``newest_game_id`` is the newest game.
    rest: dict[str, Any] | None = None


@dataclass
class GameEvent:
    """A game the player finished. ``game`` is the player's own row."""

    uid: str
    game: UserGame
    type: Literal["game"] = "game"


@dataclass
class ErrorEvent:
    """A request for this player failed, or ``uid`` is None when calling
    ``uids`` failed. Watching goes on; the next round tries again."""

    uid: str | None
    error: Exception
    type: Literal["error"] = "error"


WatchEvent = GameEvent | ErrorEvent


@dataclass
class _Walk:
    after: int | None = None
    before: int | None = None
    since: float | None = None
    max_pages: int | None = None
    resume_newest: int | None = None
    stopped: _Stop = field(default="done", init=False)


_OFFSET = re.compile(r"([+-]\d{2})(\d{2})$")


def _started_at(game: UserGame) -> float | None:
    """``startDtm`` as a timestamp. The API writes the offset as ``+0900``."""
    text = game.get("startDtm")
    if not isinstance(text, str):
        return None
    try:
        return datetime.fromisoformat(_OFFSET.sub(r"\1:\2", text)).timestamp()
    except ValueError:
        return None


def _walk_options(
    after: int | None,
    before: int | None,
    since: datetime | None,
    max_pages: int | None,
    resume_newest: int | None = None,
) -> _Walk:
    if max_pages is not None and (isinstance(max_pages, bool) or not isinstance(max_pages, int) or max_pages < 1):
        raise ValueError("max_pages must be a whole number, 1 or more")
    # A naive datetime is read as local time.
    return _Walk(after, before, since.astimezone().timestamp() if since else None, max_pages, resume_newest)


def _sync_result(games: list[UserGame], walk: _Walk, since: datetime | None) -> SyncResult:
    first = games[0].get("gameId") if games else None
    newest = walk.resume_newest if walk.resume_newest is not None else first if first is not None else walk.after
    if walk.stopped != "max_pages":
        return SyncResult(games, newest)
    # Older new games are still missing: moving the saved position past them would lose them.
    before = games[-1].get("gameId") if games else walk.before
    rest = {
        "after": walk.after,
        "before": before,
        "since": since,
        "max_pages": walk.max_pages,
        "resume_newest_game_id": newest,
    }
    return SyncResult(games, walk.after, rest)


class _UidSource:
    """Reads ``uids`` each round. A one-time iterator is read once."""

    def __init__(self, uids: Uids) -> None:
        if isinstance(uids, (str, bytes)):
            raise TypeError("uids must be a list of uids, not one string")
        self._uids: Uids = list(uids) if not callable(uids) and iter(uids) is uids else uids

    def read(self) -> dict[str, None]:
        listed = self._uids() if callable(self._uids) else self._uids
        if isinstance(listed, (str, bytes)):
            raise TypeError("uids returned one string, not a list of uids")
        # A dict keeps the caller's order and drops duplicates.
        return dict.fromkeys(listed)


def _check_interval(interval: float) -> None:
    if isinstance(interval, bool) or not (interval > 0 and math.isfinite(interval)):
        raise ValueError("interval must be a positive number")


def _same_nickname(a: str, b: str) -> bool:
    def norm(value: str) -> str:
        return unicodedata.normalize("NFKC", value).strip().lower()

    return norm(a) == norm(b)


def _array(body: Envelope, key: str) -> list[Any]:
    value = body.get(key)
    return value if isinstance(value, list) else []


def _quote(value: str) -> str:
    # Same as JavaScript's encodeURIComponent.
    return quote(value, safe="!*'()")


def _game_finished(body: Envelope) -> bool:
    return is_game_finished(_array(body, "userGames"))


def _keep_for(path: str) -> Callable[[Envelope], bool] | None:
    """Which responses may be cached. An unfinished game changes as players finish."""
    return _game_finished if cache_kind_of(path) == "game" else None


class _Base:
    def __init__(
        self,
        api_key: str,
        *,
        requests_per_second: float,
        burst: int,
        timeout: float,
        retry_delays: Sequence[float],
        cache: CacheStore | None,
        cache_ttl: Mapping[CacheKind, float] | None,
        season_cache_ttl: float,
        base_url: str,
        clock: Callable[[], float],
    ) -> None:
        if not api_key:
            raise ValueError("api_key is required")
        if isinstance(requests_per_second, bool) or not (requests_per_second > 0 and math.isfinite(requests_per_second)):
            raise ValueError("requests_per_second must be a positive number")
        if isinstance(burst, bool) or not isinstance(burst, int) or burst < 1:
            raise ValueError("burst must be a whole number, 1 or more")
        if isinstance(timeout, bool) or not (timeout > 0 and math.isfinite(timeout)):
            raise ValueError("timeout must be a positive number of seconds")
        self._api_key = api_key
        self._interval = 1 / requests_per_second
        self._burst = burst
        self._timeout = timeout
        self._retry_delays = tuple(retry_delays)
        self._cache = cache
        self._cache_ttl: dict[CacheKind, float] = {**DEFAULT_CACHE_TTL, **(cache_ttl or {})}
        self._season_cache_ttl = season_cache_ttl
        self._base_url = base_url.rstrip("/")
        self._origin = self._origin_of(httpx.URL(self._base_url))
        # Responses from another server must not mix with the official API's in a shared cache.
        self._cache_prefix = "er:" if self._base_url == DEFAULT_BASE_URL else f"er:{self._base_url}:"
        self._clock = clock

    @staticmethod
    def _origin_of(url: httpx.URL) -> tuple[str, str, int | None]:
        return (url.scheme, url.host, url.port)

    def _url(self, path: str) -> str:
        # A path without a leading "/" could be glued onto another host and leak the key.
        if not path.startswith("/") or path.startswith("//"):
            raise ValueError(f'path must start with a single "/": {path}')
        url = httpx.URL(self._base_url + path)
        if self._origin_of(url) != self._origin:
            raise ValueError(f"path must stay on {self._base_url}: {path}")
        return str(url)

    def _headers(self) -> dict[str, str]:
        return {"x-api-key": self._api_key, "accept": "application/json"}

    def _retry_wait(self, attempt: int, res: httpx.Response | None) -> float:
        wait = self._retry_delays[attempt]
        header = res.headers.get("retry-after", "") if res is not None else ""
        if header.strip().isdigit():
            wait = max(wait, min(float(header), _MAX_RETRY_AFTER))
        return wait

    @staticmethod
    def _parse(status: int, text: str) -> Envelope:
        envelope: Envelope | None = None
        try:
            body = json.loads(text)
            if isinstance(body, dict):
                envelope = body
        except ValueError:
            pass  # Non-JSON error page. Status below decides.
        api_code = envelope.get("code") if envelope else None
        if not isinstance(api_code, int) or isinstance(api_code, bool):
            api_code = None
        message = str(envelope.get("message")) if envelope and "message" in envelope else f"Request failed (HTTP {status})"
        # Redirects are not followed, so a 3xx lands here too.
        if not 200 <= status < 300:
            raise ErApiError(status, message, api_code)
        if envelope is None:
            raise ErApiError(502, "Response is not JSON")
        # HTTP 200 does not mean success: the body `code` can carry the error.
        if api_code is not None and api_code != 200:
            raise ErApiError(api_code, message, api_code)
        return envelope

    def _ttl(self, path: str) -> float:
        return self._cache_ttl.get(cache_kind_of(path), 0)

    @staticmethod
    def _user(body: Envelope, nickname: str) -> ErUser | None:
        raw = body.get("user")
        if raw is None:
            return None
        row = raw if isinstance(raw, dict) else {}
        uid = row.get("uid") if isinstance(row.get("uid"), str) else row.get("userId")
        name = row.get("nickname")
        if not isinstance(uid, str) or not uid or not isinstance(name, str) or not name:
            raise ErApiError(502, "Nickname response has no uid or nickname")
        if not _same_nickname(name, nickname):
            raise ErNicknameMismatchError(nickname, name)
        return {"uid": uid, "nickname": name}

    @staticmethod
    def _page(body: Envelope) -> UserGamesPage:
        nxt = body.get("next")
        return UserGamesPage(_array(body, "userGames"), nxt if isinstance(nxt, int) and not isinstance(nxt, bool) else None)

    @staticmethod
    def _games_path(uid: str, nxt: int | None) -> str:
        suffix = f"?next={nxt}" if nxt is not None else ""
        return f"/v1/user/games/uid/{_quote(uid)}{suffix}"

    @staticmethod
    def _l10n_url(body: Envelope, language: str) -> str:
        data = body.get("data")
        url = data.get("l10Path") if isinstance(data, dict) else None
        if not isinstance(url, str) or not url:
            raise ErApiError(502, f"No l10n file for {language}")
        return url

    @staticmethod
    def _l10n_table(res: httpx.Response) -> Mapping[str, str]:
        if not 200 <= res.status_code < 300:
            raise ErApiError(res.status_code, f"l10n download failed (HTTP {res.status_code})")
        # Read-only: every caller shares one table.
        return MappingProxyType(parse_l10n(res.text))


class ErClient(_Base):
    """Blocking client. It is thread-safe, so one per process is enough.

    Times are in seconds. ``http_client`` lets you pass your own
    ``httpx.Client`` (proxies, transports for tests); the client then does
    not close it. A ``cache`` store is called from the requesting thread.
    """

    def __init__(
        self,
        api_key: str,
        *,
        requests_per_second: float = 1,
        burst: int = 1,
        timeout: float = 9.0,
        retry_delays: Sequence[float] = (1.5, 3.0),
        cache: CacheStore | None = None,
        cache_ttl: Mapping[CacheKind, float] | None = None,
        season_cache_ttl: float = 300,
        base_url: str = DEFAULT_BASE_URL,
        http_client: httpx.Client | None = None,
        clock: Callable[[], float] = time.monotonic,
        sleep: Callable[[float], None] | None = None,
    ) -> None:
        super().__init__(
            api_key,
            requests_per_second=requests_per_second,
            burst=burst,
            timeout=timeout,
            retry_delays=retry_delays,
            cache=cache,
            cache_ttl=cache_ttl,
            season_cache_ttl=season_cache_ttl,
            base_url=base_url,
            clock=clock,
        )
        self._owns_http = http_client is None
        self._http = http_client or httpx.Client()
        self._custom_sleep = sleep
        self._sleep = sleep or time.sleep
        self._limiter = RateLimiter(self._interval, self._burst, self._clock, self._sleep)
        self._locks_guard = threading.Lock()
        self._locks: dict[str, threading.Lock] = {}
        self._seasons: tuple[list[dict[str, Any]], float] | None = None
        self._l10n: dict[str, Mapping[str, str]] = {}
        self._names: dict[str, GameNames] = {}

    def close(self) -> None:
        if self._owns_http:
            self._http.close()

    def __enter__(self) -> ErClient:
        return self

    def __exit__(self, *exc: object) -> None:
        self.close()

    def _lock(self, key: str) -> threading.Lock:
        """One lock per loaded item, so threads asking for the same one wait for a single download."""
        with self._locks_guard:
            return self._locks.setdefault(key, threading.Lock())

    def _get(self, url: str, headers: dict[str, str] | None = None, follow: bool = False) -> httpx.Response:
        try:
            return self._http.get(url, headers=headers, timeout=self._timeout, follow_redirects=follow)
        except httpx.TimeoutException as e:
            raise ErApiError(504, f"Request timed out after {self._timeout}s") from e

    def _send(self, path: str) -> Envelope:
        url = self._url(path)
        for attempt in range(len(self._retry_delays) + 1):
            self._limiter.acquire()
            # Never follow redirects: the key header would go along to the new host.
            res = self._get(url, self._headers())
            try:
                return self._parse(res.status_code, res.text)
            except ErApiError as e:
                if e.status != 429 or attempt >= len(self._retry_delays):
                    raise
                self._sleep(self._retry_wait(attempt, res))
        raise AssertionError("unreachable")

    def _load(self, path: str, *, fresh: bool = False) -> Envelope:
        cache, ttl = self._cache, self._ttl(path)
        if fresh or cache is None or not ttl > 0:
            return self._send(path)
        keep = _keep_for(path)
        key = self._cache_prefix + path
        try:
            hit = cache.get(key)
            if isinstance(hit, str):
                cached = json.loads(hit)
                # A store shared with an older version may hold what `keep` now rejects.
                if isinstance(cached, dict) and (keep is None or keep(cached)):
                    return cached
        except Exception:
            pass  # A broken cache counts as a miss.
        body = self._send(path)
        if keep is None or keep(body):
            try:
                cache.set(key, json.dumps(body, ensure_ascii=False), ttl)
            except Exception:
                pass
        return body

    def request(self, path: str) -> Envelope:
        """GET any API path and return the body. Rate limit, 429 retries,
        the ``code`` check and the cache apply."""
        return self._load(path)

    @staticmethod
    def _or_empty(load: Callable[[], T], empty: T) -> T:
        try:
            return load()
        except ErApiError as e:
            if e.status == 404:
                return empty
            raise

    def get_user_by_nickname(self, nickname: str) -> ErUser | None:
        """Nickname → uid. None if no such player."""
        return self._or_empty(lambda: self._user(self.request(f"/v1/user/nickname?query={_quote(nickname)}"), nickname), None)

    def get_user_games(self, uid: str, next: int | None = None, *, fresh: bool = False) -> UserGamesPage:
        """One page of a player's recent games, newest first. Each game holds
        only this player's row. ``fresh`` skips the cache."""
        return self._user_games(uid, next, fresh)

    def _user_games(self, uid: str, nxt: int | None, fresh: bool) -> UserGamesPage:
        return self._or_empty(lambda: self._page(self._load(self._games_path(uid, nxt), fresh=fresh)), UserGamesPage([]))

    def _walk(
        self, uid: str, walk: _Walk, fresh_first: bool, stopped: Callable[[], bool] | None = None
    ) -> Iterator[UserGame]:
        # Only the first page can change; a page below a cursor stays the same.
        seen: set[int] = set()
        nxt = walk.before
        page = 0
        while True:
            if walk.max_pages is not None and page >= walk.max_pages:
                walk.stopped = "max_pages"
                return
            if stopped is not None and stopped():
                return
            result = self._user_games(uid, nxt, fresh_first and page == 0)
            page += 1
            for game in result.games:
                game_id = game.get("gameId")
                if walk.after is not None and isinstance(game_id, int) and game_id <= walk.after:
                    return
                started = _started_at(game)
                if walk.since is not None and started is not None and started < walk.since:
                    return
                yield game
            if result.next is None:
                return
            if result.next in seen:
                raise ErApiError(502, f"Paging cursor repeated: {result.next}")
            seen.add(result.next)
            nxt = result.next

    def iter_user_games(
        self,
        uid: str,
        *,
        after: int | None = None,
        before: int | None = None,
        since: datetime | None = None,
        max_pages: int | None = None,
    ) -> Iterator[UserGame]:
        """Walks pages of a player's games, newest first.

        ``after``: newest ``gameId`` you already have; stops there.
        ``before``: start below this ``gameId``; the API's ``next`` cursor is a
        game id, so this jumps there in one request.
        ``since``: stop once games started before this time.
        """
        return self._walk(uid, _walk_options(after, before, since, max_pages), False)

    def sync_user_games(
        self,
        uid: str,
        *,
        after: int | None = None,
        before: int | None = None,
        since: datetime | None = None,
        max_pages: int | None = None,
        resume_newest_game_id: int | None = None,
    ) -> SyncResult:
        """Games newer than ``after``, in one list. Paging stops at ``after``,
        so a player with a few new games costs one request. The first page
        skips the cache, so new games show up at once.

        Without ``after`` this reads the whole list (about 90 days); pass
        ``since`` or ``max_pages`` for a first sync.
        ``resume_newest_game_id`` is set by ``rest``; leave it as it is.
        """
        walk = _walk_options(after, before, since, max_pages, resume_newest_game_id)
        games = list(self._walk(uid, walk, True))
        return _sync_result(games, walk, since)

    def watch_games(
        self,
        uids: Uids,
        *,
        interval: float = 60.0,
        after: Mapping[str, int] | None = None,
        stop: threading.Event | None = None,
    ) -> Iterator[WatchEvent]:
        """Yields games as players finish them.

        Each round reads each player's newest page without the cache: one
        request per player when nothing is new. Each player's games come
        oldest first, and none are skipped. The first round only notes where
        each player is.

        ``uids``: a list or set is read again every round, so changes to it
        apply; a function is called every round; a one-time iterator is read
        once. ``after``: newest game already handled per uid, read when a
        player first appears. Set ``stop`` to end watching.
        """
        _check_interval(interval)
        return self._watch(_UidSource(uids), interval, after if after is not None else {}, stop)

    def _watch(
        self, source: _UidSource, interval: float, start: Mapping[str, int], stop: threading.Event | None
    ) -> Iterator[WatchEvent]:
        stopped = stop.is_set if stop is not None else None
        newest: dict[str, int] = {}
        listed: dict[str, None] = {}
        while not (stopped and stopped()):
            started = self._clock()
            try:
                listed = source.read()
            except Exception as e:
                yield ErrorEvent(None, e)  # Keep the last list.
            # Forget players no longer watched, so adding one back starts fresh.
            for uid in [u for u in newest if u not in listed]:
                del newest[uid]
            for uid in listed:
                if stopped and stopped():
                    return
                try:
                    known = newest[uid] if uid in newest else start.get(uid)
                    if known is None:
                        first = self._user_games(uid, None, True).games
                        game_id = first[0].get("gameId") if first else None
                        newest[uid] = game_id if isinstance(game_id, int) else 0
                        continue
                    newest[uid] = known
                    # No page limit: stopping early would skip games for good.
                    games = list(self._walk(uid, _Walk(after=known), True, stopped))
                except Exception as e:
                    if stopped and stopped():
                        return
                    yield ErrorEvent(uid, e)
                    continue
                # Stopped partway: report nothing, so no game is reported out of order.
                if stopped and stopped():
                    return
                if not games:
                    continue
                game_id = games[0].get("gameId")
                if isinstance(game_id, int):
                    newest[uid] = game_id
                for game in reversed(games):
                    if stopped and stopped():
                        return
                    yield GameEvent(uid, game)
            # Always wait, even after a slow round, so an empty list cannot spin.
            wait = max(started + interval - self._clock(), 0)
            if self._custom_sleep or stop is None:
                self._sleep(wait)
            else:
                stop.wait(wait)

    def get_game(self, game_id: int | str) -> list[UserGame]:
        """Every participant of one game. Empty if the game is gone.

        A game still being played has only the players who are done; see
        ``is_game_finished``. Such a result is not cached.
        """
        path = f"/v1/games/{_quote(str(game_id))}"
        return self._or_empty(lambda: _array(self._load(path), "userGames"), [])

    def get_user_rank(self, uid: str, season_id: int, team_mode: int = TeamMode.SQUAD) -> dict[str, Any] | None:
        """A player's ranked standing. None if unranked."""

        def load() -> dict[str, Any] | None:
            rank = self.request(f"/v1/rank/uid/{_quote(uid)}/{season_id}/{team_mode}").get("userRank")
            return rank if isinstance(rank, dict) else None

        return self._or_empty(load, None)

    def get_top_ranks(self, season_id: int, team_mode: int = TeamMode.SQUAD) -> list[dict[str, Any]]:
        """Top of the ladder. One response, no paging. Rows have nicknames, not uids."""
        return self._or_empty(lambda: _array(self.request(f"/v1/rank/top/{season_id}/{team_mode}"), "topRanks"), [])

    def get_user_stats(self, uid: str, season_id: int, matching_mode: int = MatchingMode.RANKED) -> list[dict[str, Any]]:
        """Season stats for normal (2) or ranked (3) games."""
        path = f"/v2/user/stats/uid/{_quote(uid)}/{season_id}/{matching_mode}"
        return self._or_empty(lambda: _array(self.request(path), "userStats"), [])

    def get_data(self, meta_type: str) -> list[dict[str, Any]]:
        """A game data table, e.g. ``Character``, ``ItemWeapon``, ``Season``."""
        return _array(self.request(f"/v2/data/{_quote(meta_type)}"), "data")

    def get_seasons(self) -> SeasonCatalog:
        """The ``Season`` table, cached for ``season_cache_ttl`` seconds."""
        with self._lock("seasons"):
            cached = self._seasons
            if cached is None or cached[1] <= self._clock():
                # Its own expiry: the response cache would keep it longer.
                rows = _array(self._load("/v2/data/Season", fresh=True), "data")
                cached = self._seasons = (rows, self._clock() + self._season_cache_ttl)
        return SeasonCatalog(cached[0])

    def get_l10n(self, language: str) -> Mapping[str, str]:
        """Full localization table for a language (``Korean``, ``English``, ...),
        read-only. Downloaded once per client."""
        with self._lock(f"l10n:{language}"):
            table = self._l10n.get(language)
            if table is None:
                url = self._l10n_url(self.request(f"/v1/l10n/{_quote(language)}"), language)
                # The file is on a CDN, not the API host: no key, no rate limit.
                table = self._l10n[language] = self._l10n_table(self._get(url, follow=True))
        return table

    def get_names(self, language: str) -> GameNames:
        """Names for characters, items, traits, weapons, tactical skills and tiers.
        Downloads the l10n file and two data tables once per language."""
        with self._lock(f"names:{language}"):
            names = self._names.get(language)
            if names is None:
                names = self._names[language] = GameNames(
                    self.get_l10n(language), self.get_data("TacticalSkillSetGroup"), self.get_data("TacticalSkillSet")
                )
        return names


class AsyncErClient(_Base):
    """asyncio client, for discord.py and other async code.

    Same methods as ``ErClient``, as coroutines. Use ``async with`` or call
    ``aclose()``. Concurrent calls for the same cached path share one request.
    A ``cache`` store may have coroutine methods; plain methods run on the
    event loop, so they must not wait on the network.
    """

    def __init__(
        self,
        api_key: str,
        *,
        requests_per_second: float = 1,
        burst: int = 1,
        timeout: float = 9.0,
        retry_delays: Sequence[float] = (1.5, 3.0),
        cache: CacheStore | None = None,
        cache_ttl: Mapping[CacheKind, float] | None = None,
        cache_timeout: float = 1.0,
        season_cache_ttl: float = 300,
        base_url: str = DEFAULT_BASE_URL,
        http_client: httpx.AsyncClient | None = None,
        clock: Callable[[], float] = time.monotonic,
        sleep: Callable[[float], Awaitable[None]] | None = None,
    ) -> None:
        super().__init__(
            api_key,
            requests_per_second=requests_per_second,
            burst=burst,
            timeout=timeout,
            retry_delays=retry_delays,
            cache=cache,
            cache_ttl=cache_ttl,
            season_cache_ttl=season_cache_ttl,
            base_url=base_url,
            clock=clock,
        )
        self._cache_timeout = cache_timeout
        self._owns_http = http_client is None
        self._http = http_client or httpx.AsyncClient()
        self._custom_sleep = sleep
        self._sleep = sleep or asyncio.sleep
        self._limiter = AsyncRateLimiter(self._interval, self._burst, self._clock, self._sleep)
        self._tasks: set[asyncio.Task[Any]] = set()
        self._in_flight: dict[str, asyncio.Task[str]] = {}
        self._loading: dict[str, asyncio.Task[Any]] = {}
        self._seasons: tuple[list[dict[str, Any]], float] | None = None

    async def aclose(self) -> None:
        """Cancels requests and cache writes still running, then closes the HTTP client if it owns it."""
        tasks = [t for t in self._tasks if not t.done()]
        for task in tasks:
            task.cancel()
        await asyncio.gather(*tasks, return_exceptions=True)
        if self._owns_http:
            await self._http.aclose()

    async def __aenter__(self) -> AsyncErClient:
        return self

    async def __aexit__(self, *exc: object) -> None:
        await self.aclose()

    def _spawn(self, coro: Coroutine[Any, Any, T]) -> asyncio.Task[T]:
        """Starts a task the client keeps track of, so ``aclose`` can end it
        and an error nobody awaited is not reported as lost."""
        task = asyncio.ensure_future(coro)
        self._tasks.add(task)

        def done(t: asyncio.Task[Any]) -> None:
            self._tasks.discard(t)
            if not t.cancelled():
                t.exception()

        task.add_done_callback(done)
        return task

    async def _get(self, url: str, headers: dict[str, str] | None = None, follow: bool = False) -> httpx.Response:
        try:
            return await self._http.get(url, headers=headers, timeout=self._timeout, follow_redirects=follow)
        except httpx.TimeoutException as e:
            raise ErApiError(504, f"Request timed out after {self._timeout}s") from e

    async def _send(self, path: str) -> Envelope:
        url = self._url(path)
        for attempt in range(len(self._retry_delays) + 1):
            await self._limiter.acquire()
            # Never follow redirects: the key header would go along to the new host.
            res = await self._get(url, self._headers())
            try:
                return self._parse(res.status_code, res.text)
            except ErApiError as e:
                if e.status != 429 or attempt >= len(self._retry_delays):
                    raise
                await self._sleep(self._retry_wait(attempt, res))
        raise AssertionError("unreachable")

    async def _load(self, path: str, *, fresh: bool = False) -> Envelope:
        cache, ttl = self._cache, self._ttl(path)
        if fresh or cache is None or not ttl > 0:
            return await self._send(path)
        key = self._cache_prefix + path
        loading = self._in_flight.get(key)
        if loading is None:
            loading = self._spawn(self._through_cache(cache, key, path, ttl, _keep_for(path)))
            self._in_flight[key] = loading
            loading.add_done_callback(lambda _: self._in_flight.pop(key, None))
        # Parse per caller so no two callers share one object. Shield, so one
        # caller's cancellation does not cancel the request for the others.
        body: Envelope = json.loads(await asyncio.shield(loading))
        return body

    async def _through_cache(
        self, cache: CacheStore, key: str, path: str, ttl: float, keep: Callable[[Envelope], bool] | None
    ) -> str:
        try:
            hit = cache.get(key)
            if inspect.isawaitable(hit):
                hit = await asyncio.wait_for(hit, self._cache_timeout)
            if isinstance(hit, str):
                cached = json.loads(hit)
                if isinstance(cached, dict) and (keep is None or keep(cached)):
                    return hit
        except Exception:
            pass  # A slow or broken cache counts as a miss.
        body = await self._send(path)
        text = json.dumps(body, ensure_ascii=False)
        if keep is None or keep(body):
            self._store(cache, key, text, ttl)
        return text

    def _store(self, cache: CacheStore, key: str, text: str, ttl: float) -> None:
        try:
            result = cache.set(key, text, ttl)
        except Exception:
            return
        if inspect.isawaitable(result):
            pending = result

            # Not awaited: the caller already has its answer.
            async def finish() -> None:
                try:
                    await asyncio.wait_for(pending, self._cache_timeout)
                except Exception:
                    pass

            self._spawn(finish())

    async def request(self, path: str) -> Envelope:
        """GET any API path and return the body. Rate limit, 429 retries,
        the ``code`` check and the cache apply."""
        return await self._load(path)

    @staticmethod
    async def _or_empty(load: Awaitable[T], empty: T) -> T:
        try:
            return await load
        except ErApiError as e:
            if e.status == 404:
                return empty
            raise

    async def get_user_by_nickname(self, nickname: str) -> ErUser | None:
        """Nickname → uid. None if no such player."""

        async def load() -> ErUser | None:
            return self._user(await self.request(f"/v1/user/nickname?query={_quote(nickname)}"), nickname)

        return await self._or_empty(load(), None)

    async def get_user_games(self, uid: str, next: int | None = None, *, fresh: bool = False) -> UserGamesPage:
        """One page of a player's recent games, newest first. Each game holds
        only this player's row. ``fresh`` skips the cache."""
        return await self._user_games(uid, next, fresh)

    async def _user_games(self, uid: str, nxt: int | None, fresh: bool) -> UserGamesPage:
        async def load() -> UserGamesPage:
            return self._page(await self._load(self._games_path(uid, nxt), fresh=fresh))

        return await self._or_empty(load(), UserGamesPage([]))

    async def _walk(
        self, uid: str, walk: _Walk, fresh_first: bool, stopped: Callable[[], bool] | None = None
    ) -> AsyncIterator[UserGame]:
        seen: set[int] = set()
        nxt = walk.before
        page = 0
        while True:
            if walk.max_pages is not None and page >= walk.max_pages:
                walk.stopped = "max_pages"
                return
            if stopped is not None and stopped():
                return
            result = await self._user_games(uid, nxt, fresh_first and page == 0)
            page += 1
            for game in result.games:
                game_id = game.get("gameId")
                if walk.after is not None and isinstance(game_id, int) and game_id <= walk.after:
                    return
                started = _started_at(game)
                if walk.since is not None and started is not None and started < walk.since:
                    return
                yield game
            if result.next is None:
                return
            if result.next in seen:
                raise ErApiError(502, f"Paging cursor repeated: {result.next}")
            seen.add(result.next)
            nxt = result.next

    def iter_user_games(
        self,
        uid: str,
        *,
        after: int | None = None,
        before: int | None = None,
        since: datetime | None = None,
        max_pages: int | None = None,
    ) -> AsyncIterator[UserGame]:
        """Walks pages of a player's games, newest first. See ``ErClient.iter_user_games``."""
        return self._walk(uid, _walk_options(after, before, since, max_pages), False)

    async def sync_user_games(
        self,
        uid: str,
        *,
        after: int | None = None,
        before: int | None = None,
        since: datetime | None = None,
        max_pages: int | None = None,
        resume_newest_game_id: int | None = None,
    ) -> SyncResult:
        """Games newer than ``after``, in one list. See ``ErClient.sync_user_games``."""
        walk = _walk_options(after, before, since, max_pages, resume_newest_game_id)
        games = [game async for game in self._walk(uid, walk, True)]
        return _sync_result(games, walk, since)

    def watch_games(
        self,
        uids: Uids,
        *,
        interval: float = 60.0,
        after: Mapping[str, int] | None = None,
        stop: asyncio.Event | None = None,
    ) -> AsyncIterator[WatchEvent]:
        """Yields games as players finish them. See ``ErClient.watch_games``.
        Cancel the task or set ``stop`` to end it."""
        _check_interval(interval)
        return self._watch(_UidSource(uids), interval, after if after is not None else {}, stop)

    async def _watch(
        self, source: _UidSource, interval: float, start: Mapping[str, int], stop: asyncio.Event | None
    ) -> AsyncIterator[WatchEvent]:
        stopped = stop.is_set if stop is not None else None
        newest: dict[str, int] = {}
        listed: dict[str, None] = {}
        while not (stopped and stopped()):
            started = self._clock()
            try:
                listed = source.read()
            except Exception as e:
                yield ErrorEvent(None, e)  # Keep the last list.
            for uid in [u for u in newest if u not in listed]:
                del newest[uid]
            for uid in listed:
                if stopped and stopped():
                    return
                try:
                    known = newest[uid] if uid in newest else start.get(uid)
                    if known is None:
                        first = (await self._user_games(uid, None, True)).games
                        game_id = first[0].get("gameId") if first else None
                        newest[uid] = game_id if isinstance(game_id, int) else 0
                        continue
                    newest[uid] = known
                    games = [g async for g in self._walk(uid, _Walk(after=known), True, stopped)]
                except Exception as e:
                    if stopped and stopped():
                        return
                    yield ErrorEvent(uid, e)
                    continue
                if stopped and stopped():
                    return
                if not games:
                    continue
                game_id = games[0].get("gameId")
                if isinstance(game_id, int):
                    newest[uid] = game_id
                for game in reversed(games):
                    if stopped and stopped():
                        return
                    yield GameEvent(uid, game)
            wait = max(started + interval - self._clock(), 0)
            if self._custom_sleep or stop is None:
                await self._sleep(wait)
            else:
                try:
                    await asyncio.wait_for(stop.wait(), wait)
                except asyncio.TimeoutError:
                    pass

    async def get_game(self, game_id: int | str) -> list[UserGame]:
        """Every participant of one game. Empty if the game is gone.

        A game still being played has only the players who are done; see
        ``is_game_finished``. Such a result is not cached.
        """
        path = f"/v1/games/{_quote(str(game_id))}"

        async def load() -> list[UserGame]:
            return _array(await self._load(path), "userGames")

        return await self._or_empty(load(), [])

    async def get_user_rank(self, uid: str, season_id: int, team_mode: int = TeamMode.SQUAD) -> dict[str, Any] | None:
        """A player's ranked standing. None if unranked."""

        async def load() -> dict[str, Any] | None:
            rank = (await self.request(f"/v1/rank/uid/{_quote(uid)}/{season_id}/{team_mode}")).get("userRank")
            return rank if isinstance(rank, dict) else None

        return await self._or_empty(load(), None)

    async def get_top_ranks(self, season_id: int, team_mode: int = TeamMode.SQUAD) -> list[dict[str, Any]]:
        """Top of the ladder. One response, no paging. Rows have nicknames, not uids."""

        async def load() -> list[dict[str, Any]]:
            return _array(await self.request(f"/v1/rank/top/{season_id}/{team_mode}"), "topRanks")

        return await self._or_empty(load(), [])

    async def get_user_stats(
        self, uid: str, season_id: int, matching_mode: int = MatchingMode.RANKED
    ) -> list[dict[str, Any]]:
        """Season stats for normal (2) or ranked (3) games."""
        path = f"/v2/user/stats/uid/{_quote(uid)}/{season_id}/{matching_mode}"

        async def load() -> list[dict[str, Any]]:
            return _array(await self.request(path), "userStats")

        return await self._or_empty(load(), [])

    async def get_data(self, meta_type: str) -> list[dict[str, Any]]:
        """A game data table, e.g. ``Character``, ``ItemWeapon``, ``Season``."""
        return _array(await self.request(f"/v2/data/{_quote(meta_type)}"), "data")

    async def _once(self, key: str, make: Callable[[], Coroutine[Any, Any, T]]) -> T:
        """Runs ``make`` once per key; a failure is forgotten so the next call tries again."""
        task: asyncio.Task[T] | None = self._loading.get(key)
        if task is None:
            task = self._spawn(make())
            self._loading[key] = task

            def forget_failure(t: asyncio.Task[Any]) -> None:
                if t.cancelled() or t.exception() is not None:
                    self._loading.pop(key, None)

            task.add_done_callback(forget_failure)
        return await asyncio.shield(task)

    async def get_seasons(self) -> SeasonCatalog:
        """The ``Season`` table, cached for ``season_cache_ttl`` seconds."""
        cached = self._seasons
        if cached is None or cached[1] <= self._clock():

            async def load() -> tuple[list[dict[str, Any]], float]:
                try:
                    # Its own expiry: the response cache would keep it longer.
                    rows = _array(await self._load("/v2/data/Season", fresh=True), "data")
                    self._seasons = (rows, self._clock() + self._season_cache_ttl)
                    return self._seasons
                finally:
                    self._loading.pop("seasons", None)

            cached = await self._once("seasons", load)
        return SeasonCatalog(cached[0])

    async def get_l10n(self, language: str) -> Mapping[str, str]:
        """Full localization table for a language (``Korean``, ``English``, ...),
        read-only. Downloaded once per client."""

        async def load() -> Mapping[str, str]:
            url = self._l10n_url(await self.request(f"/v1/l10n/{_quote(language)}"), language)
            # The file is on a CDN, not the API host: no key, no rate limit.
            return self._l10n_table(await self._get(url, follow=True))

        return await self._once(f"l10n:{language}", load)

    async def get_names(self, language: str) -> GameNames:
        """Names for characters, items, traits, weapons, tactical skills and tiers.
        Downloads the l10n file and two data tables once per language."""

        async def load() -> GameNames:
            l10n = await self.get_l10n(language)
            groups = await self.get_data("TacticalSkillSetGroup")
            sets = await self.get_data("TacticalSkillSet")
            return GameNames(l10n, groups, sets)

        return await self._once(f"names:{language}", load)


__all__ = [
    "DEFAULT_BASE_URL",
    "AsyncErClient",
    "ErClient",
    "ErrorEvent",
    "GameEvent",
    "SyncResult",
    "UserGamesPage",
    "WatchEvent",
]
