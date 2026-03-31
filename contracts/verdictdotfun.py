# { "Depends": "py-genlayer:1jb45aa8ynh2a9c9xn3b7qqh8sm5q93hwfp7jqmwsfhh8jpz09h6" }

from dataclasses import dataclass
import hashlib
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
class GameModeContract:
    class Write:
        def create_room(
            self,
            room_id: str,
            category: str,
            owner_profile: Address = ZERO_ADDRESS,
            argue_style: str = "debate",
            /,
        ) -> None: ...


@allow_storage
@dataclass
class StoredProfile:
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


class VerdictDotFun(gl.Contract):
    owner: Address
    current_season: u16
    profile_code: str
    profile_addresses: DynArray[Address]
    owner_to_profile: TreeMap[Address, Address]
    profile_to_owner: TreeMap[Address, Address]
    approved_games: TreeMap[Address, bool]
    operators: TreeMap[Address, bool]
    debate_code: str
    convince_code: str
    riddle_code: str
    room_ids: DynArray[str]
    room_to_contract: TreeMap[str, Address]
    room_to_mode: TreeMap[str, str]
    room_to_owner_profile: TreeMap[str, Address]
    room_to_category: TreeMap[str, str]
    profiles: TreeMap[Address, StoredProfile]
    processed_results: TreeMap[str, bool]
    debate_contract: Address
    convince_contract: Address
    riddle_contract: Address

    def __init__(
        self,
        initial_season: u16 = u16(1),
        profile_code: str = "",
        debate_code: str = "",
        convince_code: str = "",
        riddle_code: str = "",
    ):
        self.owner = gl.message.sender_address
        self.current_season = initial_season
        self.profile_code = profile_code.strip()
        self.debate_code = ""
        self.convince_code = ""
        self.riddle_code = ""
        self.debate_contract = ZERO_ADDRESS
        self.convince_contract = ZERO_ADDRESS
        self.riddle_contract = ZERO_ADDRESS

        root = gl.storage.Root.get()
        root.upgraders.get().append(gl.message.sender_address)

        if debate_code.strip():
            self._initialize_mode_contract_internal("argue", debate_code)
        if riddle_code.strip():
            self._initialize_mode_contract_internal("riddle", riddle_code)

    @gl.public.write
    def create_profile(self, handle: str) -> Address:
        sender = gl.message.sender_address
        if self.owner_to_profile.get(sender, ZERO_ADDRESS) != ZERO_ADDRESS:
            raise Exception("This wallet already owns a profile.")

        normalized_handle = self._clean_handle(handle)
        profile_address = self._generate_profile_address(sender)

        self.profile_addresses.append(profile_address)
        self.owner_to_profile[sender] = profile_address
        self.profile_to_owner[profile_address] = sender
        self.profiles[profile_address] = StoredProfile(
            handle=normalized_handle,
            season_id=self.current_season,
            rank_tier=u8(0),
            rank_division=u8(1),
            xp=u16(0),
            season_total_xp=u32(0),
            wins=u32(0),
            losses=u32(0),
            lifetime_wins=u32(0),
            lifetime_losses=u32(0),
        )
        return profile_address

    @gl.public.write
    def set_handle(self, profile_address: Address, handle: str):
        normalized_profile = self._normalize_address(profile_address)
        self._require_profile_owner(normalized_profile)
        profile = self._require_profile_record(normalized_profile)
        self._sync_profile_season_if_needed(profile)
        profile.handle = self._clean_handle(handle)
        self.profiles[normalized_profile] = profile

    @gl.public.write
    def apply_match_result(self, profile_address: Address, match_id: str, did_win: bool, mode: str):
        del mode
        if not self.approved_games.get(gl.message.sender_address, False):
            raise Exception("Only approved game contracts can apply match results.")

        normalized_profile = self._normalize_address(profile_address)
        profile = self._require_profile_record(normalized_profile)
        normalized_match_id = match_id.strip().upper()

        if not normalized_match_id:
            raise Exception("Match id is required.")

        processed_key = self._processed_result_key(normalized_profile, normalized_match_id)
        if self.processed_results.get(processed_key, False):
            return

        self._sync_profile_season_if_needed(profile)

        if did_win:
            profile.wins += u32(1)
            profile.lifetime_wins += u32(1)
            profile.season_total_xp += u32(WIN_XP)
            self._apply_xp_delta(profile, WIN_XP)
        else:
            profile.losses += u32(1)
            profile.lifetime_losses += u32(1)
            profile.season_total_xp = u32(max(0, int(profile.season_total_xp) - LOSS_XP))
            self._apply_xp_delta(profile, -LOSS_XP)

        self.profiles[normalized_profile] = profile
        self.processed_results[processed_key] = True

    @gl.public.write
    def create_room(
        self,
        mode: str,
        room_id: str,
        category: str,
        owner_profile: Address = ZERO_ADDRESS,
        argue_style: str = "debate",
    ) -> Address:
        normalized_id = room_id.strip().upper()
        normalized_mode = self._normalize_mode(mode)
        normalized_profile = self._normalize_address(owner_profile)
        normalized_style = self._normalize_argue_style(argue_style)

        if not normalized_id:
            raise Exception("Room id is required.")
        if normalized_id in self.room_to_contract:
            raise Exception("Room already exists.")
        if normalized_profile == ZERO_ADDRESS:
            raise Exception("A profile contract is required to create a room.")

        self._require_profile_owner(normalized_profile)
        room_contract = self._contract_for_mode(normalized_mode)
        if room_contract == ZERO_ADDRESS:
            raise Exception("This room mode is not configured.")

        self.room_ids.append(normalized_id)
        self.room_to_contract[normalized_id] = room_contract
        self.room_to_mode[normalized_id] = normalized_mode
        self.room_to_owner_profile[normalized_id] = normalized_profile
        self.room_to_category[normalized_id] = category.strip()
        self.approved_games[room_contract] = True

        GameModeContract(room_contract).emit(on="accepted").create_room(
            normalized_id,
            category,
            normalized_profile,
            normalized_style,
        )
        return room_contract

    @gl.public.write
    def approve_game_contract(self, game_address: Address, allowed: bool):
        self._require_owner()
        self.approved_games[self._normalize_address(game_address)] = allowed

    @gl.public.write
    def set_operator(self, operator: Address, allowed: bool):
        self._require_owner()
        self.operators[self._normalize_address(operator)] = allowed

    @gl.public.write
    def set_profile_code(self, code: str):
        self._require_owner()
        self.profile_code = code.strip()

    @gl.public.write
    def set_room_code(self, mode: str, code: str):
        self._require_owner()
        normalized_mode = self._normalize_mode(mode)
        clean_code = code.strip()

        if normalized_mode == "argue":
            self.debate_code = clean_code
        else:
            self.riddle_code = clean_code

    @gl.public.write
    def set_mode_contract(self, mode: str, contract_address: Address):
        self._require_owner()
        normalized_mode = self._normalize_mode(mode)
        normalized_address = self._normalize_address(contract_address)
        previous = self._contract_for_mode(normalized_mode)

        if previous != ZERO_ADDRESS and previous != normalized_address:
            self.approved_games[previous] = False

        if normalized_mode == "argue":
            self.debate_contract = normalized_address
        else:
            self.riddle_contract = normalized_address

        if normalized_address != ZERO_ADDRESS:
            self.approved_games[normalized_address] = True

    @gl.public.write
    def initialize_mode_contract(self, mode: str, code: str) -> Address:
        self._require_owner()
        return self._initialize_mode_contract_internal(mode, code)

    @gl.public.write
    def start_new_season(self, season_id: u16):
        self._require_operator()
        if season_id <= self.current_season:
            raise Exception("Season id must be greater than the current season.")
        self.current_season = season_id

    @gl.public.write
    def reset_profiles_batch(self, start_index: u32, batch_size: u32):
        self._require_operator()

        start = int(start_index)
        size = int(batch_size)
        if size <= 0:
            raise Exception("Batch size must be greater than zero.")

        total = len(self.profile_addresses)
        end = min(total, start + size)

        for index in range(start, end):
            profile_address = self.profile_addresses[index]
            profile = self._require_profile_record(profile_address)
            if self.current_season <= profile.season_id:
                continue

            profile.season_id = self.current_season
            profile.rank_division = u8(1)
            profile.xp = u16(0)
            profile.season_total_xp = u32(0)
            profile.wins = u32(0)
            profile.losses = u32(0)
            self.profiles[profile_address] = profile

    @gl.public.write
    def upgrade(self, new_code: bytes):
        self._require_owner()
        root = gl.storage.Root.get()
        code = root.code.get()
        code.truncate()
        code.extend(new_code)

    @gl.public.view
    def get_current_season(self) -> u16:
        return self.current_season

    @gl.public.view
    def get_profile_of_owner(self, owner: Address) -> Address:
        return self.owner_to_profile.get(self._normalize_address(owner), ZERO_ADDRESS)

    @gl.public.view
    def get_profile_owner(self, profile: Address) -> Address:
        return self.profile_to_owner.get(self._normalize_address(profile), ZERO_ADDRESS)

    @gl.public.view
    def is_registered_profile(self, profile: Address) -> bool:
        return self.profile_to_owner.get(self._normalize_address(profile), ZERO_ADDRESS) != ZERO_ADDRESS

    @gl.public.view
    def is_game_contract(self, game: Address) -> bool:
        return self.approved_games.get(self._normalize_address(game), False)

    @gl.public.view
    def get_profile_count(self) -> u32:
        return u32(len(self.profile_addresses))

    @gl.public.view
    def get_profile_at(self, index: u32) -> Address:
        idx = int(index)
        if idx < 0 or idx >= len(self.profile_addresses):
            return ZERO_ADDRESS
        return self.profile_addresses[idx]

    @gl.public.view
    def get_profile(self, owner: Address) -> TreeMap[str, typing.Any]:
        profile_address = self.owner_to_profile.get(self._normalize_address(owner), ZERO_ADDRESS)
        if profile_address == ZERO_ADDRESS:
            return self._empty_profile(owner, ZERO_ADDRESS)
        return self._serialize_profile(profile_address)

    @gl.public.view
    def get_profile_by_address(self, profile_address: Address) -> TreeMap[str, typing.Any]:
        normalized_profile = self._normalize_address(profile_address)
        if self.profile_to_owner.get(normalized_profile, ZERO_ADDRESS) == ZERO_ADDRESS:
            return self._empty_profile(ZERO_ADDRESS, ZERO_ADDRESS)
        return self._serialize_profile(normalized_profile)

    @gl.public.view
    def get_mode_contract(self, mode: str) -> Address:
        return self._contract_for_mode(self._normalize_mode(mode))

    @gl.public.view
    def get_leaderboard(self, limit: u32 = u32(20)) -> DynArray[Address]:
        max_entries = max(0, int(limit))
        ordered: typing.List[typing.Tuple[typing.Tuple[int, int, int, int, int], Address]] = []

        for index in range(len(self.profile_addresses)):
            candidate = self.profile_addresses[index]
            candidate_profile = self.get_profile_by_address(candidate)
            candidate_key = self._profile_sort_key(candidate_profile)
            insert_at = len(ordered)

            for slot in range(len(ordered)):
                existing_key, _ = ordered[slot]
                if candidate_key > existing_key:
                    insert_at = slot
                    break

            ordered.insert(insert_at, (candidate_key, candidate))

        if max_entries == 0:
            return []

        return [ordered[index][1] for index in range(min(len(ordered), max_entries))]

    @gl.public.view
    def get_room_ids(self) -> DynArray[str]:
        return self.room_ids

    @gl.public.view
    def get_room_contract(self, room_id: str) -> Address:
        return self.room_to_contract.get(room_id.strip().upper(), ZERO_ADDRESS)

    @gl.public.view
    def get_room_mode(self, room_id: str) -> str:
        return self.room_to_mode.get(room_id.strip().upper(), "")

    @gl.public.view
    def get_room_registry_entry(self, room_id: str) -> TreeMap[str, typing.Any]:
        normalized_id = room_id.strip().upper()
        room_contract = self.room_to_contract.get(normalized_id, ZERO_ADDRESS)
        room_mode = self.room_to_mode.get(normalized_id, "")
        owner_profile = self.room_to_owner_profile.get(normalized_id, ZERO_ADDRESS)

        if room_contract == ZERO_ADDRESS or not room_mode or owner_profile == ZERO_ADDRESS:
            return {
                "id": "",
                "mode": "",
                "contract": ZERO_ADDRESS,
                "owner_profile": ZERO_ADDRESS,
                "owner": ZERO_ADDRESS,
                "owner_name": "",
                "category": "",
            }

        owner_profile_data = self._serialize_profile(owner_profile)

        return {
            "id": normalized_id,
            "mode": room_mode,
            "contract": room_contract,
            "owner_profile": owner_profile,
            "owner": self.profile_to_owner.get(owner_profile, ZERO_ADDRESS),
            "owner_name": owner_profile_data["handle"],
            "category": self.room_to_category.get(normalized_id, ""),
        }

    def _require_owner(self):
        if gl.message.sender_address != self.owner:
            raise Exception("Only the contract owner can perform this action.")

    def _require_operator(self):
        if gl.message.sender_address == self.owner:
            return
        if self.operators.get(gl.message.sender_address, False):
            return
        raise Exception("Only an authorized operator can perform this action.")

    def _require_profile_owner(self, profile_address: Address) -> Address:
        normalized_profile = self._normalize_address(profile_address)
        if not self.is_registered_profile(normalized_profile):
            raise Exception("Register a profile before creating a room.")

        owner = self.profile_to_owner[normalized_profile]
        if owner != gl.message.sender_address:
            raise Exception("Only the current holder of this profile can perform that action.")
        return owner

    def _require_profile_record(self, profile_address: Address) -> StoredProfile:
        normalized_profile = self._normalize_address(profile_address)
        if not self.is_registered_profile(normalized_profile):
            raise Exception("Register a profile before interacting with Verdict Arena.")

        profile = self.profiles.get(normalized_profile)
        if profile is None or not profile.handle:
            raise Exception("Profile state is missing.")
        return profile

    def _normalize_mode(self, mode: str) -> str:
        normalized = mode.strip().lower()
        if normalized in ["argue", "riddle"]:
            return normalized
        if normalized in ["debate", "convince"]:
            return "argue"
        raise Exception("Unsupported game mode.")

    def _normalize_argue_style(self, argue_style: str) -> str:
        normalized = argue_style.strip().lower()
        if normalized in ["", "debate"]:
            return "debate"
        if normalized == "convince":
            return "convince"
        raise Exception("Unsupported argue style.")

    def _contract_for_mode(self, mode: str) -> Address:
        normalized_mode = self._normalize_mode(mode)
        if normalized_mode == "argue":
            return self.debate_contract
        return self.riddle_contract

    def _mode_salt(self, mode: str) -> u256:
        normalized_mode = self._normalize_mode(mode)
        if normalized_mode == "argue":
            return u256(1)
        return u256(2)

    def _initialize_mode_contract_internal(self, mode: str, code: str) -> Address:
        normalized_mode = self._normalize_mode(mode)
        clean_code = code.strip()

        if not clean_code:
            raise Exception("Mode contract code is required.")
        if self._contract_for_mode(normalized_mode) != ZERO_ADDRESS:
            raise Exception("Mode contract already initialized.")

        child_address = gl.deploy_contract(
            code=clean_code.encode("utf-8"),
            args=[gl.message.contract_address],
            salt_nonce=self._mode_salt(normalized_mode),
            on="accepted",
        )

        if normalized_mode == "argue":
            self.debate_contract = child_address
        else:
            self.riddle_contract = child_address

        self.approved_games[child_address] = True
        return child_address

    def _normalize_address(self, value: typing.Any) -> Address:
        if isinstance(value, Address):
            return value
        if isinstance(value, bytes):
            return Address(value)
        if hasattr(value, "as_bytes"):
            return Address(value.as_bytes)
        return Address(value)

    def _generate_profile_address(self, owner: Address) -> Address:
        seed = f"{str(owner).lower()}:{len(self.profile_addresses) + 1}".encode("utf-8")
        return Address(hashlib.sha256(seed).digest()[:20])

    def _clean_handle(self, handle: str) -> str:
        cleaned = handle.strip()
        if len(cleaned) < 3:
            raise Exception("Profile names must be at least 3 characters.")
        if len(cleaned) > 24:
            raise Exception("Profile names must be 24 characters or fewer.")
        return cleaned

    def _serialize_profile(self, profile_address: Address) -> TreeMap[str, typing.Any]:
        normalized_profile = self._normalize_address(profile_address)
        owner = self.profile_to_owner.get(normalized_profile, ZERO_ADDRESS)
        if owner == ZERO_ADDRESS:
            return self._empty_profile(ZERO_ADDRESS, ZERO_ADDRESS)

        profile = self._require_profile_record(normalized_profile)
        pending_reset = int(self.current_season) > int(profile.season_id)
        tier_index = int(profile.rank_tier)
        xp_required = self._xp_threshold_for_tier(tier_index)
        xp_value = int(profile.xp)

        if tier_index == MAX_TIER and int(profile.rank_division) == MAX_DIVISION:
            xp_to_next = 0
        else:
            xp_to_next = max(0, xp_required - xp_value)

        return {
            "profile_address": normalized_profile,
            "owner": owner,
            "handle": profile.handle,
            "season_id": profile.season_id,
            "current_season_id": self.current_season,
            "pending_reset": pending_reset,
            "rank_tier": profile.rank_tier,
            "rank_tier_name": self._tier_name(tier_index),
            "rank_division": profile.rank_division,
            "rank_label": f"{self._tier_name(tier_index)} {int(profile.rank_division)}",
            "xp": profile.xp,
            "xp_required": u16(xp_required),
            "xp_to_next": u16(xp_to_next),
            "total_xp": profile.season_total_xp,
            "wins": profile.wins,
            "losses": profile.losses,
            "lifetime_wins": profile.lifetime_wins,
            "lifetime_losses": profile.lifetime_losses,
        }

    def _sync_profile_season_if_needed(self, profile: StoredProfile):
        if int(self.current_season) <= int(profile.season_id):
            return

        profile.season_id = self.current_season
        profile.rank_division = u8(1)
        profile.xp = u16(0)
        profile.season_total_xp = u32(0)
        profile.wins = u32(0)
        profile.losses = u32(0)

    def _apply_xp_delta(self, profile: StoredProfile, delta: int):
        tier = int(profile.rank_tier)
        division = int(profile.rank_division)
        xp_value = int(profile.xp) + delta

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

        profile.rank_tier = u8(tier)
        profile.rank_division = u8(division)
        profile.xp = u16(max(0, xp_value))

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

    def _processed_result_key(self, profile: Address, match_id: str) -> str:
        return f"{match_id}:{str(profile).lower()}"

    def _profile_sort_key(self, profile: TreeMap[str, typing.Any]) -> typing.Tuple[int, int, int, int, int]:
        rank_tier = int(profile.get("rank_tier", u8(0)))
        rank_division = int(profile.get("rank_division", u8(1)))
        total_xp = int(profile.get("total_xp", u32(0)))
        wins = int(profile.get("wins", u32(0)))
        xp = int(profile.get("xp", u16(0)))
        return rank_tier, rank_division, total_xp, wins, xp

    def _empty_profile(self, owner: Address, profile_address: Address) -> TreeMap[str, typing.Any]:
        return {
            "profile_address": profile_address,
            "owner": owner,
            "handle": "",
            "season_id": self.current_season,
            "current_season_id": self.current_season,
            "pending_reset": False,
            "rank_tier": u8(0),
            "rank_tier_name": "Bronze",
            "rank_division": u8(1),
            "rank_label": "Bronze 1",
            "xp": u16(0),
            "xp_required": u16(500),
            "xp_to_next": u16(500),
            "total_xp": u32(0),
            "wins": u32(0),
            "losses": u32(0),
            "lifetime_wins": u32(0),
            "lifetime_losses": u32(0),
        }
