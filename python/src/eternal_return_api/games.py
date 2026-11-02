"""Helpers over game rows: finished check, teams, summaries."""

from __future__ import annotations

import math
from collections.abc import Iterable
from dataclasses import dataclass, field
from typing import Any

from .types import UserGame


def is_game_finished(players: Iterable[UserGame]) -> bool:
    """Whether a ``get_game`` result is the finished game.

    A game fetched while other teams are still playing has only the players
    who are done, and no winner yet. ERCraft stored such games as final and
    later showed teammates as missing. Check this before storing a game for
    good.

    A finished game has a row with ``gameRank`` 1 (Cobalt Protocol too). The
    row count is not a test: finished games can have fewer than 24 rows.
    """
    return any(player.get("gameRank") == 1 for player in players)


def _num(value: Any) -> float:
    return value if isinstance(value, (int, float)) and math.isfinite(value) else 0


@dataclass
class GameTeam:
    #: None for a player without ``teamNumber``; each such player is a team alone.
    team_number: int | None
    #: From a member who did not give up and stayed longest. A player who gave
    #: up can keep the rank and team kills from when they left.
    game_rank: int
    victory: bool
    #: ``teamKill`` from the same row as ``game_rank``. If missing, the highest
    #: ``teamKill`` among members who did not give up, else the sum of member kills.
    team_kills: int
    assists: int
    damage_to_player: int
    #: Most kills first.
    players: list[UserGame] = field(default_factory=list)


def _stay_score(p: UserGame) -> tuple[int, float]:
    duration = p.get("duration")
    stayed = duration if isinstance(duration, (int, float)) and math.isfinite(duration) else -1
    return (0 if p.get("giveUp") == 1 else 1, stayed)


def group_teams(players: Iterable[UserGame]) -> list[GameTeam]:
    """Groups the players of one game (``get_game``) into teams, best placement first."""
    by_team: dict[int, list[UserGame]] = {}
    groups: list[tuple[int | None, list[UserGame]]] = []
    for player in players:
        team_number = player.get("teamNumber")
        if not isinstance(team_number, int):
            groups.append((None, [player]))
            continue
        members = by_team.get(team_number)
        if members is None:
            members = by_team[team_number] = []
            groups.append((team_number, members))
        members.append(player)

    teams: list[GameTeam] = []
    for team_number, members in groups:
        # Earliest of the best, so input order does not change the result on ties.
        last = max(members, key=_stay_score)
        kills = sum(int(_num(p.get("playerKill"))) for p in members)
        team_kill = last.get("teamKill")
        if not isinstance(team_kill, int):
            stayed = [p["teamKill"] for p in members if p.get("giveUp") != 1 and isinstance(p.get("teamKill"), int)]
            team_kill = max(stayed) if stayed else kills
        teams.append(
            GameTeam(
                team_number=team_number,
                game_rank=int(_num(last.get("gameRank"))),
                victory=any(p.get("victory") == 1 for p in members),
                team_kills=team_kill,
                assists=sum(int(_num(p.get("playerAssistant"))) for p in members),
                damage_to_player=sum(int(_num(p.get("damageToPlayer"))) for p in members),
                players=sorted(members, key=lambda p: -_num(p.get("playerKill"))),
            )
        )

    def order(team: GameTeam) -> tuple[float, float]:
        rank = team.game_rank or math.inf
        return (rank, math.inf if team.team_number is None else team.team_number)

    return sorted(teams, key=order)


@dataclass(frozen=True)
class GameSummary:
    games: int
    #: Games with ``victory == 1``.
    wins: int
    #: Games with ``gameRank`` 1 to 3.
    top3: int
    #: 0 to 1.
    win_rate: float
    #: 0 to 1.
    top3_rate: float
    average_rank: float
    average_kills: float
    average_assists: float
    #: Average ``damageToPlayer``, or None when no game has it.
    average_damage: float | None


@dataclass(frozen=True)
class CharacterSummary(GameSummary):
    character_num: int = 0


@dataclass(frozen=True)
class GamesSummary:
    overall: GameSummary
    #: Most played first.
    characters: list[CharacterSummary]


class _Totals:
    def __init__(self) -> None:
        self.games = self.wins = self.top3 = self.rank_count = 0
        self.rank_sum = self.kills = self.assists = self.damage = 0.0
        self.damage_count = 0

    def add(self, game: UserGame) -> None:
        self.games += 1
        if game.get("victory") == 1:
            self.wins += 1
        rank = _num(game.get("gameRank"))
        if rank > 0:
            self.rank_sum += rank
            self.rank_count += 1
            if rank <= 3:
                self.top3 += 1
        self.kills += _num(game.get("playerKill"))
        self.assists += _num(game.get("playerAssistant"))
        damage = game.get("damageToPlayer")
        if isinstance(damage, (int, float)):
            self.damage += damage
            self.damage_count += 1

    def values(self) -> dict[str, Any]:
        def per(n: float, d: int) -> float:
            return n / d if d > 0 else 0.0

        return {
            "games": self.games,
            "wins": self.wins,
            "top3": self.top3,
            "win_rate": per(self.wins, self.games),
            "top3_rate": per(self.top3, self.games),
            "average_rank": per(self.rank_sum, self.rank_count),
            "average_kills": per(self.kills, self.games),
            "average_assists": per(self.assists, self.games),
            "average_damage": self.damage / self.damage_count if self.damage_count else None,
        }


def summarize_games(games: Iterable[UserGame]) -> GamesSummary:
    """Totals and per-character stats for a list of games.

    Mixing modes skews the numbers (Cobalt Protocol ranks teams differently),
    so filter by ``matchingMode`` first when that matters.
    """
    overall = _Totals()
    by_character: dict[int, _Totals] = {}
    for game in games:
        overall.add(game)
        character = int(_num(game.get("characterNum")))
        by_character.setdefault(character, _Totals()).add(game)
    characters = sorted(
        (CharacterSummary(character_num=code, **totals.values()) for code, totals in by_character.items()),
        key=lambda c: (-c.games, c.character_num),
    )
    return GamesSummary(GameSummary(**overall.values()), characters)
