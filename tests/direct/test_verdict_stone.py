ZERO_ADDRESS = "0x0000000000000000000000000000000000000000"


def test_deploys_with_operator_and_empty_state(direct_vm, direct_deploy, direct_alice):
    direct_vm.sender = direct_alice
    contract = direct_deploy("contracts/verdict_stone.py", direct_alice)
    assert contract.get_outbox_len() == 0
    assert contract.get_effective_level(direct_alice) == 0
    assert contract.get_mint_gate(direct_alice) == 2  # GATE_BASE, zero mints


def test_mint_gate_escalates_steeper_each_mint(direct_vm, direct_deploy, direct_alice):
    direct_vm.sender = direct_alice
    contract = direct_deploy("contracts/verdict_stone.py", direct_alice)
    contract.sync_level(direct_alice, 100, direct_alice)  # bind + level high enough for many gates
    assert contract.get_mint_gate(direct_alice) == 2
    contract.request_mint()
    assert contract.get_mint_gate(direct_alice) == 4
    contract.request_mint()
    assert contract.get_mint_gate(direct_alice) == 7
    contract.request_mint()
    assert contract.get_mint_gate(direct_alice) == 11


def test_sync_level_mirrors_level_and_binding(direct_vm, direct_deploy, direct_alice, direct_bob):
    direct_vm.sender = direct_alice
    contract = direct_deploy("contracts/verdict_stone.py", direct_alice)
    contract.sync_level(direct_bob, 5, direct_bob)
    assert contract.get_mint_gate(direct_bob) == 2
    assert contract.get_outbox_len() == 0


def test_sync_level_requires_operator(direct_vm, direct_deploy, direct_alice, direct_bob):
    direct_vm.sender = direct_alice
    contract = direct_deploy("contracts/verdict_stone.py", direct_alice)
    direct_vm.sender = direct_bob
    with direct_vm.expect_revert("operator"):
        contract.sync_level(direct_bob, 5, direct_bob)


def test_request_mint_below_gate_reverts(direct_vm, direct_deploy, direct_alice, direct_bob):
    direct_vm.sender = direct_alice
    contract = direct_deploy("contracts/verdict_stone.py", direct_alice)
    contract.sync_level(direct_bob, 1, direct_bob)
    direct_vm.sender = direct_bob
    with direct_vm.expect_revert("below the mint gate"):
        contract.request_mint()


def test_request_mint_requires_linked_profile(direct_vm, direct_deploy, direct_alice, direct_bob):
    direct_vm.sender = direct_alice
    contract = direct_deploy("contracts/verdict_stone.py", direct_alice)
    direct_vm.sender = direct_bob
    with direct_vm.expect_revert("Link a profile"):
        contract.request_mint()


def test_request_mint_queues_mint_and_sets_driver(direct_vm, direct_deploy, direct_alice, direct_bob):
    direct_vm.sender = direct_alice
    contract = direct_deploy("contracts/verdict_stone.py", direct_alice)
    contract.sync_level(direct_bob, 3, direct_bob)
    direct_vm.sender = direct_bob
    contract.request_mint()
    assert contract.get_outbox_len() == 1
    msg = contract.get_outbox_message(0)
    assert msg["kind"] == "mint"
    assert int(msg["token_id"]) == 1
    assert int(msg["level"]) == 3


def test_owner_change_rebinds_driver_to_bound_buyer(direct_vm, direct_deploy, direct_alice, direct_bob, direct_charlie):
    direct_vm.sender = direct_alice
    contract = direct_deploy("contracts/verdict_stone.py", direct_alice)
    contract.sync_level(direct_bob, 3, direct_bob)
    direct_vm.sender = direct_bob
    contract.request_mint()           # token 1, driven by bob
    direct_vm.sender = direct_alice
    contract.sync_level(direct_charlie, 1, direct_charlie)  # charlie bound, low level
    contract.on_owner_changed(1, direct_charlie)
    base_len = contract.get_outbox_len()
    contract.sync_level(direct_charlie, 9, direct_charlie)
    assert contract.get_outbox_len() == base_len + 1
    last = contract.get_outbox_message(contract.get_outbox_len() - 1)
    assert last["kind"] == "raise"
    assert int(last["token_id"]) == 1


def test_owner_change_to_unbound_wallet_leaves_stone_driverless(direct_vm, direct_deploy, direct_alice, direct_bob, direct_charlie):
    direct_vm.sender = direct_alice
    contract = direct_deploy("contracts/verdict_stone.py", direct_alice)
    contract.sync_level(direct_bob, 3, direct_bob)
    direct_vm.sender = direct_bob
    contract.request_mint()           # token 1, driven by bob
    direct_vm.sender = direct_alice
    contract.on_owner_changed(1, direct_charlie)  # charlie has no linked profile
    base_len = contract.get_outbox_len()
    contract.sync_level(direct_bob, 50, direct_bob)
    assert contract.get_outbox_len() == base_len


def test_receive_effective_level_and_read(direct_vm, direct_deploy, direct_alice, direct_bob):
    direct_vm.sender = direct_alice
    contract = direct_deploy("contracts/verdict_stone.py", direct_alice)
    contract.receive_effective_level(direct_bob, 7)
    assert contract.get_effective_level(direct_bob) == 7
    direct_vm.sender = direct_bob
    with direct_vm.expect_revert("operator"):
        contract.receive_effective_level(direct_bob, 99)


def test_relay_cursor_advances(direct_vm, direct_deploy, direct_alice, direct_bob):
    direct_vm.sender = direct_alice
    contract = direct_deploy("contracts/verdict_stone.py", direct_alice)
    contract.sync_level(direct_bob, 3, direct_bob)
    direct_vm.sender = direct_bob
    contract.request_mint()
    direct_vm.sender = direct_alice
    assert contract.get_relayed_cursor() == 0
    contract.mark_relayed(1)
    assert contract.get_relayed_cursor() == 1
