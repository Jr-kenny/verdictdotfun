"""Direct-mode tests for VerdictStone (Phase 1c bridge wiring).

The contract talks to the EVM hub (VerdictStoneHub) over the GenLayer bridge boilerplate,
mirroring the proven Tokenpost ClaimVerifier pattern on our identical runner:

  OUTBOUND (GL -> hub), abi.encode-compatible:
    (uint8 kind, uint256 tokenId, bytes32 profile, address owner, uint256 level)
    kind 0 = mint  -> hub.applyMint(tokenId, profile, owner, level)
    kind 1 = raise -> hub.raiseLevel(tokenId, level)
  INBOUND (hub -> GL):
    (uint8 kind, uint256 tokenId, address newOwner, bytes32 profile, uint256 level)
    kind 0 = owner_changed -> rebind driver
    kind 1 = effective_level -> store perks level

Outbound emit goes through a deployed GL BridgeSender via cross-contract emit(); that is the
only integration/xfail path. With bridge_sender == ZERO the emit is a no-op, so every state
transition and the abi payload itself are fully exercised here (the payload byte-matches
Solidity via eth_abi, the same equivalence Tokenpost relies on). Inbound handlers never reply,
so process_bridge_message's full success path IS testable in direct mode.
"""

from eth_abi import encode as abi_encode

ZERO = "0x" + "00" * 20
BR = "0x" + "bb" * 20    # GL BridgeReceiver (inbound gate)
BS = "0x" + "cc" * 20    # GL BridgeSender (outbound emits) — left unset (ZERO) in direct tests
HUB = "0x" + "d0" * 20   # EVM hub contract (outbound target + inbound source gate), lowercase hex
HUB_EID = 40305          # LayerZero EID of the ZKsync Era Sepolia hub

OUT_MINT, OUT_RAISE = 0, 1
IN_OWNER_CHANGED, IN_EFFECTIVE_LEVEL = 0, 1

BR_SENDER = bytes.fromhex(BR[2:])  # the BridgeReceiver, as a 20-byte sender


def _addr(a) -> str:
    """Lowercase 0x-hex for an address, whether a raw-bytes fixture or an Address/str."""
    if isinstance(a, (bytes, bytearray)):
        return "0x" + bytes(a).hex()
    return str(a).lower()


def _b32(addr: str) -> bytes:
    """Address -> bytes32 the way Solidity abi.encode left-pads an address."""
    return bytes(12) + bytes.fromhex(addr[2:])


def _out(kind, token_id, profile, owner, level) -> bytes:
    """Outbound payload exactly as the EVM hub's bridge decoder would abi.encode/decode it."""
    return abi_encode(
        ["uint8", "uint256", "bytes32", "address", "uint256"],
        [kind, token_id, _b32(profile), owner, level],
    )


def _in_owner_changed(token_id, new_owner) -> bytes:
    return abi_encode(
        ["uint8", "uint256", "address", "bytes32", "uint256"],
        [IN_OWNER_CHANGED, token_id, new_owner, bytes(32), 0],
    )


def _in_effective_level(profile, level) -> bytes:
    return abi_encode(
        ["uint8", "uint256", "address", "bytes32", "uint256"],
        [IN_EFFECTIVE_LEVEL, 0, ZERO, _b32(profile), level],
    )


def _deploy(direct_deploy, operator):
    # __init__(operator, bridge_sender, bridge_receiver, hub_contract, hub_eid)
    return direct_deploy("contracts/verdict_stone.py", operator, ZERO, BR, HUB, HUB_EID)


# ---- deploy + gates ----

def test_deploys_with_empty_state(direct_vm, direct_deploy, direct_alice):
    direct_vm.sender = direct_alice
    c = _deploy(direct_deploy, direct_alice)
    assert c.get_effective_level(direct_alice) == 0
    assert c.get_mint_gate(direct_alice) == 2  # GATE_BASE, zero mints


def test_mint_gate_escalates_steeper_each_mint(direct_vm, direct_deploy, direct_alice):
    direct_vm.sender = direct_alice
    c = _deploy(direct_deploy, direct_alice)
    c.sync_level(direct_alice, 100, direct_alice)  # bind + level high enough for many gates
    assert c.get_mint_gate(direct_alice) == 2
    c.request_mint()
    assert c.get_mint_gate(direct_alice) == 4
    c.request_mint()
    assert c.get_mint_gate(direct_alice) == 7
    c.request_mint()
    assert c.get_mint_gate(direct_alice) == 11


def test_sync_level_mirrors_level_and_binding(direct_vm, direct_deploy, direct_alice, direct_bob):
    direct_vm.sender = direct_alice
    c = _deploy(direct_deploy, direct_alice)
    payload = c.sync_level(direct_bob, 5, direct_bob)
    assert c.get_mint_gate(direct_bob) == 2
    assert payload == b""  # no stone yet -> nothing to raise -> nothing emitted


def test_sync_level_requires_operator(direct_vm, direct_deploy, direct_alice, direct_bob):
    direct_vm.sender = direct_alice
    c = _deploy(direct_deploy, direct_alice)
    direct_vm.sender = direct_bob
    with direct_vm.expect_revert("operator"):
        c.sync_level(direct_bob, 5, direct_bob)


# ---- mint (outbound) ----

def test_request_mint_below_gate_reverts(direct_vm, direct_deploy, direct_alice, direct_bob):
    direct_vm.sender = direct_alice
    c = _deploy(direct_deploy, direct_alice)
    c.sync_level(direct_bob, 1, direct_bob)
    direct_vm.sender = direct_bob
    with direct_vm.expect_revert("below the mint gate"):
        c.request_mint()


