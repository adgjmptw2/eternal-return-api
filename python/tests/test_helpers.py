from __future__ import annotations

import asyncio

import pytest

from eternal_return_api import (
    LATEST_TIER_SEASON,
    GameNames,
    RpChange,
    game_mode_name,
    group_teams,
    is_bot_player,
    is_game_finished,
    rank_tier,
    rp_change,
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
    assert [game_mode_name(m) for m in (2, 3, 4, 6, 9, 13, 99)] == [
        "normal", "rank", "cobalt", "cobalt", "loneWolf", "rumbleOut", "unknown"
    ]


def test_season_13_tier_lines() -> None:
    assert LATEST_TIER_SEASON == 13
    for rp in (1, 600, 1400, 2400, 3600, 5000, 6400, 7300, 7599, 7600, 8300, 9000):
        for rank in (None, 1, 301, 1001):
            assert rank_tier(rp, rank=rank, season=13) == rank_tier(rp, rank=rank, season=12)
    # RP where the entry cost changed in 13.0 and 13.1 ranked games.
    for rp in (600, 800, 1000, 1200, 1400, 1650, 1900, 2150, 2400, 2700, 3000, 3300, 3600, 3950, 4300, 4650,
               5000, 5350, 5700, 6050, 6400, 6700, 7000, 7300, 7600):
        assert rank_tier(rp, season=13).min_rp == rp


@pytest.mark.parametrize(
    ("row", "after"),
    [
        ({"mmrBefore": 4200, "mmrGain": 17, "mmrAfter": 4217, "rankPoint": 4217}, 4217),
        # Moved up a tier: rankPoint leaves out the 50.
        ({"mmrBefore": 1380, "mmrGain": 130, "mmrAfter": 1510, "rankPoint": 1460}, 1510),
        # Moved down a tier.
        ({"mmrBefore": 2410, "mmrGain": -71, "mmrAfter": 2339, "rankPoint": 2389}, 2339),
        # The teammate of a player who left: no change.
        ({"mmrBefore": 2720, "mmrGain": 0, "mmrGainInGame": 3, "mmrAfter": 2720, "rankPoint": 2720}, 2720),
        # Left and paid twice the entry cost.
        ({"mmrBefore": 2800, "mmrGain": 0, "mmrAfter": 0, "rankPoint": 2740, "giveUp": 1}, 2740),
        # 12.6: a doubled game.
        ({"mmrBefore": 5400, "mmrGain": 212, "mmrGainGambit": 424, "mmrAfter": 5824, "rankPoint": 5824}, 5824),
        # Gave up with the team at 0 entry cost.
        ({"mmrBefore": 40, "mmrGain": 0, "mmrAfter": 40, "rankPoint": 40, "giveUp": 1}, 40),
    ],
)
def test_rp_change(row: dict[str, int], after: int) -> None:
    result = rp_change({"matchingMode": 3, **row})  # type: ignore[typeddict-item]
    assert result == RpChange(row["mmrBefore"], after)
    assert result.change == after - row["mmrBefore"]


def test_rp_change_other_modes() -> None:
    assert rp_change({"matchingMode": 2, "rankPoint": 0, "mmrGainGambit": 5}) is None
    assert rp_change({"matchingMode": 3}) is None
    assert rp_change({"matchingMode": 3, "mmrBefore": 100}) is None
    assert rp_change({"matchingMode": 3, "mmrBefore": True, "mmrAfter": 5}) is None
    assert rp_change({"matchingMode": 3, "mmrBefore": 100, "mmrAfter": 100.5}) is None


def test_winner_who_gave_up_does_not_change_the_team_result() -> None:
    rows = [
        {"teamNumber": 1, "gameRank": 1, "victory": 0, "giveUp": 1, "duration": 1200},
        {"teamNumber": 1, "gameRank": 1, "victory": 1, "giveUp": 0, "duration": 1300},
    ]
    assert group_teams(rows)[0].victory  # type: ignore[arg-type]


def test_ai_players() -> None:
    bot = {"teamNumber": 8, "gameRank": 1, "victory": 0, "isMLBot": True, "mlbot": True, "characterNum": 5}
    human = {"teamNumber": 1, "gameRank": 7, "victory": 0, "characterNum": 1, "playerKill": 3}
    assert is_bot_player(bot) and not is_bot_player(human)  # type: ignore[arg-type]
    teams = group_teams([human, bot, bot, bot])  # type: ignore[list-item]
    assert [(t.team_number, t.victory, t.bots) for t in teams] == [(8, True, 3), (1, False, 0)]
    s = summarize_games([human, bot])  # type: ignore[list-item]
    assert s.overall.games == 1 and [c.character_num for c in s.characters] == [1]


def test_game_without_a_winner_row_is_over_after_an_hour() -> None:
    # A beginner game against AI players without rows: no row has rank 1.
    players = [{"gameRank": 4, "startDtm": "2026-11-20T21:15:08.008+0900"}]
    start = 1795176908.008
    assert not is_game_finished(players, now=start + 3600)  # type: ignore[arg-type]
    assert is_game_finished(players, now=start + 3601)  # type: ignore[arg-type]
    assert not is_game_finished([{"gameRank": 4}], now=start * 2)
    assert not is_game_finished([], now=start)
    # Without AI players the winner row always comes, so the hour does not apply.
    assert not is_game_finished([{**players[0], "botAdded": 0}], now=start * 2)  # type: ignore[list-item]
    # A trailing Z reads the same on Python 3.10.
    assert is_game_finished([{"gameRank": 4, "startDtm": "2026-11-20T12:15:08.008Z"}], now=start + 3601)


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
        assert seasons.current_ranked_season_id == 43
        assert seasons.player_season_of(43) == 13
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
            names, rank = await asyncio.gather(er.get_names("English"), er.get_user_rank(user["uid"], 43))
            assert rank is not None and rank_tier(rank["mmr"], rank=rank["rank"]).name
            page = await er.get_user_games(user["uid"])
            assert names.character(page.games[0]["characterNum"])

    asyncio.run(main())
