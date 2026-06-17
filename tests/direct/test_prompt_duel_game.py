ZERO_ADDRESS = "0x0000000000000000000000000000000000000000"


def test_prompt_duel_full_resolution_flow(direct_vm, direct_deploy, direct_alice, direct_bob):
    contract = direct_deploy("contracts/prompt_duel_game.py", ZERO_ADDRESS)

    direct_vm.mock_llm(
        r"(?s).*Generate one target OUTPUT.*Category: Poetry.*ROOM01.*",
        {"target": "A short four-line poem about the sea at dawn, gentle and hopeful, with an ABAB rhyme."},
    )

    direct_vm.sender = direct_alice
    contract.register_profile("Alice")
    contract.create_room("ROOM01", "Poetry", ZERO_ADDRESS, 0)
    direct_vm.sender = direct_bob
    contract.register_profile("Bob")
    contract.join_room("ROOM01")
    direct_vm.sender = direct_alice
    contract.start_room("ROOM01")
    contract.submit_entry("ROOM01", "Write a four-line ABAB poem about the sea at dawn, gentle and hopeful.")

    direct_vm.mock_llm(
        r"(?s).*You are judging a PROMPT DUEL.*A short four-line poem about the sea at dawn.*",
        {"winner": "owner", "owner_score": 92, "opponent_score": 64,
         "reasoning": "Alice's prompt specifies form, subject, and tone, so its output lands closest to the target."},
    )
    direct_vm.sender = direct_bob
    contract.submit_entry("ROOM01", "write a poem about the ocean")

    room = contract.get_room("ROOM01")
    assert room.status == "provisional"
    assert room.target != ""
    assert room.owner_score == 92
    assert room.winner != ZERO_ADDRESS


def test_prompt_duel_rejects_bad_prompt_length(direct_vm, direct_deploy, direct_alice, direct_bob):
    contract = direct_deploy("contracts/prompt_duel_game.py", ZERO_ADDRESS)
    direct_vm.mock_llm(r"(?s).*Generate one target OUTPUT.*", {"target": "A precise two-sentence product blurb for a reusable steel water bottle, friendly and concrete."})
    direct_vm.sender = direct_alice
    contract.register_profile("Alice"); contract.create_room("R1", "Marketing", ZERO_ADDRESS, 0)
    direct_vm.sender = direct_bob
    contract.register_profile("Bob"); contract.join_room("R1")
    direct_vm.sender = direct_alice; contract.start_room("R1")
    import pytest
    with pytest.raises(Exception):
        contract.submit_entry("R1", "x")  # too short


def test_prompt_duel_rejects_overlong_prompt(direct_vm, direct_deploy, direct_alice, direct_bob):
    contract = direct_deploy("contracts/prompt_duel_game.py", ZERO_ADDRESS)
    direct_vm.mock_llm(r"(?s).*Generate one target OUTPUT.*", {"target": "A precise two-sentence product blurb for a reusable steel water bottle, friendly and concrete."})
    direct_vm.sender = direct_alice
    contract.register_profile("Alice"); contract.create_room("R1B", "Marketing", ZERO_ADDRESS, 0)
    direct_vm.sender = direct_bob
    contract.register_profile("Bob"); contract.join_room("R1B")
    direct_vm.sender = direct_alice; contract.start_room("R1B")
    with direct_vm.expect_revert("500 characters or fewer"):
        contract.submit_entry("R1B", "x" * 501)


def test_prompt_duel_tie_breaks_on_brevity(direct_vm, direct_deploy, direct_alice, direct_bob):
    contract = direct_deploy("contracts/prompt_duel_game.py", ZERO_ADDRESS)
    direct_vm.mock_llm(r"(?s).*Generate one target OUTPUT.*", {"target": "A precise two-sentence product blurb for a reusable steel water bottle, friendly and concrete."})
    direct_vm.sender = direct_alice
    contract.register_profile("Alice"); contract.create_room("R2", "Marketing", ZERO_ADDRESS, 0)
    direct_vm.sender = direct_bob
    contract.register_profile("Bob"); contract.join_room("R2")
    direct_vm.sender = direct_alice; contract.start_room("R2")
    contract.submit_entry("R2", "Two friendly concrete sentences for a reusable steel water bottle product blurb.")
    direct_vm.mock_llm(r"(?s).*You are judging a PROMPT DUEL.*",
                       {"winner": "owner", "owner_score": 80, "opponent_score": 80, "reasoning": "Equally close."})
    direct_vm.sender = direct_bob
    contract.submit_entry("R2", "Blurb: reusable steel water bottle, two sentences, friendly, concrete.")  # shorter
    room = contract.get_room("R2")
    # Bob's prompt is shorter -> opponent wins the tie.
    assert room.status == "provisional"
    assert room.winner == room.opponent


