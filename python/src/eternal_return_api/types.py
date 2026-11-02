"""Response shapes. Rows are plain dicts with the API's own field names.

Only commonly used fields are listed. The API sends about 320 fields per game
row, and every one of them is kept in the dict. Field notes were checked
against live responses (30 games, 594 rows, October 2026); see the field
guide for details.
"""

from __future__ import annotations

from typing import Any, TypedDict


class ErUser(TypedDict):
    uid: str
    nickname: str


class UserGame(TypedDict, total=False):
    """One player's result in one game, from ``get_user_games`` or ``get_game``."""

    gameId: int
    #: Ranked season id, e.g. 41 for season 12. 0 in normal and Cobalt Protocol games.
    seasonId: int
    #: See ``MatchingMode``: 2 normal, 3 ranked, 6 Cobalt Protocol.
    matchingMode: int
    #: See ``TeamMode``: 3 squad, 4 Cobalt Protocol.
    matchingTeamMode: int
    versionSeason: int
    versionMajor: int
    versionMinor: int
    nickname: str
    #: Team within the game. Members share it.
    teamNumber: int
    #: Character code. ``GameNames.character`` gives the name.
    characterNum: int
    characterLevel: int
    skinCode: int
    #: Weapon type number, not an item code. ``GameNames.weapon`` gives the name.
    bestWeapon: int
    bestWeaponLevel: int
    tacticalSkillGroup: int
    tacticalSkillLevel: int
    traitFirstCore: int
    traitFirstSub: list[int]
    traitSecondSub: list[int]
    #: Item codes by slot: "0" weapon, "1" chest, "2" head, "3" arm, "4" leg.
    equipment: dict[str, int]
    #: Item grade, same keys. Seen: 1 Common, 4 Epic, 5 Legendary, 6 Mythic.
    equipmentGrade: dict[str, int]
    routeIdOfStart: int
    #: Team placement, 1 is the winner. A player who gave up keeps the rank from when they left.
    gameRank: int
    #: 1 for the winning team, 0 otherwise.
    victory: int
    playerKill: int
    playerAssistant: int
    playerDeaths: int
    #: Team kills, shared like ``gameRank``.
    teamKill: int
    teamElimination: int
    teamDownCanEliminate: int
    teamDownCanNotEliminate: int
    monsterKill: int
    damageToPlayer: int
    damageToMonster: int
    damageFromPlayer: int
    totalGainVFCredit: int
    #: Ranked only. RP before the game.
    mmrBefore: int
    #: Ranked only. ``mmrGainInGame + mmrLossEntryCost``.
    mmrGain: int
    #: Ranked only. ``mmrBefore + mmrGain``.
    mmrAfter: int
    mmrGainInGame: int
    #: Entry cost, 0 or negative.
    mmrLossEntryCost: int
    #: Ranked only. Average ``mmrBefore`` of everyone in the game, rounded down.
    mmrAvg: int
    rankPoint: int
    #: Size of the party the player queued with: 1 solo, 2 duo, 3 trio.
    preMade: int
    botAdded: int
    botRemain: int
    #: 1 if the player gave up.
    giveUp: int
    #: Korea time, e.g. ``2026-10-30T15:30:59.059+0900``. The milliseconds repeat the seconds.
    startDtm: str
    #: ``startDtm`` + ``duration`` + 90 days.
    expireDtm: str
    playTime: int
    watchTime: int
    totalTime: int
    #: Seconds from the start until the team finished. Shared like ``gameRank``.
    duration: int
    finalInfusion: list[int]


#: Raw response body. Every Open API response has ``code`` and ``message``.
Envelope = dict[str, Any]
