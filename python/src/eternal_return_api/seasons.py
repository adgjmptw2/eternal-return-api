from __future__ import annotations

import re
from collections.abc import Mapping, Sequence
from typing import Any

_SEASON_NAME = re.compile(r"^(?:Pre-)?Season(\d+)$")
_RANKED_NAME = re.compile(r"^Season\d+$")
_PRE_NAME = re.compile(r"^Pre-Season(\d+)$")


def parse_season_number(season_name: str) -> int | None:
    """``Season20`` → 20, ``Pre-Season11`` → 11. Other names → None."""
    match = _SEASON_NAME.match(season_name.strip())
    if not match:
        return None
    n = int(match.group(1))
    return n if n > 0 else None


def to_player_season(table_season_number: int) -> int:
    """Table numbering → the season number players see in game.

    From ``Season10`` on, the table runs 9 ahead: ``Season20`` is S11.
    """
    return table_season_number - 9 if table_season_number >= 10 else table_season_number


def _name(row: Mapping[str, Any]) -> str:
    value = row.get("seasonName")
    return value.strip() if isinstance(value, str) else ""


def _is_ranked(row: Mapping[str, Any]) -> bool:
    return bool(_RANKED_NAME.match(_name(row)))


class SeasonCatalog:
    """Maps between API season ids and the season numbers players use.

    ``isCurrent`` can point at a ``Pre-Season`` row between seasons.
    Pre-seasons have no ranked ladder, so ``current_ranked_season_id`` falls
    back to the latest ranked season before it.
    """

    def __init__(self, rows: Sequence[Mapping[str, Any]]) -> None:
        self.rows: list[dict[str, Any]] = [dict(row) for row in rows]
        self._id_to_player: dict[int, int] = {}
        self._player_to_id: dict[int, int] = {}
        for row in self.rows:
            n = parse_season_number(_name(row))
            season_id = row.get("seasonID")
            if n is None or not isinstance(season_id, int):
                continue
            player = to_player_season(n)
            self._id_to_player[season_id] = player
            if not _is_ranked(row):
                continue
            known = self._player_to_id.get(player)
            if known is None or season_id > known:
                self._player_to_id[player] = season_id

    @property
    def current(self) -> dict[str, Any] | None:
        """The row the API marks as current. May be a pre-season."""
        return next((row for row in self.rows if row.get("isCurrent") == 1), None)

    @property
    def current_ranked_season_id(self) -> int | None:
        """Season id to use for rank and stats calls right now."""
        current = self.current
        if current is None:
            return None
        current_id = current.get("seasonID")
        if not isinstance(current_id, int):
            return None
        if _is_ranked(current):
            return current_id
        pre = _PRE_NAME.match(_name(current))
        if not pre:
            return None
        pre_number = int(pre.group(1))
        best: int | None = None
        for row in self.rows:
            season_id = row.get("seasonID")
            n = parse_season_number(_name(row))
            if (
                _is_ranked(row)
                and isinstance(season_id, int)
                and season_id < current_id
                and n is not None
                and n < pre_number
                and (best is None or season_id > best)
            ):
                best = season_id
        return best

    def player_season_of(self, season_id: int) -> int | None:
        """Player season number for any season id, pre-seasons included."""
        return self._id_to_player.get(season_id)

    def season_id_of(self, player_season: int) -> int | None:
        """Ranked season id for a player season number. Pre-season-only numbers give None."""
        return self._player_to_id.get(player_season)
