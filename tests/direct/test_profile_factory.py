ZERO_ADDRESS = "0x0000000000000000000000000000000000000000"


def test_profile_factory_creates_and_transfers_profiles(direct_vm, direct_deploy, direct_alice, direct_bob):
    factory = direct_deploy("contracts/profile_factory.py", 1)

    direct_vm.sender = direct_alice
    profile = factory.create_profile("Alice")

    assert profile != ZERO_ADDRESS
    assert factory.get_profile_of_owner(direct_alice) == profile

    direct_vm.sender = direct_alice
    factory.transfer_profile(direct_bob)

    assert str(factory.get_profile_of_owner(direct_alice)) == ZERO_ADDRESS
    assert factory.get_profile_of_owner(direct_bob) == profile


def test_profile_factory_blocks_duplicate_profile_ownership(direct_vm, direct_deploy, direct_alice, direct_bob):
    factory = direct_deploy("contracts/profile_factory.py", 1)

    direct_vm.sender = direct_alice
    factory.create_profile("Alice")

    direct_vm.sender = direct_bob
    factory.create_profile("Bob")

    direct_vm.sender = direct_alice
    with direct_vm.expect_revert("The target wallet already owns a profile."):
        factory.transfer_profile(direct_bob)
