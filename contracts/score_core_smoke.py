# { "Depends": "py-genlayer:1jb45aa8ynh2a9c9xn3b7qqh8sm5q93hwfp7jqmwsfhh8jpz09h6" }

from dataclasses import dataclass
import typing

try:
    from genlayer import *
except ModuleNotFoundError:
    from genlayer_py import *


ZERO_ADDRESS = Address("0x0000000000000000000000000000000000000000")
WIN_XP = 100
LOSS_XP = 50


@allow_storage
@dataclass
class Profile:
    handle: str
    xp: u32
    wins: u32
    losses: u32


class ScoreCoreSmoke(gl.Contract):
    owner: Address
    approved_games: TreeMap[Address, bool]
    profiles: TreeMap[Address, Profile]
    processed_results: TreeMap[str, bool]

    def __init__(self):
        self.owner = gl.message.sender_address

        root = gl.storage.Root.get()
        root.upgraders.get().append(gl.message.sender_address)

    @gl.public.write
    def register_profile(self, handle: str):
        sender = gl.message.sender_address
        clean_handle = handle.strip()

        if len(clean_handle) < 3:
            raise Exception("Profile names must be at least 3 characters.")
        if len(clean_handle) > 24:
            raise Exception("Profile names must be 24 characters or fewer.")
        if self._has_profile(sender):
            raise Exception("This wallet already has a profile.")

        self.profiles[sender] = Profile(
            handle=clean_handle,
            xp=u32(0),
            wins=u32(0),
            losses=u32(0),
        )

    @gl.public.write
    def set_game_contract(self, game_address: Address, allowed: bool):
        self._require_owner()
        self.approved_games[self._normalize_address(game_address)] = allowed

    @gl.public.write
    def apply_match_result(self, player: Address, match_id: str, did_win: bool, mode: str):
        del mode
        if not self.approved_games.get(gl.message.sender_address, False):
            raise Exception("Only approved game contracts can report match results.")

        normalized_player = self._normalize_address(player)
        if not self._has_profile(normalized_player):
            raise Exception("The target player does not have a registered profile.")

        normalized_match_id = match_id.strip().upper()
        if not normalized_match_id:
            raise Exception("Match id is required.")

        result_key = self._result_key(normalized_player, normalized_match_id)
        if self.processed_results.get(result_key, False):
            return

        profile = self.profiles[normalized_player]
        if did_win:
            profile.xp += u32(WIN_XP)
            profile.wins += u32(1)
        else:
            profile.xp += u32(LOSS_XP)
            profile.losses += u32(1)

        self.profiles[normalized_player] = profile
        self.processed_results[result_key] = True

    @gl.public.view
    def get_profile(self, owner: Address) -> TreeMap[str, typing.Any]:
        normalized_owner = self._normalize_address(owner)
        if not self._has_profile(normalized_owner):
            return {
                "owner": normalized_owner,
                "handle": "",
                "xp": u32(0),
                "wins": u32(0),
                "losses": u32(0),
            }

        profile = self.profiles[normalized_owner]
        return {
            "owner": normalized_owner,
            "handle": profile.handle,
            "xp": profile.xp,
            "wins": profile.wins,
            "losses": profile.losses,
        }

    @gl.public.view
    def get_self_address(self) -> Address:
        return gl.message.contract_address

    def _has_profile(self, owner: Address) -> bool:
        profile = self.profiles.get(owner)
        return profile is not None and bool(profile.handle)

    def _normalize_address(self, value: typing.Any) -> Address:
        if isinstance(value, Address):
            return value
        return Address(str(value))

    def _require_owner(self):
        if gl.message.sender_address != self.owner:
            raise Exception("Only the contract owner can perform this action.")

    def _result_key(self, player: Address, match_id: str) -> str:
        return f"{match_id}:{str(player).lower()}"
