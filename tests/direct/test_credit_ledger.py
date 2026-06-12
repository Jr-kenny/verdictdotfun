ZERO_ADDRESS = "0x0000000000000000000000000000000000000000"
CREDIT = 10**18

PROFILE_A = "0xa11ce00000000000000000000000000000000001"
PROFILE_B = "0xb0b0000000000000000000000000000000000002"
WALLET_A = "0xfee1dead00000000000000000000000000000099"


# `direct_charlie` stands in for an approved mode contract (a real Address, so it can
# be used as direct_vm.sender — raw hex strings cannot be ordered against Address keys).
def _deploy(direct_deploy, direct_vm, owner, bridge):
    direct_vm.sender = owner
    return direct_deploy("contracts/credit_ledger.py", ZERO_ADDRESS, bridge)


def _funded_ledger(direct_vm, direct_deploy, owner, bridge, mode):
    ledger = _deploy(direct_deploy, direct_vm, owner, bridge)
    direct_vm.sender = owner
    ledger.approve_caller(mode, True)
    direct_vm.sender = bridge
    ledger.credit(PROFILE_A, 10 * CREDIT, "0xdep:a")
    ledger.credit(PROFILE_B, 10 * CREDIT, "0xdep:b")
    return ledger


def _escrowed(direct_vm, direct_deploy, owner, bridge, mode, room="ROOM01", stake=3):
    ledger = _funded_ledger(direct_vm, direct_deploy, owner, bridge, mode)
    direct_vm.sender = mode
    ledger.open_escrow(room, "argue", PROFILE_A, PROFILE_B, stake * CREDIT)
    return ledger


# ---- credit ----
def test_credit_is_idempotent_on_deposit_ref(direct_vm, direct_deploy, direct_alice, direct_bob):
    ledger = _deploy(direct_deploy, direct_vm, direct_alice, direct_bob)
    direct_vm.sender = direct_bob  # bridge
    ledger.credit(PROFILE_A, 5 * CREDIT, "0xtx1:1")
    ledger.credit(PROFILE_A, 5 * CREDIT, "0xtx1:1")  # replay — no-op
    assert ledger.get_balance(PROFILE_A) == 5 * CREDIT


def test_only_bridge_can_credit(direct_vm, direct_deploy, direct_alice, direct_bob):
    ledger = _deploy(direct_deploy, direct_vm, direct_alice, direct_bob)
    direct_vm.sender = direct_alice  # not the bridge
    with direct_vm.expect_revert("Only the bridge"):
        ledger.credit(PROFILE_A, CREDIT, "0xtx9:1")


# ---- escrow ----
def test_open_escrow_locks_both_stakes(direct_vm, direct_deploy, direct_alice, direct_bob, direct_charlie):
    ledger = _funded_ledger(direct_vm, direct_deploy, direct_alice, direct_bob, direct_charlie)
    direct_vm.sender = direct_charlie
    ledger.open_escrow("ROOM01", "argue", PROFILE_A, PROFILE_B, 3 * CREDIT)
    assert ledger.get_balance(PROFILE_A) == 7 * CREDIT
    assert ledger.get_balance(PROFILE_B) == 7 * CREDIT
    esc = ledger.get_escrow("ROOM01")
    assert esc.pot == 6 * CREDIT
    assert esc.state == "open"


def test_open_escrow_rejects_insufficient_balance(direct_vm, direct_deploy, direct_alice, direct_bob, direct_charlie):
    ledger = _funded_ledger(direct_vm, direct_deploy, direct_alice, direct_bob, direct_charlie)
    direct_vm.sender = direct_charlie
    with direct_vm.expect_revert("insufficient credits"):
        ledger.open_escrow("ROOM02", "argue", PROFILE_A, PROFILE_B, 99 * CREDIT)


def test_open_escrow_rejects_unapproved_caller(direct_vm, direct_deploy, direct_alice, direct_bob, direct_charlie):
    ledger = _funded_ledger(direct_vm, direct_deploy, direct_alice, direct_bob, direct_charlie)
    direct_vm.sender = direct_alice  # not approved
    with direct_vm.expect_revert("not an approved mode"):
        ledger.open_escrow("ROOM03", "argue", PROFILE_A, PROFILE_B, CREDIT)


