# { "Depends": "py-genlayer:1jb45aa8ynh2a9c9xn3b7qqh8sm5q93hwfp7jqmwsfhh8jpz09h6" }

"""VerdictStone: GenLayer side of the living-stone loop with the EVM hub (VerdictStoneHub).

GenLayer owns eligibility, profile binding and the mint gate; the hub (ZKsync Era) is the
authoritative registry. The two talk over the GenLayer bridge boilerplate, the same way the
live Tokenpost ClaimVerifier does on this exact runner.

Cross-chain ABI contract with VerdictStoneHub (gl.evm.encode/decode byte-matches Solidity
abi.encode):

  OUTBOUND (GL -> hub), via the GL BridgeSender:
    (uint8 kind, uint256 tokenId, bytes32 profile, address owner, uint256 level)
    kind 0 (mint)  -> hub.applyMint(tokenId, profile, owner, level)
    kind 1 (raise) -> hub.raiseLevel(tokenId, level)        (profile/owner unused)

  INBOUND (hub -> GL), via the GL BridgeReceiver:
    (uint8 kind, uint256 tokenId, address newOwner, bytes32 profile, uint256 level)
    kind 0 (owner_changed)   -> rebind the stone's driving profile to newOwner's profile
    kind 1 (effective_level) -> store the hub-computed perks level for profile

The outbound send is a cross-contract emit() into a deployed BridgeSender — the relay polls
that, not this contract. When bridge_sender is the zero address the emit is skipped (so direct
unit tests run the full encode + state path; the live emit is exercised in integration). The
emit settles in a follow-up transaction (GenLayer emit() is asynchronous).

sync_level is NOT a bridge message: account level is pushed in from the GenLayer core engine
(the operator), so it stays operator-gated.
"""

from dataclasses import dataclass
import typing

try:
    from genlayer import *
except ModuleNotFoundError:
    from genlayer_py import *


ZERO_ADDRESS = Address("0x0000000000000000000000000000000000000000")
GATE_BASE = 2  # account level required for a profile's FIRST stone

OUT_MINT = 0
OUT_RAISE = 1
IN_OWNER_CHANGED = 0
IN_EFFECTIVE_LEVEL = 1

# Wire formats — the InplaceTuple marker makes these a flat abi.encode of the listed types,
# byte-matching Solidity. level travels as uint256 to match the hub's storage type.
_OUT_T = tuple[gl.evm.InplaceTuple, u8, u256, gl.evm.bytes32, Address, u256]
_IN_T = tuple[gl.evm.InplaceTuple, u8, u256, Address, gl.evm.bytes32, u256]


@allow_storage
@dataclass
class StoneDriver:
    token_id: u256          # the stone this profile currently drives (0 = none)
    last_emitted_level: u16  # highest level already pushed to the hub for that stone


