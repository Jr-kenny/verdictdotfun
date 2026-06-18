ZERO_ADDRESS = "0x0000000000000000000000000000000000000000"

# Image-evidence test helpers, mirrored from test_argue_game.py.
PNG_BYTES = b"\x89PNG\r\n\x1a\n" + b"\x00" * 96  # PNG magic + filler
# Drawings are hosted on the keyless catbox.moe file host and fetched by URL.
GATEWAY = r"files\.catbox\.moe"
CID = "https://files.catbox.moe/draw1example111.png"
CID2 = "https://files.catbox.moe/draw2example222.png"

THEME_RE = r"(?s).*Generate one drawing THEME.*"
JUDGE_RE = r"(?s).*judging a SKETCH & GUESS match.*"


def _setup_to_guessing(direct_vm, contract, direct_alice, direct_bob, room_id, category, theme):
    """Create -> join -> start (theme) -> both submit drawings. Leaves room in 'guessing'."""
    direct_vm.mock_llm(THEME_RE, {"theme": theme})
    direct_vm.sender = direct_alice
    contract.register_profile("Alice")
    contract.create_room(room_id, category, ZERO_ADDRESS, 0)
    direct_vm.sender = direct_bob
    contract.register_profile("Bob")
    contract.join_room(room_id)
    direct_vm.sender = direct_alice
    contract.start_room(room_id)
    contract.submit_drawing(room_id, CID)
    direct_vm.sender = direct_bob
    contract.submit_drawing(room_id, CID2)


def test_sketch_create_and_join(direct_vm, direct_deploy, direct_alice, direct_bob):
    contract = direct_deploy("contracts/sketch_game.py", ZERO_ADDRESS)
    direct_vm.sender = direct_alice
    contract.register_profile("Alice")
    contract.create_room("R0", "Animals", ZERO_ADDRESS, 0)
    direct_vm.sender = direct_bob
    contract.register_profile("Bob")
    contract.join_room("R0")
    room = contract.get_room("R0")
    assert room.mode == "sketch"
    assert room.status == "ready_to_start"
    assert room.owner_name == "Alice"
    assert room.opponent_name == "Bob"


def test_sketch_start_generates_theme(direct_vm, direct_deploy, direct_alice, direct_bob):
    contract = direct_deploy("contracts/sketch_game.py", ZERO_ADDRESS)
    direct_vm.mock_llm(THEME_RE, {"theme": "a wild animal"})
    direct_vm.sender = direct_alice
    contract.register_profile("Alice")
    contract.create_room("R1", "Animals", ZERO_ADDRESS, 0)
    direct_vm.sender = direct_bob
    contract.register_profile("Bob")
    contract.join_room("R1")
    direct_vm.sender = direct_alice
    contract.start_room("R1")
    room = contract.get_room("R1")
    assert room.status == "drawing"
    assert room.theme == "a wild animal"


def test_sketch_drawings_advance_to_guessing(direct_vm, direct_deploy, direct_alice, direct_bob):
    contract = direct_deploy("contracts/sketch_game.py", ZERO_ADDRESS)
    _setup_to_guessing(direct_vm, contract, direct_alice, direct_bob, "R2", "Animals", "a wild animal")
    room = contract.get_room("R2")
    assert room.status == "guessing"
    assert room.owner_drawing == CID
    assert room.opponent_drawing == CID2


def test_sketch_full_resolution_owner_correct_wins(direct_vm, direct_deploy, direct_alice, direct_bob):
    contract = direct_deploy("contracts/sketch_game.py", ZERO_ADDRESS)
    _setup_to_guessing(direct_vm, contract, direct_alice, direct_bob, "R3", "Animals", "a wild animal")

    direct_vm.mock_web(GATEWAY, {"status": 200, "body": PNG_BYTES})
    direct_vm.mock_llm(
        JUDGE_RE,
        {"owner_correct": True, "opponent_correct": False, "owner_score": 82, "opponent_score": 47,
         "reasoning": "Alice identified Bob's drawing; Bob missed Alice's."},
    )
    direct_vm.sender = direct_alice
    contract.submit_guess("R3", "a lion")
    direct_vm.sender = direct_bob
    contract.submit_guess("R3", "a car")  # triggers finalize

    room = contract.get_room("R3")
    assert room.status == "provisional"
    assert room.winner == room.owner  # owner_correct True, opponent_correct False
    assert room.owner_score == 82


