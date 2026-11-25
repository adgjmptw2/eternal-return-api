from __future__ import annotations

from typing import Literal


class MatchingMode:
    """``matchingMode`` values seen in Open API responses."""

    NORMAL = 2
    RANKED = 3
    #: Cobalt Protocol.
    COBALT = 6
    #: Cobalt Protocol in older records. New games use 6.
    COBALT_LEGACY = 4
    LONE_WOLF = 9
    #: Rumble Out, an event mode with 5 teams of 3. Ran November 12 to 18, 2026.
    RUMBLE_OUT = 13


class TeamMode:
    """``matchingTeamMode`` values. Rumble Out uses 3, like the squad modes."""

    LONE_WOLF = 1
    SQUAD = 3
    COBALT = 4


GameModeName = Literal["rank", "normal", "cobalt", "loneWolf", "rumbleOut", "unknown"]

_MODE_NAMES: dict[int, GameModeName] = {
    MatchingMode.RANKED: "rank",
    MatchingMode.NORMAL: "normal",
    MatchingMode.COBALT: "cobalt",
    MatchingMode.COBALT_LEGACY: "cobalt",
    MatchingMode.LONE_WOLF: "loneWolf",
    MatchingMode.RUMBLE_OUT: "rumbleOut",
}


def game_mode_name(matching_mode: int) -> GameModeName:
    return _MODE_NAMES.get(matching_mode, "unknown")
