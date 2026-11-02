from __future__ import annotations

import re
from collections.abc import Mapping, Sequence
from typing import Any

from .tiers import TierKey

#: Separator used by the official localization files.
L10N_SEPARATOR = "┃"

#: ``bestWeapon`` number → weapon type key in the localization (``WeaponType/{key}``).
#: Numbers 12 and 17 are not used by current games.
WEAPON_TYPES: Mapping[int, str] = {
    1: "Glove",
    2: "Tonfa",
    3: "Bat",
    4: "Whip",
    5: "HighAngleFire",
    6: "DirectFire",
    7: "Bow",
    8: "CrossBow",
    9: "Pistol",
    10: "AssaultRifle",
    11: "SniperRifle",
    13: "Hammer",
    14: "Axe",
    15: "OneHandSword",
    16: "TwoHandSword",
    18: "DualSword",
    19: "Spear",
    20: "Nunchaku",
    21: "Rapier",
    22: "Guitar",
    23: "Camera",
    24: "Arcana",
    25: "VFArm",
}

_TAG = re.compile(r"<[^<>]*>")


def parse_l10n(text: str) -> dict[str, str]:
    """Parses a localization file (``key┃value`` per line) into a dict."""
    entries: dict[str, str] = {}
    for raw in text.split("\n"):
        line = raw[:-1] if raw.endswith("\r") else raw
        at = line.find(L10N_SEPARATOR)
        if at <= 0:
            continue
        entries[line[:at]] = line[at + len(L10N_SEPARATOR) :].strip()
    return entries


def strip_tags(text: str) -> str:
    """Removes rich-text tags such as ``<color=yellow>`` from a localized string."""
    return _TAG.sub("", text).strip()


def names_by_code(l10n: Mapping[str, str], prefix: str) -> dict[int, str]:
    """Picks ``{prefix}{code}`` entries with an integer code: code → name."""
    names: dict[int, str] = {}
    for key, value in l10n.items():
        if not key.startswith(prefix):
            continue
        rest = key[len(prefix) :]
        if not rest.isdigit():
            continue
        name = strip_tags(value)
        code = int(rest)
        if code > 0 and name:
            names[code] = name
    return names


def _first_int(value: Any) -> int | None:
    head = str(value).split(",")[0].strip()
    return int(head) if head.isdigit() and int(head) > 0 else None


def tactical_skill_names(
    l10n: Mapping[str, str],
    groups: Sequence[Mapping[str, Any]],
    sets: Sequence[Mapping[str, Any]],
) -> dict[int, str]:
    """``tacticalSkillGroup`` → name.

    Follows group → start code → skill code and reads
    ``Skill/Group/Name/{skill group}``. When that key is missing, falls back
    to the group icon's number.
    """
    skill_code_by_set: dict[Any, int] = {}
    for row in sets:
        first = _first_int(row.get("skillCode"))
        if first is not None:
            skill_code_by_set[row.get("code")] = first
    names: dict[int, str] = {}
    for row in groups:
        candidates: list[int] = []
        skill_code = skill_code_by_set.get(row.get("startCode"))
        if skill_code:
            candidates.append(skill_code - skill_code % 1000)
        icon = str(row.get("icon") or "").split("_")[-1]
        if icon.isdigit() and int(icon) > 0:
            candidates.append(int(icon))
        group = row.get("group")
        for code in candidates:
            name = strip_tags(l10n.get(f"Skill/Group/Name/{code}", ""))
            if name and isinstance(group, int):
                names[group] = name
                break
    return names


class GameNames:
    """Name lookups for one language. Every method returns None for unknown or missing codes."""

    def __init__(
        self,
        l10n: Mapping[str, str],
        groups: Sequence[Mapping[str, Any]] = (),
        sets: Sequence[Mapping[str, Any]] = (),
    ) -> None:
        self._l10n = l10n
        self._characters = names_by_code(l10n, "Character/Name/")
        self._items = names_by_code(l10n, "Item/Name/")
        self._traits = names_by_code(l10n, "Trait/Name/")
        self._tactical = tactical_skill_names(l10n, groups, sets)

    def _text(self, key: str) -> str | None:
        return strip_tags(self._l10n.get(key, "")) or None

    def character(self, code: int | None) -> str | None:
        return None if code is None else self._characters.get(code)

    def item(self, code: int | None) -> str | None:
        return None if code is None else self._items.get(code)

    def trait(self, code: int | None) -> str | None:
        return None if code is None else self._traits.get(code)

    def weapon(self, best_weapon: int | None) -> str | None:
        """``bestWeapon`` number → weapon type name."""
        key = WEAPON_TYPES.get(best_weapon) if best_weapon is not None else None
        return self._text(f"WeaponType/{key}") if key else None

    def weapon_type(self, key: str | None) -> str | None:
        """By weapon type key, e.g. ``"Glove"``."""
        return self._text(f"WeaponType/{key}") if key else None

    def tactical_skill(self, group: int | None) -> str | None:
        return None if group is None else self._tactical.get(group)

    def tier(self, key: TierKey) -> str | None:
        """Tier name, e.g. ``names.tier(rank_tier(rp).tier)``. Add the division yourself."""
        return self._text("UNRANK" if key == "unranked" else key.upper())
