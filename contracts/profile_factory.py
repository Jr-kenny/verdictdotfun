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
        def get_handle(self, /) -> str: ...

    class Write:
        def reset_for_new_season(self, season_id: u16, /) -> None: ...


class ProfileFactory(gl.Contract):
    owner: Address
    current_season: u16
    profile_code: str
    profile_addresses: DynArray[Address]
    owner_to_profile: TreeMap[Address, Address]
    profile_to_owner: TreeMap[Address, Address]
    approved_games: TreeMap[Address, bool]
    operators: TreeMap[Address, bool]

    def __init__(self, initial_season: u16 = u16(1), profile_code: str = ""):
        self.owner = gl.message.sender_address
        self.current_season = initial_season
        self.profile_code = profile_code or Path(__file__).with_name("player_profile.py").read_text("utf-8")

        root = gl.storage.Root.get()
        root.upgraders.get().append(gl.message.sender_address)

    @gl.public.write
    def create_profile(self, handle: str) -> Address:
        sender = gl.message.sender_address
        if self.owner_to_profile.get(sender, ZERO_ADDRESS) != ZERO_ADDRESS:
            raise Exception("This wallet already owns a profile.")

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
    def approve_game_contract(self, game_address: Address, allowed: bool):
        self._require_owner()
        self.approved_games[self._normalize_address(game_address)] = allowed

    @gl.public.write
    def set_operator(self, operator: Address, allowed: bool):
        self._require_owner()
        self.operators[self._normalize_address(operator)] = allowed

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
            return {
                "profile_address": ZERO_ADDRESS,
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
                "wins": u32(0),
                "losses": u32(0),
                "lifetime_wins": u32(0),
                "lifetime_losses": u32(0),
            }
        return PlayerProfile(profile_address).view().get_profile()

    @gl.public.view
    def get_profile_by_address(self, profile_address: Address) -> TreeMap[str, typing.Any]:
        normalized_profile = self._normalize_address(profile_address)
        if self.profile_to_owner.get(normalized_profile, ZERO_ADDRESS) == ZERO_ADDRESS:
            return {
                "profile_address": ZERO_ADDRESS,
                "owner": ZERO_ADDRESS,
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
                "wins": u32(0),
                "losses": u32(0),
                "lifetime_wins": u32(0),
                "lifetime_losses": u32(0),
            }
        return PlayerProfile(normalized_profile).view().get_profile()

    def _require_owner(self):
        if gl.message.sender_address != self.owner:
            raise Exception("Only the contract owner can perform this action.")

    def _require_operator(self):
        if gl.message.sender_address == self.owner:
            return
        if self.operators.get(gl.message.sender_address, False):
            return
        raise Exception("Only an authorized operator can perform this action.")

    def _normalize_address(self, value: typing.Any) -> Address:
        if isinstance(value, Address):
            return value
        if isinstance(value, bytes):
            return Address(value)
        if hasattr(value, "as_bytes"):
            return Address(value.as_bytes)
        return Address(value)