# ---- settlement ----
def test_finalize_winner_pays_full_pot_and_conserves(direct_vm, direct_deploy, direct_alice, direct_bob, direct_charlie):
    ledger = _escrowed(direct_vm, direct_deploy, direct_alice, direct_bob, direct_charlie)
    direct_vm.sender = direct_charlie
    ledger.set_provisional("ROOM01", PROFILE_A)
    ledger.finalize_winner("ROOM01", PROFILE_A)
    assert ledger.get_balance(PROFILE_A) == 13 * CREDIT  # 7 left + 6 pot
    assert ledger.get_balance(PROFILE_B) == 7 * CREDIT
    assert ledger.get_escrow("ROOM01").state == "final"


def test_finalize_is_idempotent(direct_vm, direct_deploy, direct_alice, direct_bob, direct_charlie):
    ledger = _escrowed(direct_vm, direct_deploy, direct_alice, direct_bob, direct_charlie)
    direct_vm.sender = direct_charlie
    ledger.set_provisional("ROOM01", PROFILE_A)
    ledger.finalize_winner("ROOM01", PROFILE_A)
    with direct_vm.expect_revert("already finalized"):
        ledger.finalize_winner("ROOM01", PROFILE_A)


def test_finalize_void_refunds_both(direct_vm, direct_deploy, direct_alice, direct_bob, direct_charlie):
    ledger = _escrowed(direct_vm, direct_deploy, direct_alice, direct_bob, direct_charlie)
    direct_vm.sender = direct_charlie
    ledger.set_provisional("ROOM01", PROFILE_A)
    ledger.finalize_void("ROOM01")
    assert ledger.get_balance(PROFILE_A) == 10 * CREDIT
    assert ledger.get_balance(PROFILE_B) == 10 * CREDIT
    assert ledger.get_escrow("ROOM01").state == "void"


def test_finalize_tie_refunds_both(direct_vm, direct_deploy, direct_alice, direct_bob, direct_charlie):
    ledger = _escrowed(direct_vm, direct_deploy, direct_alice, direct_bob, direct_charlie)
    direct_vm.sender = direct_charlie
    ledger.finalize_tie("ROOM01")
    assert ledger.get_balance(PROFILE_A) == 10 * CREDIT
    assert ledger.get_balance(PROFILE_B) == 10 * CREDIT
    assert ledger.get_escrow("ROOM01").state == "final"


# ---- redeem ----
def test_request_redeem_debits_and_records(direct_vm, direct_deploy, direct_alice, direct_bob, direct_charlie):
    ledger = _funded_ledger(direct_vm, direct_deploy, direct_alice, direct_bob, direct_charlie)
    direct_vm.sender = direct_bob  # bridge
    ledger.request_redeem(PROFILE_A, 4 * CREDIT, WALLET_A, "USDC")
    assert ledger.get_balance(PROFILE_A) == 6 * CREDIT
    r = ledger.get_redeem(0)
    assert str(r.profile).lower() == PROFILE_A
    assert r.atto_amount == 4 * CREDIT
    assert r.settled == False


def test_request_redeem_rejects_overdraw(direct_vm, direct_deploy, direct_alice, direct_bob, direct_charlie):
    ledger = _funded_ledger(direct_vm, direct_deploy, direct_alice, direct_bob, direct_charlie)
    direct_vm.sender = direct_bob
    with direct_vm.expect_revert("Insufficient redeemable balance"):
        ledger.request_redeem(PROFILE_A, 999 * CREDIT, WALLET_A, "USDC")


def test_mark_redeem_settled(direct_vm, direct_deploy, direct_alice, direct_bob, direct_charlie):
    ledger = _funded_ledger(direct_vm, direct_deploy, direct_alice, direct_bob, direct_charlie)
    direct_vm.sender = direct_bob
    ledger.request_redeem(PROFILE_A, CREDIT, WALLET_A, "USDC")
    ledger.mark_redeem_settled(0)
    assert ledger.get_redeem(0).settled == True
