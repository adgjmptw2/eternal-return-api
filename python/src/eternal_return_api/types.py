"""Response shapes. Rows are plain dicts with the API's own field names.

Only commonly used fields are listed. The API sends about 340 fields per game
row, and every one of them is kept in the dict. Field notes were checked
against live responses: 650 games of 13.0 and 13.1 (11,754 rows) and 379 games
of 12.5 to 12.7 (6,741 rows), in November 2026. See the field guide for
details.
"""

from __future__ import annotations

from typing import Any, Literal, TypedDict


class ErUser(TypedDict):
    #: For the player endpoints. Not a stable ID: each nickname lookup returns a
    #: different value for the same player, and earlier values keep working for
    #: some time. Do not use it as a key in your own data.
    uid: str
    nickname: str


class QuestStepClear(TypedDict):
    """A Research Task in ``questStepClear`` (13.0 and 13.1)."""

    #: The first digit is the field: 1 Material, 2 Energy, 3 Biotechnology. In
    #: 13.0 ``x0001`` is the first task and ``x0002`` the repeated one; in 13.1
    #: ``x0011`` is the first and ``x0021`` to ``x0023`` the repeated ones.
    experimentGroupId: int
    #: Seconds from the start of the game.
    firstClearElapsedSeconds: float
    clearCount: int


class UserGame(TypedDict, total=False):
    """One player's result in one game, from ``get_user_games`` or ``get_game``."""

    gameId: int
    #: Ranked season id, e.g. 43 for season 13. 0 in every mode but ranked.
    seasonId: int
    #: See ``MatchingMode``: 2 normal, 3 ranked, 6 Cobalt Protocol, 13 Rumble Out.
    matchingMode: int
    #: See ``TeamMode``: 3 squad, 4 Cobalt Protocol.
    matchingTeamMode: int
    #: First part of the game version, e.g. 13 in 13.1. Only in ``get_game`` rows.
    versionSeason: int
    #: Second part, e.g. 1 in 13.1.
    versionMajor: int
    versionMinor: int
    #: The nickname at the time of the game. AI players have one too.
    nickname: str
    #: True for an AI player. See ``is_bot_player``. Only in ``get_game`` rows.
    isMLBot: bool
    #: Same as ``isMLBot``.
    mlbot: bool
    #: Players in the game who are not AI.
    matchSize: int
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
    #: Item grade, same keys: 1 Common, 2 Uncommon, 3 Rare, 4 Epic, 5 Legendary, 6 Mythic.
    equipmentGrade: dict[str, int]
    routeIdOfStart: int
    #: Team placement, 1 is the winner. A player who gave up keeps the rank from when they left.
    gameRank: int
    #: 1 for the winning team, 0 otherwise. 0 in every row when an AI team won.
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
    #: Ranked only. ``mmrGainInGame + mmrLossEntryCost``, plus 50 when the game
    #: moved the player up a tier, or minus 50 when it moved them down one. 0 for
    #: a player who left and paid the penalty, and for some of their teammates.
    #: ``rp_change`` handles the exceptions.
    mmrGain: int
    #: Ranked: the RP change that was applied, ``mmrAfter - mmrBefore``. Differs
    #: from ``mmrGain`` where the change was doubled (``gambit``, seen in 12.5
    #: and 12.6). Can be nonzero in other modes; ignore it there.
    mmrGainGambit: int
    #: Ranked only. RP after the game, tier bonus included. 0 for a player who
    #: left and paid the penalty; ``rankPoint`` has their RP.
    mmrAfter: int
    #: Ranked: RP earned in the game, before the entry cost. Teammates often
    #: differ by a few points. 0 in other modes.
    mmrGainInGame: int
    #: Ranked: entry cost, 0 or negative, set by the player's division. Twice
    #: that for a player who left. 0 in other modes.
    mmrLossEntryCost: int
    #: Ranked only. Average ``mmrBefore`` of every row in the game, AI players included, rounded down.
    mmrAvg: int
    #: Ranked: ``mmrAfter`` without the 50 for moving a tier. 0 in other modes.
    rankPoint: int
    #: Size of the party the player queued with: 1 solo, 2 duo, 3 trio, 4 in
    #: Cobalt Protocol. 0 for AI players.
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
    #: 13.0 and 13.1, normal and ranked: the team's Research Task field. Missing
    #: when the team cleared none. The 13.2 patch notes end Research Tasks.
    experimentResultType: Literal["Material", "Energy", "Biotechnology"]
    #: 13.0 and 13.1: cleared Research Tasks, in the order they were first cleared.
    questStepClear: list[QuestStepClear]
    #: 13.0 and 13.1: credits from clearing Research Tasks.
    crExperimentReward: int
    #: 13.0 and 13.1: credits from the Research Task's buff.
    crExperimentalCredit: int


#: Raw response body. Every Open API response has ``code`` and ``message``.
Envelope = dict[str, Any]
