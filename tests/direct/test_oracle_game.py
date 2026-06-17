ZERO_ADDRESS = "0x0000000000000000000000000000000000000000"

QUESTION_GEN_RE = r"(?s).*Generate one YES/NO forecast question.*"
RESOLVE_RE = r"(?s).*impartial oracle resolving a YES/NO forecast question.*"
QPACK = {
    "question": "Will the referenced match have finished by the listed date?",
    "source": "https://example.org/forecast",
}
SOURCE_RE = r"example\.org"


def _create_join_start(direct_vm, contract, direct_alice, direct_bob, room_id, category="Sports"):
    """Caller must set the QUESTION_GEN_RE mock first. Leaves the room 'active'."""
    direct_vm.sender = direct_alice
    contract.register_profile("Alice")
    contract.create_room(room_id, category, ZERO_ADDRESS, 0)
    direct_vm.sender = direct_bob
    contract.register_profile("Bob")
    contract.join_room(room_id)
    direct_vm.sender = direct_alice
    contract.start_room(room_id)


def test_oracle_create_and_join(direct_vm, direct_deploy, direct_alice, direct_bob):
    contract = direct_deploy("contracts/oracle_game.py", ZERO_ADDRESS)
    direct_vm.sender = direct_alice
    contract.register_profile("Alice")
    contract.create_room("R0", "Sports", ZERO_ADDRESS, 0)
    direct_vm.sender = direct_bob
    contract.register_profile("Bob")
    contract.join_room("R0")
    room = contract.get_room("R0")
    assert room.mode == "oracle"
    assert room.status == "ready_to_start"


def test_oracle_start_generates_question_and_source(direct_vm, direct_deploy, direct_alice, direct_bob):
    contract = direct_deploy("contracts/oracle_game.py", ZERO_ADDRESS)
    direct_vm.mock_llm(QUESTION_GEN_RE, QPACK)
    _create_join_start(direct_vm, contract, direct_alice, direct_bob, "R1")
    room = contract.get_room("R1")
    assert room.status == "active"
    assert room.question == QPACK["question"]
    assert room.source == "https://example.org/forecast"


def test_oracle_resolve_yes_owner_wins(direct_vm, direct_deploy, direct_alice, direct_bob):
    contract = direct_deploy("contracts/oracle_game.py", ZERO_ADDRESS)
    direct_vm.mock_llm(QUESTION_GEN_RE, QPACK)
    _create_join_start(direct_vm, contract, direct_alice, direct_bob, "R2")
    direct_vm.mock_web(SOURCE_RE, {"status": 200, "body": b"Final: the match finished on time."})
    direct_vm.mock_llm(RESOLVE_RE, {"outcome": "yes", "reasoning": "The source confirms it finished."})
    direct_vm.sender = direct_alice
    contract.resolve_room("R2")
    room = contract.get_room("R2")
    assert room.status == "provisional"
    assert room.outcome == "yes"
    assert room.winner == room.owner


def test_oracle_resolve_no_opponent_wins(direct_vm, direct_deploy, direct_alice, direct_bob):
    contract = direct_deploy("contracts/oracle_game.py", ZERO_ADDRESS)
    direct_vm.mock_llm(QUESTION_GEN_RE, QPACK)
    _create_join_start(direct_vm, contract, direct_alice, direct_bob, "R3")
    direct_vm.mock_web(SOURCE_RE, {"status": 200, "body": b"The match was postponed."})
    direct_vm.mock_llm(RESOLVE_RE, {"outcome": "no", "reasoning": "The source shows it did not finish."})
    direct_vm.sender = direct_bob
    contract.resolve_room("R3")
    room = contract.get_room("R3")
    assert room.status == "provisional"
    assert room.outcome == "no"
    assert room.winner == room.opponent


def test_oracle_unknown_outcome_reverts(direct_vm, direct_deploy, direct_alice, direct_bob):
    contract = direct_deploy("contracts/oracle_game.py", ZERO_ADDRESS)
    direct_vm.mock_llm(QUESTION_GEN_RE, QPACK)
    _create_join_start(direct_vm, contract, direct_alice, direct_bob, "R4")
    direct_vm.mock_web(SOURCE_RE, {"status": 200, "body": b"No information available yet."})
    direct_vm.mock_llm(RESOLVE_RE, {"outcome": "unknown", "reasoning": "Source does not settle it."})
    direct_vm.sender = direct_alice
    with direct_vm.expect_revert("could not be determined"):
        contract.resolve_room("R4")


def test_oracle_operator_resolve_is_owner_gated(direct_vm, direct_deploy, direct_alice, direct_bob):
    contract = direct_deploy("contracts/oracle_game.py", ZERO_ADDRESS)
    direct_vm.mock_llm(QUESTION_GEN_RE, QPACK)
    _create_join_start(direct_vm, contract, direct_alice, direct_bob, "R5")
    direct_vm.sender = direct_alice  # a player, not the contract owner
    with direct_vm.expect_revert("Only the contract owner"):
        contract.operator_resolve("R5", "yes")


def test_oracle_forfeit_awards_other_player(direct_vm, direct_deploy, direct_alice, direct_bob):
    contract = direct_deploy("contracts/oracle_game.py", ZERO_ADDRESS)
    direct_vm.mock_llm(QUESTION_GEN_RE, QPACK)
    _create_join_start(direct_vm, contract, direct_alice, direct_bob, "R6")
    direct_vm.sender = direct_bob
    contract.forfeit_room("R6")
    room = contract.get_room("R6")
    assert room.status == "provisional"
    assert room.winner == room.owner


def test_oracle_appeal_upheld_resolves(direct_vm, direct_deploy, direct_alice, direct_bob):
    contract = direct_deploy("contracts/oracle_game.py", ZERO_ADDRESS)
    direct_vm.mock_llm(QUESTION_GEN_RE, QPACK)
    _create_join_start(direct_vm, contract, direct_alice, direct_bob, "R7")
    direct_vm.mock_web(SOURCE_RE, {"status": 200, "body": b"Final: finished on time."})
    direct_vm.mock_llm(RESOLVE_RE, {"outcome": "yes", "reasoning": "Confirmed finished."})
    direct_vm.sender = direct_alice
    contract.resolve_room("R7")
    assert contract.get_room("R7").status == "provisional"

    # Opponent backed NO and lost -> disputes via appeal; judge upholds.
    direct_vm.sender = direct_bob
    contract.file_appeal("R7", "The source was stale and misread by the oracle.")
    direct_vm.mock_llm(r"(?s).*APPEAL REVIEW.*", {"decision": "upheld", "reasoning": "Result stands."})
    contract.judge_appeal("R7")
    room = contract.get_room("R7")
    assert room.appeal_result == "upheld"
    assert room.status == "resolved"
