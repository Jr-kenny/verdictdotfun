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

    def _require_operator(self):
        if gl.message.sender_address != self.operator and gl.message.sender_address != self.owner:
            raise gl.vm.UserError("[EXPECTED] Only the operator may call this.")

    def _enqueue(self, kind: str, token_id: u256, profile: Address, owner: Address, level: u16):
        self.outbox.append(OutboundMessage(
            kind=kind, token_id=token_id, profile=profile, owner=owner, level=level, nonce=self.next_nonce,
        ))
        self.next_nonce = self.next_nonce + u256(1)

    @gl.public.view
    def get_mint_gate(self, profile: Address) -> int:
        key = self._normalize_address(profile)
        return self._gate_for(int(self.mint_count.get(key, u16(0))))

    @gl.public.view
    def get_effective_level(self, profile: Address) -> int:
        key = self._normalize_address(profile)
        return int(self.effective_level_of_profile.get(key, u16(0)))

    @gl.public.view
    def get_outbox_len(self) -> int:
        return len(self.outbox)

    @gl.public.view
    def get_relayed_cursor(self) -> int:
        return int(self.relayed_cursor)

    @gl.public.view
    def get_outbox_message(self, index: int) -> TreeMap[str, typing.Any]:
        m = self.outbox[index]
        return {
            "kind": m.kind,
            "token_id": int(m.token_id),
            "profile": m.profile,
            "owner": m.owner,
            "level": int(m.level),
            "nonce": int(m.nonce),
        }

    @gl.public.write
    def sync_level(self, profile: Address, level: u16, owner: Address = ZERO_ADDRESS):
        self._require_operator()
        profile = self._normalize_address(profile)
        owner = self._normalize_address(owner)
        self.level_of_profile[profile] = u16(int(level))
        if owner != ZERO_ADDRESS:
            self.profile_of_owner[owner] = profile
        driver = self.driver_of_profile.get(profile, self._empty_driver())
        if int(driver.token_id) != 0 and int(level) > int(driver.last_emitted_level):
            self._enqueue("raise", driver.token_id, profile, ZERO_ADDRESS, u16(int(level)))
            self.driver_of_profile[profile] = StoneDriver(token_id=driver.token_id, last_emitted_level=u16(int(level)))

    @gl.public.write
    def request_mint(self):
        owner = gl.message.sender_address
        profile = self.profile_of_owner.get(owner, ZERO_ADDRESS)
        if profile == ZERO_ADDRESS:
            raise gl.vm.UserError("[EXPECTED] Link a profile before minting.")
        level = int(self.level_of_profile.get(profile, u16(0)))
        gate = self._gate_for(int(self.mint_count.get(profile, u16(0))))
        if level < gate:
            raise gl.vm.UserError(f"[EXPECTED] Account level {level} is below the mint gate {gate}.")

        token_id = self.next_token_id
        self.next_token_id = self.next_token_id + u256(1)
        self.mint_count[profile] = u16(int(self.mint_count.get(profile, u16(0))) + 1)
        self.driver_of_profile[profile] = StoneDriver(token_id=token_id, last_emitted_level=u16(level))
        self.profile_of_token[str(int(token_id))] = profile
        self._enqueue("mint", token_id, profile, owner, u16(level))

    @gl.public.write
    def on_owner_changed(self, token_id: u256, new_owner: Address):
        self._require_operator()
        new_owner = self._normalize_address(new_owner)
        tid = str(int(token_id))
        old_profile = self.profile_of_token.get(tid, ZERO_ADDRESS)
        if old_profile != ZERO_ADDRESS:
            old_driver = self.driver_of_profile.get(old_profile, self._empty_driver())
            if int(old_driver.token_id) == int(token_id):
                self.driver_of_profile[old_profile] = self._empty_driver()

        new_profile = self.profile_of_owner.get(new_owner, ZERO_ADDRESS)
        self.profile_of_token[tid] = new_profile
        if new_profile != ZERO_ADDRESS:
            seed = u16(int(self.level_of_profile.get(new_profile, u16(0))))
            self.driver_of_profile[new_profile] = StoneDriver(token_id=u256(int(token_id)), last_emitted_level=seed)

    @gl.public.write
    def receive_effective_level(self, profile: Address, level: u16):
        self._require_operator()
        profile = self._normalize_address(profile)
        self.effective_level_of_profile[profile] = u16(int(level))

    @gl.public.write
    def mark_relayed(self, upto_index: u256):
        self._require_operator()
        self.relayed_cursor = u256(int(upto_index))
