# { "Depends": "py-genlayer:1jb45aa8ynh2a9c9xn3b7qqh8sm5q93hwfp7jqmwsfhh8jpz09h6" }

import typing

try:
    from genlayer import *
except ModuleNotFoundError:
    from genlayer_py import *


ZERO_ADDRESS = Address("0x0000000000000000000000000000000000000000")

BRONZE_XP = 500
SILVER_XP = 700
GOLD_XP = 1000
PLATINUM_XP = 1200
DIAMOND_XP = 1500
WIN_XP = 100
LOSS_XP = 50
MAX_TIER = 4
MAX_DIVISION = 5


@gl.contract_interface
class ProfileFactory:
    class View:
        def get_current_season(self, /) -> u16: ...
        def get_profile_owner(self, profile: Address, /) -> Address: ...
        def is_game_contract(self, game: Address, /) -> bool: ...


class PlayerProfile(gl.Contract):
    factory: Address
    handle: str
    season_id: u16
    rank_tier: u8
    rank_division: u8
    xp: u16
    season_total_xp: u32
    wins: u32
    losses: u32
    lifetime_wins: u32
    lifetime_losses: u32
    processed_matches: TreeMap[str, bool]

    def __init__(self, factory_address: Address, handle: str, season_id: u16):
        self.factory = factory_address
        self.handle = self._clean_handle(handle)
        self.season_id = season_id
        self.rank_tier = u8(0)
        self.rank_division = u8(1)
        self.xp = u16(0)
        self.season_total_xp = u32(0)
        self.wins = u32(0)
        self.losses = u32(0)
        self.lifetime_wins = u32(0)
        self.lifetime_losses = u32(0)

        root = gl.storage.Root.get()
        root.upgraders.get().append(factory_address)

    @gl.public.write
    def set_handle(self, handle: str):
        self._require_profile_owner()
        self._sync_season_if_needed()
        self.handle = self._clean_handle(handle)

    @gl.public.write
    def apply_match_result(self, match_id: str, did_win: bool, mode: str):
        self._require_game_contract()
        self._sync_season_if_needed()

        normalized_match_id = match_id.strip()
        if not normalized_match_id:
            raise Exception("Match id is required.")
        if self.processed_matches.get(normalized_match_id, False):
            return

        self.processed_matches[normalized_match_id] = True

        if did_win:
            self.wins += 1
            self.lifetime_wins += 1
            self.season_total_xp += u32(WIN_XP)
            self._apply_xp_delta(WIN_XP)
        else:
            self.losses += 1
            self.lifetime_losses += 1
            self.season_total_xp = u32(max(0, int(self.season_total_xp) - LOSS_XP))
            self._apply_xp_delta(-LOSS_XP)

    @gl.public.write
    def reset_for_new_season(self, season_id: u16):
        if gl.message.sender_address != self.factory:
            raise Exception("Only the factory can reset a profile season.")
        if season_id <= self.season_id:
            return

        self.season_id = season_id
        self.rank_division = u8(1)
        self.xp = u16(0)
        self.season_total_xp = u32(0)
        self.wins = u32(0)
        self.losses = u32(0)

    @gl.public.view
    def get_handle(self) -> str:
        return self.handle

    @gl.public.view
    def get_owner(self) -> Address:
        return self._factory().view().get_profile_owner(gl.message.contract_address)

    @gl.public.view
    def get_profile(self) -> TreeMap[str, typing.Any]:
        current_season = self._factory().view().get_current_season()
        pending_reset = int(current_season) > int(self.season_id)
        tier_index = int(self.rank_tier)
        xp_required = self._xp_threshold_for_tier(tier_index)
        xp_value = int(self.xp)

        if tier_index == MAX_TIER and int(self.rank_division) == MAX_DIVISION:
            xp_to_next = 0
        else:
            xp_to_next = max(0, xp_required - xp_value)

        return {
            "profile_address": gl.message.contract_address,
            "owner": self._factory().view().get_profile_owner(gl.message.contract_address),
            "handle": self.handle,
            "season_id": self.season_id,
            "current_season_id": current_season,
            "pending_reset": pending_reset,
            "rank_tier": self.rank_tier,
            "rank_tier_name": self._tier_name(tier_index),
            "rank_division": self.rank_division,
            "rank_label": f"{self._tier_name(tier_index)} {int(self.rank_division)}",
            "xp": self.xp,
            "xp_required": u16(xp_required),
            "xp_to_next": u16(xp_to_next),
            "total_xp": self.season_total_xp,
            "wins": self.wins,
            "losses": self.losses,
            "lifetime_wins": self.lifetime_wins,
            "lifetime_losses": self.lifetime_losses,
        }

    def _factory(self) -> ProfileFactory:
        return ProfileFactory(self.factory)

    def _require_profile_owner(self):
        owner = self._factory().view().get_profile_owner(gl.message.contract_address)
        if owner != gl.message.sender_address:
            raise Exception("Only the current profile owner can perform this action.")

    def _require_game_contract(self):
        if not self._factory().view().is_game_contract(gl.message.sender_address):
            raise Exception("Only an approved game contract can apply match results.")

    def _clean_handle(self, handle: str) -> str:
        cleaned = handle.strip()
        if len(cleaned) < 3:
            raise Exception("Profile names must be at least 3 characters.")
        if len(cleaned) > 24:
            raise Exception("Profile names must be 24 characters or fewer.")
        return cleaned

    def _sync_season_if_needed(self):
        current_season = self._factory().view().get_current_season()
        if int(current_season) > int(self.season_id):
            self.season_id = current_season
            self.rank_division = u8(1)
            self.xp = u16(0)
            self.season_total_xp = u32(0)
            self.wins = u32(0)
            self.losses = u32(0)

    def _apply_xp_delta(self, delta: int):
        tier = int(self.rank_tier)
        division = int(self.rank_division)
        xp_value = int(self.xp) + delta

        while xp_value < 0:
            if tier == 0 and division == 1:
                xp_value = 0
                break

            tier, division = self._previous_rank(tier, division)
            xp_value += self._xp_threshold_for_tier(tier)

        while True:
            threshold = self._xp_threshold_for_tier(tier)
            if tier == MAX_TIER and division == MAX_DIVISION:
                xp_value = max(0, min(xp_value, threshold))
                break
            if xp_value < threshold:
                break

            xp_value -= threshold
            tier, division = self._next_rank(tier, division)

        self.rank_tier = u8(tier)
        self.rank_division = u8(division)
        self.xp = u16(max(0, xp_value))

    def _next_rank(self, tier: int, division: int) -> typing.Tuple[int, int]:
        if division < MAX_DIVISION:
            return tier, division + 1
        if tier < MAX_TIER:
            return tier + 1, 1
        return tier, division

    def _previous_rank(self, tier: int, division: int) -> typing.Tuple[int, int]:
        if division > 1:
            return tier, division - 1
        if tier > 0:
            return tier - 1, MAX_DIVISION
        return tier, division

    def _xp_threshold_for_tier(self, tier: int) -> int:
        if tier <= 0:
            return BRONZE_XP
        if tier == 1:
            return SILVER_XP
        if tier == 2:
            return GOLD_XP
        if tier == 3:
            return PLATINUM_XP
        return DIAMOND_XP

    def _tier_name(self, tier: int) -> str:
        if tier <= 0:
            return "Bronze"
        if tier == 1:
            return "Silver"
        if tier == 2:
            return "Gold"
        if tier == 3:
            return "Platinum"
        return "Diamond"