class VerdictStone(gl.Contract):
    owner: Address
    operator: Address                                  # GenLayer core engine — pushes account level
    bridge_sender: Address                             # GL BridgeSender (outbound); ZERO disables emit
    bridge_receiver: Address                           # GL BridgeReceiver (inbound gate)
    hub_contract: str                                  # EVM hub (lowercase hex) — out target + in source gate
    hub_eid: u256                                      # LayerZero EID of the hub chain
    level_of_profile: TreeMap[Address, u16]            # mirrored account level (pushed in)
    profile_of_owner: TreeMap[Address, Address]        # wallet -> profile binding mirror
    effective_level_of_profile: TreeMap[Address, u16]  # perks level (pushed from hub)
    mint_count: TreeMap[Address, u16]                  # stones minted per profile
    driver_of_profile: TreeMap[Address, StoneDriver]
    profile_of_token: TreeMap[str, Address]            # token_id(str) -> current driver profile
    next_token_id: u256

    def __init__(
        self,
        operator: typing.Any = ZERO_ADDRESS,
        bridge_sender: typing.Any = ZERO_ADDRESS,
        bridge_receiver: typing.Any = ZERO_ADDRESS,
        hub_contract: str = "",
        hub_eid: typing.Any = 0,
    ):
        self.owner = gl.message.sender_address
        op = self._normalize_address(operator)
        self.operator = op if op != ZERO_ADDRESS else gl.message.sender_address
        self.bridge_sender = self._normalize_address(bridge_sender)
        self.bridge_receiver = self._normalize_address(bridge_receiver)
        self.hub_contract = str(hub_contract).lower()
        self.hub_eid = u256(int(hub_eid))
        self.next_token_id = u256(1)

    # ---- helpers ----

    def _normalize_address(self, value: typing.Any) -> Address:
        # Coerce so this works whether args arrive as Address (CLI auto-types 40-hex), bytes, or str.
        if isinstance(value, Address):
            return value
        if isinstance(value, bytes):
            return Address(value)
        if hasattr(value, "as_bytes"):
            return Address(value.as_bytes)
        return Address(str(value))

    def _empty_driver(self) -> StoneDriver:
        return StoneDriver(token_id=u256(0), last_emitted_level=u16(0))

    def _gate_for(self, mint_count: int) -> int:
        # Steeper jump per mint (tunable): 2, 4, 7, 11, 16, ... (step grows by 1 each time).
        n = int(mint_count)
        return GATE_BASE + (n * (n + 3)) // 2

    def _require_operator(self):
        if gl.message.sender_address != self.operator and gl.message.sender_address != self.owner:
            raise gl.vm.UserError("[EXPECTED] Only the operator may call this.")

    def _profile_to_bytes32(self, profile: Address) -> bytes:
        return bytes(12) + bytes(profile.as_bytes)

    def _bytes32_to_address(self, raw: typing.Any) -> Address:
        return Address(bytes(raw)[-20:])

    def _encode_mint(self, token_id: u256, profile: Address, owner: Address, level: int) -> bytes:
        return gl.evm.encode(
            _OUT_T, (OUT_MINT, int(token_id), self._profile_to_bytes32(profile), owner, int(level))
        )

    def _encode_raise(self, token_id: u256, level: int) -> bytes:
        return gl.evm.encode(
            _OUT_T, (OUT_RAISE, int(token_id), bytes(32), ZERO_ADDRESS, int(level))
        )

    def _send(self, payload: bytes):
        # Cross-contract emit into the deployed BridgeSender; the relay polls it. No-op until a
        # bridge_sender is configured so direct unit tests run without a live bridge. emit() is
        # asynchronous — the outbound message lands in a follow-up transaction.
        if self.bridge_sender != ZERO_ADDRESS:
            gl.get_contract_at(self.bridge_sender).emit().send_message(
                self.hub_eid, self.hub_contract, payload
            )

    # ---- views ----

    @gl.public.view
    def get_mint_gate(self, profile: Address) -> int:
        key = self._normalize_address(profile)
        return self._gate_for(int(self.mint_count.get(key, u16(0))))

    @gl.public.view
    def get_effective_level(self, profile: Address) -> int:
        key = self._normalize_address(profile)
        return int(self.effective_level_of_profile.get(key, u16(0)))

    @gl.public.view
    def get_config(self) -> dict:
        return {
            "owner": str(self.owner),
            "operator": str(self.operator),
            "bridge_sender": str(self.bridge_sender),
            "bridge_receiver": str(self.bridge_receiver),
            "hub_contract": self.hub_contract,
            "hub_eid": int(self.hub_eid),
        }

    @gl.public.view
    def decode_outbound(self, message: bytes) -> dict:
        kind, token_id, profile, owner, level = gl.evm.decode(_OUT_T, message)
        return {
            "kind": int(kind),
            "token_id": int(token_id),
            "profile": str(self._bytes32_to_address(profile)),
            "owner": str(owner),
            "level": int(level),
        }

    @gl.public.view
    def decode_inbound(self, message: bytes) -> dict:
        kind, token_id, new_owner, profile, level = gl.evm.decode(_IN_T, message)
        return {
            "kind": int(kind),
            "token_id": int(token_id),
            "new_owner": str(new_owner),
            "profile": str(self._bytes32_to_address(profile)),
            "level": int(level),
        }

    @gl.public.write
    def set_config(self, bridge_sender: str, bridge_receiver: str, hub_contract: str, hub_eid: int):
        """Owner-only: repoint the bridge wiring after deploy. GL redeploys lose state, so the
        endpoints must be reconfigurable in place (mirrors ClaimVerifier.set_config); also lets the
        hub address be set after the hub deploy without a circular dependency."""
        if gl.message.sender_address != self.owner:
            raise gl.vm.UserError("[EXPECTED] Only owner")
        self.bridge_sender = self._normalize_address(bridge_sender)
        self.bridge_receiver = self._normalize_address(bridge_receiver)
        self.hub_contract = str(hub_contract).lower()
        self.hub_eid = u256(int(hub_eid))

    # ---- outbound (GL -> hub) ----

    @gl.public.write
    def sync_level(self, profile: Address, level: u16, owner: Address = ZERO_ADDRESS) -> bytes:
        """Mirror the account level pushed in from the GenLayer core engine. If it lifts the
        driving stone above its high-water mark, emit a raise to the hub. Returns the emitted
        raise payload (b"" when nothing was emitted)."""
        self._require_operator()
        profile = self._normalize_address(profile)
        owner = self._normalize_address(owner)
        self.level_of_profile[profile] = u16(int(level))
        if owner != ZERO_ADDRESS:
            self.profile_of_owner[owner] = profile
        driver = self.driver_of_profile.get(profile, self._empty_driver())
        if int(driver.token_id) != 0 and int(level) > int(driver.last_emitted_level):
            self.driver_of_profile[profile] = StoneDriver(
                token_id=driver.token_id, last_emitted_level=u16(int(level))
            )
            payload = self._encode_raise(driver.token_id, int(level))
            self._send(payload)
            return payload
        return b""

    @gl.public.write
    def request_mint(self) -> bytes:
        """Mint a stone for the caller's bound profile if it clears the personal gate. Returns
        the emitted mint payload."""
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
        payload = self._encode_mint(token_id, profile, owner, level)
        self._send(payload)
        return payload

    # ---- inbound (hub -> GL) ----

    @gl.public.write
    def process_bridge_message(self, message_id: str, source_chain_id: int, source_sender: str, message: bytes):
        """Single entrypoint for hub -> GL facts, gated to the BridgeReceiver and our hub.
        Inbound handlers never reply, so there is no outbound emit on this path."""
        if gl.message.sender_address != self.bridge_receiver:
            raise gl.vm.UserError("[EXPECTED] Only the BridgeReceiver may deliver bridge messages.")
        if source_sender.lower() != self.hub_contract:
            return  # not our hub -> ignore, no state change
        kind, token_id, new_owner, profile, level = gl.evm.decode(_IN_T, message)
        if int(kind) == IN_OWNER_CHANGED:
            self._on_owner_changed(u256(int(token_id)), new_owner)
        elif int(kind) == IN_EFFECTIVE_LEVEL:
            self._receive_effective_level(self._bytes32_to_address(profile), u16(int(level)))
        # unknown kinds: ignore

    def _on_owner_changed(self, token_id: u256, new_owner: Address):
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

    def _receive_effective_level(self, profile: Address, level: u16):
        profile = self._normalize_address(profile)
        self.effective_level_of_profile[profile] = u16(int(level))