def _forfeit_provisional(direct_vm, direct_deploy, direct_alice, direct_bob, rid, window=3600):
    contract = direct_deploy("contracts/prompt_duel_game.py", ZERO_ADDRESS, False, window)
    direct_vm.mock_llm(
        r"(?s).*Generate one target OUTPUT.*" + rid + r".*",
        {"target": "A precise two-sentence product blurb for a reusable steel water bottle, friendly and concrete."},
    )
    direct_vm.sender = direct_alice
    contract.register_profile("Alice")
    contract.create_room(rid, "Marketing", ZERO_ADDRESS, 0)
    direct_vm.sender = direct_bob
    contract.register_profile("Bob")
    contract.join_room(rid)
    contract.forfeit_room(rid)  # Bob quits -> Alice provisional winner, Bob is loser
    return contract


def test_prompt_duel_forfeit_resolves_the_other_player_as_winner(direct_vm, direct_deploy, direct_alice, direct_bob):
    contract = direct_deploy("contracts/prompt_duel_game.py", ZERO_ADDRESS)
    direct_vm.mock_llm(r"(?s).*Generate one target OUTPUT.*ROOM10.*",
                       {"target": "A precise two-sentence tagline for a city library reading app, warm and inviting."})
    direct_vm.sender = direct_alice
    contract.register_profile("Alice")
    contract.create_room("ROOM10", "Marketing", ZERO_ADDRESS, 0)
    direct_vm.sender = direct_bob
    contract.register_profile("Bob")
    contract.join_room("ROOM10")
    contract.forfeit_room("ROOM10")

    room = contract.get_room("ROOM10")
    assert room.status == "provisional"
    assert room.winner == room.owner
    assert room.owner_score == 100
    assert room.opponent_score == 0
    assert room.provisional_at > 0


def test_prompt_duel_loser_can_file_one_appeal(direct_vm, direct_deploy, direct_alice, direct_bob):
    contract = _forfeit_provisional(direct_vm, direct_deploy, direct_alice, direct_bob, "APP01")
    direct_vm.sender = direct_bob  # provisional loser
    contract.file_appeal("APP01", "My wifi dropped mid-round; I did not intend to quit.")
    assert contract.get_room("APP01").appeal_state == "filed"
    with direct_vm.expect_revert("already been filed"):
        contract.file_appeal("APP01", "trying to appeal a second time")


def test_prompt_duel_winner_cannot_appeal(direct_vm, direct_deploy, direct_alice, direct_bob):
    contract = _forfeit_provisional(direct_vm, direct_deploy, direct_alice, direct_bob, "APP02")
    direct_vm.sender = direct_alice  # provisional winner
    with direct_vm.expect_revert("losing player"):
        contract.file_appeal("APP02", "I deserve to win even more")


def test_prompt_duel_appeal_upheld_resolves_to_winner(direct_vm, direct_deploy, direct_alice, direct_bob):
    contract = _forfeit_provisional(direct_vm, direct_deploy, direct_alice, direct_bob, "JUD01")
    direct_vm.sender = direct_bob
    contract.file_appeal("JUD01", "I lagged but the result is basically fair; weak grounds.")
    direct_vm.mock_llm(r"(?s).*APPEAL REVIEW.*",
                       {"decision": "upheld", "reasoning": "No evidence the result was unfair."})
    contract.judge_appeal("JUD01")
    room = contract.get_room("JUD01")
    assert room.appeal_state == "judged"
    assert room.appeal_result == "upheld"
    assert room.status == "resolved"


def test_prompt_duel_appeal_overturned_voids_room(direct_vm, direct_deploy, direct_alice, direct_bob):
    contract = _forfeit_provisional(direct_vm, direct_deploy, direct_alice, direct_bob, "JUD02")
    direct_vm.sender = direct_bob
    contract.file_appeal("JUD02", "Verified regional network outage during the match window.")
    direct_vm.mock_llm(r"(?s).*APPEAL REVIEW.*",
                       {"decision": "overturned", "reasoning": "Genuine disconnect; void and refund."})
    contract.judge_appeal("JUD02")
    room = contract.get_room("JUD02")
    assert room.appeal_result == "overturned"
    assert room.status == "void"
