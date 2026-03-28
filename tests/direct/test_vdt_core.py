ZERO_ADDRESS = "0x0000000000000000000000000000000000000000"


def test_vdt_core_creates_and_transfers_profiles(direct_vm, direct_deploy, direct_alice, direct_bob):
    core = direct_deploy("contracts/vdt_core.py", 1)

    direct_vm.sender = direct_alice
    profile = core.create_profile("Alice")

    assert profile != ZERO_ADDRESS
    assert core.get_profile_of_owner(direct_alice) == profile

    direct_vm.sender = direct_alice
    core.transfer_profile(direct_bob)

    assert str(core.get_profile_of_owner(direct_alice)) == ZERO_ADDRESS
    assert core.get_profile_of_owner(direct_bob) == profile


def test_vdt_core_deploys_single_room_child_contract(direct_vm, direct_deploy, direct_alice):
    core = direct_deploy("contracts/vdt_core.py", 1)

    direct_vm.sender = direct_alice
    profile = core.create_profile("Alice")

    direct_vm.sender = direct_alice
    room_contract = core.create_room("debate", "ROOM42", "technology", profile)

    assert room_contract != ZERO_ADDRESS
    assert core.get_room_contract("ROOM42") == room_contract
    assert core.get_room_mode("ROOM42") == "debate"
    assert core.is_game_contract(room_contract) is True
    assert list(core.get_leaderboard(10)) == [profile]
