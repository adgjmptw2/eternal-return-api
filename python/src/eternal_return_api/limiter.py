from __future__ import annotations

import asyncio
import threading
import time
from collections.abc import Awaitable, Callable


class RateLimiter:
    """Token bucket shared by every request of one sync client. Thread-safe.

    Tokens refill continuously. Callers wait in turn while holding the lock,
    so a burst of threads is served one interval apart.
    """

    def __init__(
        self,
        interval: float,
        burst: int = 1,
        clock: Callable[[], float] = time.monotonic,
        sleep: Callable[[float], None] = time.sleep,
    ) -> None:
        self._interval = interval
        self._burst = burst
        self._tokens = float(burst)
        self._clock = clock
        self._sleep = sleep
        self._last = clock()
        self._lock = threading.Lock()

    def _refill(self) -> None:
        now = self._clock()
        elapsed = now - self._last
        if elapsed > 0:
            self._tokens = min(self._burst, self._tokens + elapsed / self._interval)
            self._last = now

    def acquire(self) -> None:
        with self._lock:
            self._refill()
            while self._tokens < 1:
                self._sleep((1 - self._tokens) * self._interval)
                self._refill()
            self._tokens -= 1


class AsyncRateLimiter:
    """Token bucket for one async client. Callers are served in arrival order."""

    def __init__(
        self,
        interval: float,
        burst: int = 1,
        clock: Callable[[], float] = time.monotonic,
        sleep: Callable[[float], Awaitable[None]] = asyncio.sleep,
    ) -> None:
        self._interval = interval
        self._burst = burst
        self._tokens = float(burst)
        self._clock = clock
        self._sleep = sleep
        self._last = clock()
        # Created on first use, inside the running loop.
        self._lock: asyncio.Lock | None = None

    def _refill(self) -> None:
        now = self._clock()
        elapsed = now - self._last
        if elapsed > 0:
            self._tokens = min(self._burst, self._tokens + elapsed / self._interval)
            self._last = now

    async def acquire(self) -> None:
        if self._lock is None:
            self._lock = asyncio.Lock()
        async with self._lock:
            self._refill()
            while self._tokens < 1:
                await self._sleep((1 - self._tokens) * self._interval)
                self._refill()
            self._tokens -= 1
