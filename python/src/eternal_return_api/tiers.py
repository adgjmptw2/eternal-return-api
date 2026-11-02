"""Ranked tiers from RP, per season.

Tables come from ERCraft, which checks them against patch notes and reward
announcements. Same tables as the TypeScript package.
"""

from __future__ import annotations

import math
from dataclasses import dataclass
from typing import Literal

TierKey = Literal[
    "unranked",
    "iron",
    "bronze",
    "silver",
    "gold",
    "platinum",
    "diamond",
    "meteorite",
    "mithril",
    "demigod",
    "eternity",
]

#: Last season with a checked table. Later seasons use it until the package is updated.
LATEST_TIER_SEASON = 12


@dataclass(frozen=True)
class RankTier:
    tier: TierKey
    #: 4 (lowest) to 1, or None for tiers without divisions.
    division: int | None
    #: Official English name, e.g. "Diamond 2", "Mythril", "Titan".
    name: str
    min_rp: int
    #: None for open-ended tiers.
    max_rp: int | None


_Division = tuple[int, TierKey, "int | None"]


@dataclass(frozen=True)
class _Ladder:
    divisions: tuple[_Division, ...]
    mithril_min_rp: int
    #: "mithrilRank": rank alone decides. "rp": also needs at least ``board_min_rp``.
    board_mode: Literal["mithrilRank", "rp"]
    eternity_max_rank: int
    demigod_max_rank: int
    board_min_rp: int = 0
    demigod_min_rank: int = 0


def _steps(tier: TierKey, starts: list[int]) -> list[_Division]:
    return [(rp, tier, None if len(starts) == 1 else 4 - i) for i, rp in enumerate(starts)]


_BASE_S5 = [
    *_steps("iron", [0, 150, 300, 450]),
    *_steps("bronze", [600, 800, 1000, 1200]),
    *_steps("silver", [1400, 1650, 1900, 2150]),
    *_steps("gold", [2400, 2700, 3000, 3300]),
    *_steps("platinum", [3600, 3950, 4300, 4650]),
    *_steps("diamond", [5000, 5350, 5700, 6050]),
]

_S3_LOW = [*_steps("bronze", [800, 1000, 1200, 1400]), *_steps("silver", [1600, 1850, 2100, 2350])]


def _rp(divisions: list[_Division], mithril: int, min_rp: int, eternity: int, demigod: tuple[int, int]) -> _Ladder:
    return _Ladder(tuple(divisions), mithril, "rp", eternity, demigod[1], min_rp, demigod[0])


def _by_rank(divisions: list[_Division], mithril: int) -> _Ladder:
    return _Ladder(tuple(divisions), mithril, "mithrilRank", 300, 1000)


_LADDERS: dict[int, _Ladder] = {
    1: _rp(
        [
            *_steps("bronze", [1000, 1250, 1500, 1750]),
            *_steps("silver", [2000, 2250, 2500, 2750]),
            *_steps("gold", [3000, 3250, 3500, 3750]),
            *_steps("platinum", [4000, 4250, 4500, 4750]),
            *_steps("diamond", [5000, 5250, 5500, 5750]),
        ],
        6000, 6200, 200, (201, 700),
    ),
    3: _rp(
        [*_S3_LOW, *_steps("gold", [2600, 2850, 3100, 3350]), *_steps("platinum", [3600, 3900, 4200, 4500]),
         *_steps("diamond", [4800, 5150, 5500, 5850])],
        6200, 6400, 200, (201, 700),
    ),
    4: _rp(
        [*_S3_LOW, *_steps("gold", [2600, 2900, 3200, 3500]), *_steps("platinum", [3800, 4150, 4500, 4850]),
         *_steps("diamond", [5200, 5600, 6000, 6400])],
        6800, 7000, 200, (201, 700),
    ),
    5: _rp([*_BASE_S5, *_steps("meteorite", [6400])], 6800, 7500, 200, (201, 700)),
    6: _rp([*_BASE_S5, *_steps("meteorite", [6400])], 7000, 7700, 300, (301, 1000)),
    7: _rp([*_BASE_S5, *_steps("meteorite", [6400])], 7100, 7800, 300, (301, 1000)),
    9: _rp([*_BASE_S5, *_steps("meteorite", [6400])], 7200, 7900, 300, (301, 1000)),
    10: _by_rank([*_BASE_S5, *_steps("meteorite", [6400, 6650, 6900, 7150])], 7400),
    11: _by_rank([*_BASE_S5, *_steps("meteorite", [6400, 6700, 7000, 7300])], 7600),
    12: _rp([*_BASE_S5, *_steps("meteorite", [6400, 6700, 7000, 7300])], 7600, 8300, 300, (301, 1000)),
}

_ENGLISH: dict[TierKey, str] = {
    "unranked": "Unranked",
    "iron": "Iron",
    "bronze": "Bronze",
    "silver": "Silver",
    "gold": "Gold",
    "platinum": "Platinum",
    "diamond": "Diamond",
    "meteorite": "Meteorite",
    "mithril": "Mythril",
    "demigod": "Titan",
    "eternity": "Immortal",
}


def _ladder_of(season: float | None) -> _Ladder:
    n = math.floor(season) if season is not None and math.isfinite(season) else LATEST_TIER_SEASON
    if n <= 2:
        return _LADDERS[1]
    if n == 8:
        return _LADDERS[7]
    return _LADDERS[min(n, LATEST_TIER_SEASON)]


def _tier(key: TierKey, division: int | None, min_rp: int, max_rp: int | None) -> RankTier:
    name = _ENGLISH[key] if division is None else f"{_ENGLISH[key]} {division}"
    return RankTier(key, division, name, min_rp, max_rp)


def _leaderboard_tier(rp: int, rank: int, ladder: _Ladder) -> TierKey | None:
    if ladder.board_mode == "mithrilRank":
        if rank <= ladder.eternity_max_rank:
            return "eternity"
        if rank <= ladder.demigod_max_rank:
            return "demigod"
        return None
    if rp < ladder.board_min_rp:
        return None
    if rank <= ladder.eternity_max_rank:
        return "eternity"
    if ladder.demigod_min_rank <= rank <= ladder.demigod_max_rank:
        return "demigod"
    return None


def rank_tier(rp: float, *, rank: int | None = None, season: float | None = None) -> RankTier:
    """RP → tier. 0 RP or less is Unranked. Fractions are rounded down.

    ``rank`` is the leaderboard rank (``rank`` from ``get_user_rank``).
    ``demigod`` and ``eternity`` need it; without it, the top tier is
    ``mithril``. ``season`` is the in-game season number (see
    ``to_player_season``), default ``LATEST_TIER_SEASON``.
    """
    if not math.isfinite(rp) or rp < 1:
        return _tier("unranked", None, 0, None)
    points = math.floor(rp)
    ladder = _ladder_of(season)
    if points >= ladder.mithril_min_rp:
        top = _leaderboard_tier(points, rank, ladder) if rank is not None and rank > 0 else None
        if top is None:
            return _tier("mithril", None, ladder.mithril_min_rp, None)
        floor = ladder.board_min_rp if ladder.board_mode == "rp" else ladder.mithril_min_rp
        return _tier(top, None, floor, None)
    rows = ladder.divisions
    for i in range(len(rows) - 1, -1, -1):
        min_rp, key, division = rows[i]
        if points >= min_rp:
            upper = rows[i + 1][0] if i + 1 < len(rows) else ladder.mithril_min_rp
            return _tier(key, division, min_rp, upper - 1)
    # Below the lowest row (seasons 1 to 4 had no Iron).
    return _tier("unranked", None, 0, None)
