# { "Depends": "py-genlayer:1jb45aa8ynh2a9c9xn3b7qqh8sm5q93hwfp7jqmwsfhh8jpz09h6" }

from pathlib import Path
import typing

try:
    from genlayer import *
except ModuleNotFoundError:
    from genlayer_py import *


ZERO_ADDRESS = Address("0x0000000000000000000000000000000000000000")


@gl.contract_interface
class PlayerProfile:
    class View:
        def get_profile(self, /) -> TreeMap[str, typing.Any]: ...

    class Write:
        def reset_for_new_season(self, season_id: u16, /) -> None: ...


@gl.contract_interface
class ChildRoomContract:
    class Write:
        def create_room(self, room_id: str, category: str, owner_profile: Address = ZERO_ADDRESS, /) -> None: ...


class VDTCore(gl.Contract):
    owner: Address
    current_season: u16
    profile_code: str
    profile_addresses: DynArray[Address]
    owner_to_profile: TreeMap[Address, Address]
    profile_to_owner: TreeMap[Address, Address]
    approved_games: TreeMap[Address, bool]
    operators: TreeMap[Address, bool]
    # Keep the legacy ProfileFactory storage prefix intact so upgrades remain compatible.
    debate_code: str
    convince_code: str
    quiz_code: str
    riddle_code: str
    room_ids: DynArray[str]
    room_to_contract: TreeMap[str, Address]
    room_to_mode: TreeMap[str, str]

    def __init__(
        self,
        initial_season: u16 = u16(1),
        profile_code: str = "",
        debate_code: str = "",
        convince_code: str = "",
        quiz_code: str = "",
        riddle_code: str = "",
    ):
        self.owner = gl.message.sender_address
        self.current_season = initial_season
        self.profile_code = self._load_local_code(profile_code, "player_profile.py")
        self.debate_code = self._load_local_code(debate_code, "debate_game.py")
        self.convince_code = self._load_local_code(convince_code, "convince_me_game.py")
        self.quiz_code = self._load_local_code(quiz_code, "quiz_game.py")
        self.riddle_code = self._load_local_code(riddle_code, "riddle_game.py")

        root = gl.storage.Root.get()
        root.upgraders.get().append(gl.message.sender_address)

    @gl.public.write
    def create_profile(self, handle: str) -> Address:
        sender = gl.message.sender_address
        if self.owner_to_profile.get(sender, ZERO_ADDRESS) != ZERO_ADDRESS:
            raise Exception("This wallet already owns a profile.")
        if not self.profile_code:
            raise Exception("Player profile code is not configured.")

        salt_nonce = u256(len(self.profile_addresses) + 1)
        profile_address = gl.deploy_contract(
            code=self.profile_code.encode("utf-8"),
            args=[gl.message.contract_address, handle, self.current_season],
            salt_nonce=salt_nonce,
            on="accepted",
        )

        self.profile_addresses.append(profile_address)
        self.owner_to_profile[sender] = profile_address
        self.profile_to_owner[profile_address] = sender
        return profile_address

    @gl.public.write
    def transfer_profile(self, new_owner: Address):
        sender = gl.message.sender_address
        profile = self.owner_to_profile.get(sender, ZERO_ADDRESS)
        target_owner = self._normalize_address(new_owner)

        if profile == ZERO_ADDRESS:
            raise Exception("This wallet does not own a profile.")
        if target_owner == ZERO_ADDRESS:
            raise Exception("Transfer target cannot be the zero address.")
        if target_owner == sender:
            raise Exception("Transfer target must be a different wallet.")
        if self.owner_to_profile.get(target_owner, ZERO_ADDRESS) != ZERO_ADDRESS:
            raise Exception("The target wallet already owns a profile.")

        self.owner_to_profile[sender] = ZERO_ADDRESS
        self.owner_to_profile[target_owner] = profile
        self.profile_to_owner[profile] = target_owner

    @gl.public.write
    def create_room(self, mode: str, room_id: str, category: str, owner_profile: Address = ZERO_ADDRESS) -> Address:
        normalized_id = room_id.strip().upper()
        normalized_mode = self._normalize_mode(mode)
        normalized_profile = self._normalize_address(owner_profile)

        if not normalized_id:
            raise Exception("Room id is required.")
        if normalized_id in self.room_to_contract:
            raise Exception("Room already exists.")
        if normalized_profile == ZERO_ADDRESS:
            raise Exception("A profile contract is required to create a room.")

        self._require_profile_owner(normalized_profile)
        room_code = self._code_for_mode(normalized_mode)
        if not room_code:
            raise Exception("This room mode is not configured.")

        salt_nonce = u256(len(self.room_ids) + 1)
        room_address = gl.deploy_contract(
            code=room_code.encode("utf-8"),
            args=[gl.message.contract_address, True],
            salt_nonce=salt_nonce,
            on="accepted",
        )

        self.room_ids.append(normalized_id)
        self.room_to_contract[normalized_id] = room_address
        self.room_to_mode[normalized_id] = normalized_mode
        self.approved_games[room_address] = True

        ChildRoomContract(room_address).emit(on="finalized").create_room(normalized_id, category, normalized_profile)
        return room_address

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
        clean_code = code.strip()
        if not clean_code:
            raise Exception("Profile code cannot be empty.")
        self.profile_code = clean_code

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
            PlayerProfile(profile_address).emit(on="finalized").reset_for_new_season(self.current_season)

    @gl.public.write
    def set_room_code(self, mode: str, code: str):
        self._require_owner()
        normalized_mode = self._normalize_mode(mode)
        clean_code = code.strip()
        if not clean_code:
            raise Exception("Room code cannot be empty.")

        if normalized_mode == "debate":
            self.debate_code = clean_code
        elif normalized_mode == "convince":
            self.convince_code = clean_code
        elif normalized_mode == "quiz":
            self.quiz_code = clean_code
        else:
            self.riddle_code = clean_code

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

        profile = PlayerProfile(profile_address).view().get_profile()
        if profile is None:
            return self._empty_profile(owner, profile_address)
        return profile

    @gl.public.view
    def get_profile_by_address(self, profile_address: Address) -> TreeMap[str, typing.Any]:
        normalized_profile = self._normalize_address(profile_address)
        if self.profile_to_owner.get(normalized_profile, ZERO_ADDRESS) == ZERO_ADDRESS:
            return self._empty_profile(ZERO_ADDRESS, ZERO_ADDRESS)
        profile = PlayerProfile(normalized_profile).view().get_profile()
        if profile is None:
            return self._empty_profile(self.profile_to_owner.get(normalized_profile, ZERO_ADDRESS), normalized_profile)
        return profile

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

    def _normalize_mode(self, mode: str) -> str:
        normalized = mode.strip().lower()
        if normalized in ["debate", "convince", "quiz", "riddle"]:
            return normalized
        raise Exception("Unsupported game mode.")

    def _code_for_mode(self, mode: str) -> str:
        if mode == "debate":
            return self.debate_code
        if mode == "convince":
            return self.convince_code
        if mode == "quiz":
            return self.quiz_code
        return self.riddle_code

    def _load_local_code(self, provided_code: str, filename: str) -> str:
        clean_code = provided_code.strip()
        if clean_code:
            return clean_code

        try:
            return Path(__file__).parent.joinpath(filename).read_text("utf-8").strip()
        except Exception:
            return ""

    def _normalize_address(self, value: typing.Any) -> Address:
        if isinstance(value, Address):
            return value
        if isinstance(value, bytes):
            return Address(value)
        if hasattr(value, "as_bytes"):
            return Address(value.as_bytes)
        return Address(value)

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
