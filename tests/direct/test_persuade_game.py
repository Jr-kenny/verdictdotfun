ZERO_ADDRESS = "0x0000000000000000000000000000000000000000"

PERSONA = (
    "Mayor Cole opposes a new downtown skatepark over noise and cost worries. He privately cares "
    "about cutting youth crime and being seen as forward-thinking, and will only move if shown the "
    "park helps both."
)
PERSONA_RE = r"(?s).*Generate a stubborn CHARACTER.*"
TURN_STRONG_RE = r"(?s).*role-playing a stubborn character.*STRONG case.*"
TURN_WEAK_RE = r"(?s).*role-playing a stubborn character.*whatever.*"


def _create_join_start(direct_vm, contract, direct_alice, direct_bob, room_id, category="Civics"):
    """Caller must set the PERSONA_RE mock first. Leaves the room 'active' with a persona."""
    direct_vm.sender = direct_alice
    contract.register_profile("Alice")
    contract.create_room(room_id, category, ZERO_ADDRESS, 0)
    direct_vm.sender = direct_bob
    contract.register_profile("Bob")
    contract.join_room(room_id)
    direct_vm.sender = direct_alice
    contract.start_room(room_id)


def test_persuade_create_and_join(direct_vm, direct_deploy, direct_alice, direct_bob):
    contract = direct_deploy("contracts/persuade_game.py", ZERO_ADDRESS)
    direct_vm.sender = direct_alice
    contract.register_profile("Alice")
    contract.create_room("R0", "Civics", ZERO_ADDRESS, 0)
    direct_vm.sender = direct_bob
    contract.register_profile("Bob")
    contract.join_room("R0")
    room = contract.get_room("R0")
    assert room.mode == "persuade"
    assert room.status == "ready_to_start"


def test_persuade_start_generates_persona(direct_vm, direct_deploy, direct_alice, direct_bob):
    contract = direct_deploy("contracts/persuade_game.py", ZERO_ADDRESS)
    direct_vm.mock_llm(PERSONA_RE, {"persona": PERSONA})
    _create_join_start(direct_vm, contract, direct_alice, direct_bob, "R1")
    room = contract.get_room("R1")
    assert room.status == "active"
    assert "Mayor Cole" in room.persona


def test_persuade_turn_updates_meter(direct_vm, direct_deploy, direct_alice, direct_bob):
    contract = direct_deploy("contracts/persuade_game.py", ZERO_ADDRESS)
    direct_vm.mock_llm(PERSONA_RE, {"persona": PERSONA})
    _create_join_start(direct_vm, contract, direct_alice, direct_bob, "R2")
    direct_vm.mock_llm(TURN_STRONG_RE, {"reply": "You raise a fair point.", "meter": 70, "reasoning": "Good reasoning."})
    direct_vm.sender = direct_alice
    contract.submit_turn("R2", "Here is a STRONG case: the park cuts crime and boosts your image.")
    room = contract.get_room("R2")
    assert room.status == "active"
    assert room.owner_meter == 70
    assert room.owner_turns == 1
    assert "PLAYER:" in room.owner_transcript


def test_persuade_full_flow_higher_meter_wins(direct_vm, direct_deploy, direct_alice, direct_bob):
    contract = direct_deploy("contracts/persuade_game.py", ZERO_ADDRESS)
    direct_vm.mock_llm(PERSONA_RE, {"persona": PERSONA})
    _create_join_start(direct_vm, contract, direct_alice, direct_bob, "R3")
    direct_vm.mock_llm(TURN_STRONG_RE, {"reply": "Convincing.", "meter": 88, "reasoning": "Strong."})
    direct_vm.mock_llm(TURN_WEAK_RE, {"reply": "No.", "meter": 15, "reasoning": "Weak."})

    direct_vm.sender = direct_alice
    contract.submit_turn("R3", "Here is a STRONG case for the skatepark.")
    contract.finish_persuading("R3")
    direct_vm.sender = direct_bob
    contract.submit_turn("R3", "eh whatever, just change your mind already.")
    contract.finish_persuading("R3")  # both done -> finalize

    room = contract.get_room("R3")
    assert room.status == "provisional"
    assert room.winner == room.owner
    assert room.owner_score == 88
    assert room.opponent_score == 15


def test_persuade_rejects_short_message(direct_vm, direct_deploy, direct_alice, direct_bob):
    contract = direct_deploy("contracts/persuade_game.py", ZERO_ADDRESS)
    direct_vm.mock_llm(PERSONA_RE, {"persona": PERSONA})
    _create_join_start(direct_vm, contract, direct_alice, direct_bob, "R4")
    direct_vm.sender = direct_alice
    with direct_vm.expect_revert("at least 4 characters"):
        contract.submit_turn("R4", "x")


def test_persuade_turn_after_finish_reverts(direct_vm, direct_deploy, direct_alice, direct_bob):
    contract = direct_deploy("contracts/persuade_game.py", ZERO_ADDRESS)
    direct_vm.mock_llm(PERSONA_RE, {"persona": PERSONA})
    _create_join_start(direct_vm, contract, direct_alice, direct_bob, "R5")
    direct_vm.mock_llm(TURN_STRONG_RE, {"reply": "Hm.", "meter": 50, "reasoning": "ok"})
    direct_vm.sender = direct_alice
    contract.submit_turn("R5", "A STRONG case worth making here.")
    contract.finish_persuading("R5")
    with direct_vm.expect_revert("finished your attempt"):
        contract.submit_turn("R5", "Another STRONG case attempt.")


def test_persuade_forfeit_awards_other_player(direct_vm, direct_deploy, direct_alice, direct_bob):
    contract = direct_deploy("contracts/persuade_game.py", ZERO_ADDRESS)
    direct_vm.mock_llm(PERSONA_RE, {"persona": PERSONA})
    _create_join_start(direct_vm, contract, direct_alice, direct_bob, "R6")
    direct_vm.sender = direct_bob
    contract.forfeit_room("R6")
    room = contract.get_room("R6")
    assert room.status == "provisional"
    assert room.winner == room.owner


def test_persuade_appeal_upheld_resolves(direct_vm, direct_deploy, direct_alice, direct_bob):
    contract = direct_deploy("contracts/persuade_game.py", ZERO_ADDRESS)
    direct_vm.mock_llm(PERSONA_RE, {"persona": PERSONA})
    _create_join_start(direct_vm, contract, direct_alice, direct_bob, "R7")
    direct_vm.mock_llm(TURN_STRONG_RE, {"reply": "Convincing.", "meter": 88, "reasoning": "Strong."})
    direct_vm.mock_llm(TURN_WEAK_RE, {"reply": "No.", "meter": 15, "reasoning": "Weak."})
    direct_vm.sender = direct_alice
    contract.submit_turn("R7", "Here is a STRONG case for the skatepark.")
    contract.finish_persuading("R7")
    direct_vm.sender = direct_bob
    contract.submit_turn("R7", "eh whatever, change your mind.")
    contract.finish_persuading("R7")
    assert contract.get_room("R7").status == "provisional"

    # Bob is the loser -> appeals, judge upholds the provisional result.
    direct_vm.sender = direct_bob
    contract.file_appeal("R7", "The character was impossible to convince.")
    direct_vm.mock_llm(r"(?s).*APPEAL REVIEW.*", {"decision": "upheld", "reasoning": "Result stands."})
    contract.judge_appeal("R7")
    room = contract.get_room("R7")
    assert room.appeal_result == "upheld"
    assert room.status == "resolved"
