"""Unofficial Python client for the Eternal Return Open API, from ERCraft."""

from .cache import DEFAULT_CACHE_TTL, CacheKind, CacheStore, MemoryCache, cache_kind_of
from .client import (
    DEFAULT_BASE_URL,
    AsyncErClient,
    ErClient,
    ErrorEvent,
    GameEvent,
    SyncResult,
    UserGamesPage,
    WatchEvent,
)
from .errors import ErApiError, ErNicknameMismatchError
from .games import (
    CharacterSummary,
    GamesSummary,
    GameSummary,
    GameTeam,
    group_teams,
    is_game_finished,
    summarize_games,
)
from .limiter import AsyncRateLimiter, RateLimiter
from .modes import GameModeName, MatchingMode, TeamMode, game_mode_name
from .names import L10N_SEPARATOR, WEAPON_TYPES, GameNames, parse_l10n, strip_tags
from .seasons import SeasonCatalog, parse_season_number, to_player_season
from .tiers import LATEST_TIER_SEASON, RankTier, TierKey, rank_tier
from .types import Envelope, ErUser, UserGame

__version__ = "0.1.0"

__all__ = [
    "DEFAULT_BASE_URL",
    "DEFAULT_CACHE_TTL",
    "L10N_SEPARATOR",
    "LATEST_TIER_SEASON",
    "WEAPON_TYPES",
    "AsyncErClient",
    "AsyncRateLimiter",
    "CacheKind",
    "CacheStore",
    "CharacterSummary",
    "Envelope",
    "ErApiError",
    "ErClient",
    "ErNicknameMismatchError",
    "ErUser",
    "ErrorEvent",
    "GameEvent",
    "GameModeName",
    "GameNames",
    "GameSummary",
    "GameTeam",
    "GamesSummary",
    "MatchingMode",
    "MemoryCache",
    "RankTier",
    "RateLimiter",
    "SeasonCatalog",
    "SyncResult",
    "TeamMode",
    "TierKey",
    "UserGame",
    "UserGamesPage",
    "WatchEvent",
    "cache_kind_of",
    "game_mode_name",
    "group_teams",
    "is_game_finished",
    "parse_l10n",
    "parse_season_number",
    "rank_tier",
    "strip_tags",
    "summarize_games",
    "to_player_season",
]
