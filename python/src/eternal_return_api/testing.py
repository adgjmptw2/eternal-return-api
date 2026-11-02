"""Sample responses for building and testing without an API key.

Made-up responses in the shape of the real API: two ranked games with every
player, the leaderboard, the season, tactical skill, character mastery and
item tables, and the localization keys those games need (Korean and English).
Nothing comes from the API: names, codes and numbers are invented. Field
names and the relations between fields follow the real API. The sample player
is ``Player1``.

    from eternal_return_api.testing import SAMPLE_NICKNAME, sample_client

    er = sample_client()
    user = er.get_user_by_nickname(SAMPLE_NICKNAME)
"""

from __future__ import annotations

import gzip
import json
from functools import lru_cache
from importlib.resources import files
from typing import Any

import httpx

from .client import AsyncErClient, ErClient

#: The primary sample player.
SAMPLE_NICKNAME = "Player1"

_FILE_HOST = "sample.invalid"
_NOT_FOUND = {"code": 404, "message": "Not Found"}


@lru_cache(maxsize=1)
def _data() -> dict[str, Any]:
    raw = files("eternal_return_api").joinpath("sample.json.gz").read_bytes()
    data: dict[str, Any] = json.loads(gzip.decompress(raw))
    return data


def _handle(request: httpx.Request) -> httpx.Response:
    data = _data()
    url = request.url
    if url.host == _FILE_HOST:
        text = data["files"].get(url.path.removeprefix("/l10n/"))
        return httpx.Response(404 if text is None else 200, text=text or "")
    key = url.path + (f"?{url.query.decode()}" if url.query else "")
    body = data["bodies"].get(key, _NOT_FOUND)
    l10n = body.get("data", {}).get("l10Path") if isinstance(body.get("data"), dict) else None
    if isinstance(l10n, str) and l10n.startswith("sample:"):
        # The sample stores file URLs as "sample:l10n/Korean".
        body = {**body, "data": {**body["data"], "l10Path": f"https://{_FILE_HOST}/{l10n.removeprefix('sample:')}"}}
    return httpx.Response(200, json=body)


def sample_transport() -> httpx.MockTransport:
    """An httpx transport that answers from the sample data. Anything not in
    it gets what the real API sends for a missing record: HTTP 200 with
    ``code: 404``."""
    return httpx.MockTransport(_handle)


def sample_client(**options: Any) -> ErClient:
    """An ``ErClient`` backed by the sample data, with no rate limit."""
    options = {"requests_per_second": 1000, "burst": 1000, **options}
    client = ErClient("sample", http_client=httpx.Client(transport=sample_transport()), **options)
    client._owns_http = True  # Closing the sample client closes the HTTP client it made.
    return client


def async_sample_client(**options: Any) -> AsyncErClient:
    """An ``AsyncErClient`` backed by the sample data, with no rate limit."""
    options = {"requests_per_second": 1000, "burst": 1000, **options}
    client = AsyncErClient("sample", http_client=httpx.AsyncClient(transport=sample_transport()), **options)
    client._owns_http = True
    return client
