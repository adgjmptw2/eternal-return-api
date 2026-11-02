from __future__ import annotations

import asyncio

import pytest

from eternal_return_api import (
    GameNames,
    game_mode_name,
    group_teams,
    rank_tier,
    summarize_games,
)
from eternal_return_api.testing import (
    SAMPLE_NICKNAME,
    async_sample_client,
    sample_client,
)


@pytest.mark.parametrize(
    ("rp", "options", "name"),
    [
        (0, {}, "Unranked"),
        (1, {}, "Iron 4"),
        (6049, {}, "Diamond 2"),
        (7599, {}, "Meteorite 1"),
        (7600, {}, "Mythril"),
        (8300, {"rank": 300}, "Immortal"),
        (8300, {"rank": 301}, "Titan"),
        (8300, {"rank": 1001}, "Mythril"),
        (8299, {"rank": 1}, "Mythril"),
        (7600, {"rank": 1, "season": 11}, "Immortal"),
        (999, {"season": 1}, "Unranked"),
        (6400, {"season": 99}, "Meteorite 4"),
    ],
)
def test_rank_tier(rp: int, options: dict[str, int], name: str) -> None:
    assert rank_tier(rp, **options).name == name


def test_rank_tier_bounds() -> None:
    tier = rank_tier(6049)
    assert (tier.tier, tier.division, tier.min_rp, tier.max_rp) == ("diamond", 2, 5700, 6049)


def test_group_teams_takes_team_values_from_who_stayed() -> None:
    players = [
        {"teamNumber": 1, "gameRank": 5, "teamKill": 14, "duration": 906, "giveUp": 1, "playerKill": 9},
        {"teamNumber": 1, "gameRank": 3, "teamKill": 18, "duration": 1070, "playerKill": 4},
        {"teamNumber": 2, "gameRank": 1, "victory": 1, "teamKill": 20, "duration": 1300, "playerKill": 2},
        {"gameRank": 7, "playerKill": 1},
    ]
    teams = group_teams(players)  # type: ignore[arg-type]
    assert [(t.team_number, t.game_rank, t.team_kills) for t in teams] == [(2, 1, 20), (1, 3, 18), (None, 7, 1)]
    assert teams[0].victory and not teams[1].victory
    assert teams[1].players[0]["playerKill"] == 9
    # Input order does not change the result.
    assert [t.game_rank for t in group_teams(list(reversed(players)))] == [1, 3, 7]  # type: ignore[arg-type]


def test_summarize_games() -> None:
    games = [
        {"characterNum": 1, "gameRank": 1, "victory": 1, "playerKill": 4, "playerAssistant": 2, "damageToPlayer": 100},
        {"characterNum": 1, "gameRank": 5, "victory": 0, "playerKill": 2, "playerAssistant": 0},
        {"characterNum": 2, "gameRank": 3, "victory": 0, "playerKill": 0, "playerAssistant": 1},
    ]
    s = summarize_games(games)  # type: ignore[arg-type]
    assert (s.overall.games, s.overall.wins, s.overall.top3) == (3, 1, 2)
    assert s.overall.average_rank == 3 and s.overall.average_damage == 100
    assert [(c.character_num, c.games) for c in s.characters] == [(1, 2), (2, 1)]
    assert summarize_games([]).overall.win_rate == 0


def test_game_mode_name() -> None:
    assert [game_mode_name(m) for m in (2, 3, 4, 6, 9, 99)] == ["normal", "rank", "cobalt", "cobalt", "loneWolf", "unknown"]


def test_names_strip_tags_and_unknown_codes() -> None:
    names = GameNames(
        {"Character/Name/1": "<color=red>재키</color>", "WeaponType/Glove": "글러브", "DIAMOND": "다이아몬드"},
        [{"group": 30, "startCode": 3001, "icon": "VSkillIcon_4011000"}],
        [{"code": 3001, "skillCode": "4011001, 4011011"}],
    )
    assert names.character(1) == "재키"
    assert names.character(2) is None and names.character(None) is None
    assert names.weapon(1) == "글러브" and names.weapon(12) is None
    assert names.tier("diamond") == "다이아몬드"
    assert names.tactical_skill(30) is None


def test_sample_client_end_to_end() -> None:
    with sample_client() as er:
        user = er.get_user_by_nickname(SAMPLE_NICKNAME)
        assert user is not None
        games = er.get_user_games(user["uid"]).games
        assert len(games) >= 2 and all(g["nickname"] == SAMPLE_NICKNAME for g in games)
        players = er.get_game(games[0]["gameId"])
        assert len(players) >= 18 and group_teams(players)[0].game_rank == 1
        seasons = er.get_seasons()
        assert seasons.current_ranked_season_id == 41
        for language in ("Korean", "English"):
            names = er.get_names(language)
            for p in players:
                assert names.character(p["characterNum"])
                assert names.weapon(p.get("bestWeapon"))
                assert names.tactical_skill(p.get("tacticalSkillGroup"))
                for code in p.get("equipment", {}).values():
                    assert names.item(code)
        assert er.get_user_by_nickname("nobody") is None


def test_async_sample_client() -> None:
    async def main() -> None:
        async with async_sample_client() as er:
            user = await er.get_user_by_nickname(SAMPLE_NICKNAME)
            assert user is not None
            names, rank = await asyncio.gather(er.get_names("English"), er.get_user_rank(user["uid"], 41))
            assert rank is not None and rank_tier(rank["mmr"], rank=rank["rank"]).name
            page = await er.get_user_games(user["uid"])
            assert names.character(page.games[0]["characterNum"])

    asyncio.run(main())
