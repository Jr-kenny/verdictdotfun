ZERO_ADDRESS = "0x0000000000000000000000000000000000000000"


def test_deploys_with_operator_and_empty_state(direct_vm, direct_deploy, direct_alice):
    direct_vm.sender = direct_alice
    contract = direct_deploy("contracts/verdict_stone.py", direct_alice)
    assert contract.get_outbox_len() == 0
    assert contract.get_effective_level(direct_alice) == 0
    assert contract.get_mint_gate(direct_alice) == 2  # GATE_BASE, zero mints
