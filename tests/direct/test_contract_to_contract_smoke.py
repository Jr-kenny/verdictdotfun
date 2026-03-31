import pytest


@pytest.mark.xfail(
    reason="gltest Direct Mode uses a single in-memory root and does not cleanly support multiple deployed contracts in one test.",
    strict=False,
)
def test_native_game_to_core_result_reporting(direct_vm, direct_deploy, direct_alice, direct_bob):
    direct_vm.sender = direct_alice
    core = direct_deploy("contracts/score_core_smoke.py")

    core.register_profile("Alice")

    direct_vm.sender = direct_bob
    core.register_profile("Bob")

    from genlayer.gl import genvm_contracts

    genvm_contracts.__known_contract__ = None

    direct_vm.sender = direct_alice
    game = direct_deploy("contracts/score_game_smoke.py", core.get_self_address())
    core.set_game_contract(game.get_self_address(), True)

    game.report_match("room-77", direct_alice, direct_bob, "argue")

    alice = core.get_profile(direct_alice)
    bob = core.get_profile(direct_bob)

    assert alice["wins"] == 1
    assert alice["xp"] == 100
    assert bob["losses"] == 1
    assert bob["xp"] == 50


def test_core_rejects_direct_result_reports_from_wallets(direct_vm, direct_deploy, direct_alice):
    direct_vm.sender = direct_alice
    core = direct_deploy("contracts/score_core_smoke.py")

    core.register_profile("Alice")

    with direct_vm.expect_revert("Only approved game contracts can report match results."):
        core.apply_match_result(direct_alice, "room-91", True, "argue")