def test_request_mint_requires_linked_profile(direct_vm, direct_deploy, direct_alice, direct_bob):
    direct_vm.sender = direct_alice
    c = _deploy(direct_deploy, direct_alice)
    direct_vm.sender = direct_bob
    with direct_vm.expect_revert("Link a profile"):
        c.request_mint()


def test_request_mint_emits_mint_payload_and_sets_driver(direct_vm, direct_deploy, direct_alice, direct_bob):
    direct_vm.sender = direct_alice
    c = _deploy(direct_deploy, direct_alice)
    c.sync_level(direct_bob, 3, direct_bob)
    direct_vm.sender = direct_bob
    payload = c.request_mint()
    # payload byte-matches Solidity abi.encode of the mint message
    assert bytes(payload) == _out(OUT_MINT, 1, _addr(direct_bob), _addr(direct_bob), 3)
    d = c.decode_outbound(payload)
    assert d["kind"] == OUT_MINT
    assert d["token_id"] == 1
    assert d["level"] == 3
    assert d["owner"].lower() == _addr(direct_bob)
    assert d["profile"].lower() == _addr(direct_bob)


def test_sync_level_rise_emits_raise_payload(direct_vm, direct_deploy, direct_alice, direct_bob):
    direct_vm.sender = direct_alice
    c = _deploy(direct_deploy, direct_alice)
    c.sync_level(direct_bob, 3, direct_bob)
    direct_vm.sender = direct_bob
    c.request_mint()  # token 1, driven by bob at level 3
    direct_vm.sender = direct_alice
    payload = c.sync_level(direct_bob, 9, direct_bob)  # level rises above high-water
    assert bytes(payload) == _out(OUT_RAISE, 1, ZERO, ZERO, 9)
    d = c.decode_outbound(payload)
    assert d["kind"] == OUT_RAISE
    assert d["token_id"] == 1
    assert d["level"] == 9


def test_sync_level_no_rise_emits_nothing(direct_vm, direct_deploy, direct_alice, direct_bob):
    direct_vm.sender = direct_alice
    c = _deploy(direct_deploy, direct_alice)
    c.sync_level(direct_bob, 3, direct_bob)
    direct_vm.sender = direct_bob
    c.request_mint()
    direct_vm.sender = direct_alice
    assert c.sync_level(direct_bob, 2, direct_bob) == b""  # below high-water -> no raise


# ---- inbound bridge messages ----

def test_process_bridge_message_only_bridge_receiver(direct_vm, direct_deploy, direct_alice, direct_bob):
    direct_vm.sender = direct_alice
    c = _deploy(direct_deploy, direct_alice)
    direct_vm.sender = direct_bob  # not the BridgeReceiver
    with direct_vm.expect_revert("BridgeReceiver"):
        c.process_bridge_message("0x1", HUB_EID, HUB, _in_effective_level(_addr(direct_bob), 7))


def test_process_bridge_message_ignores_foreign_source(direct_vm, direct_deploy, direct_alice, direct_bob):
    direct_vm.sender = direct_alice
    c = _deploy(direct_deploy, direct_alice)
    direct_vm.sender = BR_SENDER
    foreign = "0x" + "ee" * 20
    c.process_bridge_message("0x1", HUB_EID, foreign, _in_effective_level(_addr(direct_bob), 7))
    assert c.get_effective_level(direct_bob) == 0  # silently ignored, no state change


def test_inbound_effective_level_stored(direct_vm, direct_deploy, direct_alice, direct_bob):
    direct_vm.sender = direct_alice
    c = _deploy(direct_deploy, direct_alice)
    direct_vm.sender = BR_SENDER
    c.process_bridge_message("0x1", HUB_EID, HUB, _in_effective_level(_addr(direct_bob), 7))
    assert c.get_effective_level(direct_bob) == 7


def test_inbound_owner_change_rebinds_driver_to_bound_buyer(
    direct_vm, direct_deploy, direct_alice, direct_bob, direct_charlie
):
    direct_vm.sender = direct_alice
    c = _deploy(direct_deploy, direct_alice)
    c.sync_level(direct_bob, 3, direct_bob)
    direct_vm.sender = direct_bob
    c.request_mint()  # token 1, driven by bob
    direct_vm.sender = direct_alice
    c.sync_level(direct_charlie, 1, direct_charlie)  # charlie bound, low level
    direct_vm.sender = BR_SENDER
    c.process_bridge_message("0x2", HUB_EID, HUB, _in_owner_changed(1, _addr(direct_charlie)))
    direct_vm.sender = direct_alice
    payload = c.sync_level(direct_charlie, 9, direct_charlie)  # charlie now drives token 1
    d = c.decode_outbound(payload)
    assert d["kind"] == OUT_RAISE
    assert d["token_id"] == 1
    assert d["level"] == 9


def test_inbound_owner_change_to_unbound_wallet_leaves_stone_driverless(
    direct_vm, direct_deploy, direct_alice, direct_bob, direct_charlie
):
    direct_vm.sender = direct_alice
    c = _deploy(direct_deploy, direct_alice)
    c.sync_level(direct_bob, 3, direct_bob)
    direct_vm.sender = direct_bob
    c.request_mint()  # token 1, driven by bob
    direct_vm.sender = BR_SENDER
    c.process_bridge_message("0x2", HUB_EID, HUB, _in_owner_changed(1, _addr(direct_charlie)))  # charlie unbound
    direct_vm.sender = direct_alice
    assert c.sync_level(direct_bob, 50, direct_bob) == b""  # bob no longer drives -> no raise
