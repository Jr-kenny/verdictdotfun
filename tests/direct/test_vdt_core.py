from pathlib import Path


ZERO_ADDRESS = "0x0000000000000000000000000000000000000000"


def test_verdictdotfun_creates_one_permanent_profile_per_wallet(direct_vm, direct_deploy, direct_alice):
    direct_vm.sender = direct_alice
    core = direct_deploy("contracts/verdictdotfun.py", 1)

    profile = core.create_profile("Alice")

    assert profile != ZERO_ADDRESS
    assert core.get_profile_of_owner(direct_alice) == profile

    profile_data = core.get_profile(direct_alice)
    assert profile_data["handle"] == "Alice"
    assert str(profile_data["owner"]).lower() == str(core.get_profile_owner(profile)).lower()

    with direct_vm.expect_revert("This wallet already owns a profile."):
        core.create_profile("AliceTwo")


def test_verdictdotfun_tracks_fixed_mode_contracts_for_rooms(direct_vm, direct_deploy, direct_alice, direct_bob):
    direct_vm.sender = direct_alice
    core = direct_deploy("contracts/verdictdotfun.py", 1)

    profile = core.create_profile("Alice")
    core.set_mode_contract("argue", direct_bob)

    room_contract = core.create_room("convince", "ROOM42", "technology", profile, "convince")

    assert room_contract == core.get_mode_contract("argue")
    assert core.get_room_contract("ROOM42") == core.get_mode_contract("argue")
    assert core.get_room_mode("ROOM42") == "argue"
    assert core.is_game_contract(direct_bob) is True
    assert list(core.get_leaderboard(10)) == [profile]


def test_verdictdotfun_bootstraps_child_mode_contracts_in_constructor(direct_vm, direct_deploy, direct_alice):
    direct_vm.sender = direct_alice
    argue_code = (Path(__file__).resolve().parents[2] / "contracts" / "argue_game.py").read_text("utf-8")

    core = direct_deploy("contracts/verdictdotfun.py", 1, "", argue_code)
    argue_contract = core.get_mode_contract("argue")

    assert str(argue_contract) != ZERO_ADDRESS
    assert core.is_game_contract(argue_contract) is True


def test_verdictdotfun_creates_riddle_rooms_without_argue_style_forwarding(direct_vm, direct_deploy, direct_alice):
    direct_vm.sender = direct_alice
    riddle_code = (Path(__file__).resolve().parents[2] / "contracts" / "riddle_game.py").read_text("utf-8")

    core = direct_deploy("contracts/verdictdotfun.py", 1, "", "", "", riddle_code)
    profile = core.create_profile("Alice")

    room_contract = core.create_room("riddle", "ROOM77", "technology", profile)

    assert room_contract == core.get_mode_contract("riddle")
    assert room_contract != ZERO_ADDRESS
    assert core.get_room_contract("ROOM77") == room_contract
    assert core.get_room_mode("ROOM77") == "riddle"


def test_verdictdotfun_applies_match_results_for_approved_game_contracts(direct_vm, direct_deploy, direct_alice, direct_bob):
    direct_vm.sender = direct_alice
    core = direct_deploy("contracts/verdictdotfun.py", 1)

    profile = core.create_profile("Alice")
    core.set_mode_contract("argue", direct_bob)

    direct_vm.sender = direct_bob
    core.apply_match_result(profile, "argue:room1", True, "argue")

    profile_data = core.get_profile_by_address(profile)
    assert profile_data["wins"] == 1
    assert profile_data["xp"] == 100

    core.apply_match_result(profile, "argue:room1", True, "argue")
    profile_data = core.get_profile_by_address(profile)
    assert profile_data["wins"] == 1
    assert profile_data["xp"] == 100