def test_sketch_unreadable_drawings_default_owner(direct_vm, direct_deploy, direct_alice, direct_bob):
    contract = direct_deploy("contracts/sketch_game.py", ZERO_ADDRESS)
    _setup_to_guessing(direct_vm, contract, direct_alice, direct_bob, "R4", "Home", "a kitchen object")

    # Both drawings fetch as non-image bytes -> deterministic resolution, no vision call.
    direct_vm.mock_web(GATEWAY, {"status": 200, "body": b"plain text, not an image"})
    direct_vm.sender = direct_alice
    contract.submit_guess("R4", "a spoon")
    direct_vm.sender = direct_bob
    contract.submit_guess("R4", "a fork")

    room = contract.get_room("R4")
    assert room.status == "provisional"
    assert room.winner == room.owner  # both unreadable -> default owner


def test_sketch_rejects_short_guess(direct_vm, direct_deploy, direct_alice, direct_bob):
    contract = direct_deploy("contracts/sketch_game.py", ZERO_ADDRESS)
    _setup_to_guessing(direct_vm, contract, direct_alice, direct_bob, "R5", "Travel", "a famous landmark")
    direct_vm.sender = direct_alice
    with direct_vm.expect_revert("at least 2 characters"):
        contract.submit_guess("R5", "x")


def test_sketch_rejects_non_allowlisted_drawing(direct_vm, direct_deploy, direct_alice, direct_bob):
    contract = direct_deploy("contracts/sketch_game.py", ZERO_ADDRESS)
    direct_vm.mock_llm(THEME_RE, {"theme": "a wild animal"})
    direct_vm.sender = direct_alice
    contract.register_profile("Alice")
    contract.create_room("R6", "Animals", ZERO_ADDRESS, 0)
    direct_vm.sender = direct_bob
    contract.register_profile("Bob")
    contract.join_room("R6")
    direct_vm.sender = direct_alice
    contract.start_room("R6")
    with direct_vm.expect_revert("files.catbox.moe"):
        contract.submit_drawing("R6", "https://evil.example.com/x.png")


def test_sketch_guess_before_both_drawings_reverts(direct_vm, direct_deploy, direct_alice, direct_bob):
    contract = direct_deploy("contracts/sketch_game.py", ZERO_ADDRESS)
    direct_vm.mock_llm(THEME_RE, {"theme": "a wild animal"})
    direct_vm.sender = direct_alice
    contract.register_profile("Alice")
    contract.create_room("R7", "Animals", ZERO_ADDRESS, 0)
    direct_vm.sender = direct_bob
    contract.register_profile("Bob")
    contract.join_room("R7")
    direct_vm.sender = direct_alice
    contract.start_room("R7")
    contract.submit_drawing("R7", CID)  # only one drawing in
    with direct_vm.expect_revert("Both drawings must be in"):
        contract.submit_guess("R7", "a lion")


def test_sketch_forfeit_awards_other_player(direct_vm, direct_deploy, direct_alice, direct_bob):
    contract = direct_deploy("contracts/sketch_game.py", ZERO_ADDRESS)
    direct_vm.mock_llm(THEME_RE, {"theme": "a wild animal"})
    direct_vm.sender = direct_alice
    contract.register_profile("Alice")
    contract.create_room("R8", "Animals", ZERO_ADDRESS, 0)
    direct_vm.sender = direct_bob
    contract.register_profile("Bob")
    contract.join_room("R8")
    direct_vm.sender = direct_alice
    contract.start_room("R8")
    direct_vm.sender = direct_bob
    contract.forfeit_room("R8")
    room = contract.get_room("R8")
    assert room.status == "provisional"
    assert room.winner == room.owner  # opponent quit -> owner wins


def test_sketch_appeal_upheld_resolves(direct_vm, direct_deploy, direct_alice, direct_bob):
    contract = direct_deploy("contracts/sketch_game.py", ZERO_ADDRESS)
    _setup_to_guessing(direct_vm, contract, direct_alice, direct_bob, "R9", "Animals", "a wild animal")
    direct_vm.mock_web(GATEWAY, {"status": 200, "body": PNG_BYTES})
    direct_vm.mock_llm(
        JUDGE_RE,
        {"owner_correct": True, "opponent_correct": False, "owner_score": 80, "opponent_score": 40,
         "reasoning": "Alice wins."},
    )
    direct_vm.sender = direct_alice
    contract.submit_guess("R9", "a lion")
    direct_vm.sender = direct_bob
    contract.submit_guess("R9", "a car")
    assert contract.get_room("R9").status == "provisional"

    # Bob is the loser -> files an appeal, judge upholds the provisional result.
    direct_vm.sender = direct_bob
    contract.file_appeal("R9", "The judge misread my drawing entirely.")
    direct_vm.mock_llm(r"(?s).*APPEAL REVIEW.*", {"decision": "upheld", "reasoning": "Weak grounds; result stands."})
    contract.judge_appeal("R9")
    room = contract.get_room("R9")
    assert room.appeal_result == "upheld"
    assert room.status == "resolved"
