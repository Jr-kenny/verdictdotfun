# { "Depends": "py-genlayer:1jb45aa8ynh2a9c9xn3b7qqh8sm5q93hwfp7jqmwsfhh8jpz09h6" }

from dataclasses import dataclass
import typing

try:
    from genlayer import *
except ModuleNotFoundError:
    from genlayer_py import *


ZERO_ADDRESS = Address("0x0000000000000000000000000000000000000000")
GATE_BASE = 2  # account level required for a profile's FIRST stone


@allow_storage
@dataclass
class StoneDriver:
    token_id: u256          # the stone this profile currently drives (0 = none)
    last_emitted_level: u16  # highest level already queued for that stone


@allow_storage
@dataclass
class OutboundMessage:
    kind: str               # "mint" | "raise"
    token_id: u256
    profile: Address
    owner: Address
    level: u16
    nonce: u256


class VerdictStone(gl.Contract):
    owner: Address
    operator: Address                                  # trusted caller for sync + inbound facts
    level_of_profile: TreeMap[Address, u16]            # mirrored account level (pushed in)
    profile_of_owner: TreeMap[Address, Address]        # wallet -> profile binding mirror
    effective_level_of_profile: TreeMap[Address, u16]  # perks level (pushed from hub)
    mint_count: TreeMap[Address, u16]                  # stones minted per profile
    driver_of_profile: TreeMap[Address, StoneDriver]
    profile_of_token: TreeMap[str, Address]            # token_id(str) -> current driver profile
    outbox: DynArray[OutboundMessage]
    next_token_id: u256
    next_nonce: u256
    relayed_cursor: u256

    def __init__(self, operator: typing.Any = ZERO_ADDRESS):
        self.owner = gl.message.sender_address
        normalized_operator = self._normalize_address(operator)
        self.operator = normalized_operator if normalized_operator != ZERO_ADDRESS else gl.message.sender_address
        self.next_token_id = u256(1)
        self.next_nonce = u256(1)
        self.relayed_cursor = u256(0)

    def _normalize_address(self, value: typing.Any) -> Address:
        if isinstance(value, Address):
            return value
        if isinstance(value, bytes):
            return Address(value)
        if hasattr(value, "as_bytes"):
            return Address(value.as_bytes)
        return Address(value)

    def _empty_driver(self) -> StoneDriver:
        return StoneDriver(token_id=u256(0), last_emitted_level=u16(0))

    def _gate_for(self, mint_count: int) -> int:
        # Steeper jump per mint (tunable): 2, 4, 7, 11, 16, ... (step grows by 1 each time).
        n = int(mint_count)
        return GATE_BASE + (n * (n + 3)) // 2

    @gl.public.view
    def get_mint_gate(self, profile: Address) -> int:
        return self._gate_for(int(self.mint_count.get(profile, u16(0))))

    @gl.public.view
    def get_effective_level(self, profile: Address) -> int:
        return int(self.effective_level_of_profile.get(profile, u16(0)))

    @gl.public.view
    def get_outbox_len(self) -> int:
        return len(self.outbox)
