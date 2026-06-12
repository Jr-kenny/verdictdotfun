ZERO_ADDRESS = "0x0000000000000000000000000000000000000000"


def _mock_riddle_pack(direct_vm, room_id: str, category: str = "Tech"):
    direct_vm.mock_llm(
        rf"(?s).*Generate a 3-round riddle pack.*Category: {category}.*{room_id}.*",
        {
            "riddles": [
                {
                    "prompt": "I glow in your pocket, guide your maps, and go silent when the battery dies. What am I?",
                    "answer": "smartphone",
                    "aliases": ["phone", "mobile phone"],
                },
                {
                    "prompt": "I hold hot drinks, often keep heat for hours, and travel with commuters every morning. What am I?",
                    "answer": "thermos",
                    "aliases": ["flask", "vacuum flask"],
                },
                {
                    "prompt": "I spin warm air around a room from the ceiling, but I am not an air conditioner. What am I?",
                    "answer": "ceiling fan",
                    "aliases": ["fan"],
                },
            ]
        },
    )


def test_riddle_match_runs_for_three_rounds_and_first_to_three_wins(direct_vm, direct_deploy, direct_alice, direct_bob):
    contract = direct_deploy("contracts/riddle_game.py", ZERO_ADDRESS, False, 0)
    _mock_riddle_pack(direct_vm, "ROOM06")

    direct_vm.sender = direct_alice
    contract.register_profile("Alice")
    contract.create_room("ROOM06", "Tech")

    room = contract.get_room("ROOM06")
    assert room.question_count == 3
    assert room.current_question_index == 1

    direct_vm.sender = direct_bob
    contract.register_profile("Bob")
    contract.join_room("ROOM06")

    direct_vm.sender = direct_alice
    contract.submit_entry("ROOM06", "smartphone")

    room = contract.get_room("ROOM06")
    assert room.owner_score == 1
    assert room.current_question_index == 2
    assert room.prompt.startswith("I hold hot drinks")

    direct_vm.sender = direct_alice
    contract.submit_entry("ROOM06", "thermos")

    room = contract.get_room("ROOM06")
    assert room.owner_score == 2
    assert room.opponent_score == 0
    assert room.current_question_index == 3
    assert room.revealed_answer == "thermos"

    direct_vm.sender = direct_alice
    contract.submit_entry("ROOM06", "ceiling fan")

    resolved = contract.get_room("ROOM06")
    assert resolved.status == "provisional"
    assert resolved.winner == resolved.owner
    assert resolved.owner_score == 3
    assert resolved.opponent_score == 0
    assert "solved three riddles first" in resolved.verdict_reasoning

    contract.finalize_room("ROOM06")
    assert contract.get_room("ROOM06").status == "resolved"


def test_riddle_allows_three_guesses_each_before_advancing_to_next_riddle(direct_vm, direct_deploy, direct_alice, direct_bob):
    contract = direct_deploy("contracts/riddle_game.py", ZERO_ADDRESS)
    _mock_riddle_pack(direct_vm, "ROOM09")

    direct_vm.sender = direct_alice
    contract.register_profile("Alice")
    contract.create_room("ROOM09", "Tech")

    direct_vm.sender = direct_bob
    contract.register_profile("Bob")
    contract.join_room("ROOM09")

    direct_vm.sender = direct_alice
    contract.submit_entry("ROOM09", "tablet")
    contract.submit_entry("ROOM09", "pager")
    contract.submit_entry("ROOM09", "laptop")

    direct_vm.sender = direct_bob
    contract.submit_entry("ROOM09", "camera")
    contract.submit_entry("ROOM09", "watch")
    contract.submit_entry("ROOM09", "speaker")

    room = contract.get_room("ROOM09")
    assert room.current_question_index == 2
    assert room.owner_score == 0
    assert room.opponent_score == 0
    assert room.revealed_answer == "smartphone"
    assert "Neither player solved riddle 1 after 3 guesses each." == room.verdict_reasoning


def test_riddle_fastest_correct_guess_wins_the_round_immediately(direct_vm, direct_deploy, direct_alice, direct_bob):
    contract = direct_deploy("contracts/riddle_game.py", ZERO_ADDRESS)
    _mock_riddle_pack(direct_vm, "ROOM10")

    direct_vm.sender = direct_alice
    contract.register_profile("Alice")
    contract.create_room("ROOM10", "Tech")

    direct_vm.sender = direct_bob
    contract.register_profile("Bob")
    contract.join_room("ROOM10")

    direct_vm.sender = direct_bob
    contract.submit_entry("ROOM10", "phone")

    room = contract.get_room("ROOM10")
    assert room.current_question_index == 2
    assert room.owner_score == 0
    assert room.opponent_score == 1
    assert room.revealed_answer == "smartphone"
    assert room.prompt.startswith("I hold hot drinks")


def test_riddle_match_can_end_in_a_tie_when_scores_are_level_after_three_riddles(direct_vm, direct_deploy, direct_alice, direct_bob):
    contract = direct_deploy("contracts/riddle_game.py", ZERO_ADDRESS)
    _mock_riddle_pack(direct_vm, "ROOM11")

    direct_vm.sender = direct_alice
    contract.register_profile("Alice")
    contract.create_room("ROOM11", "Tech")

    direct_vm.sender = direct_bob
    contract.register_profile("Bob")
    contract.join_room("ROOM11")

    direct_vm.sender = direct_alice
    contract.submit_entry("ROOM11", "smartphone")

    direct_vm.sender = direct_bob
    contract.submit_entry("ROOM11", "thermos")

    direct_vm.sender = direct_alice
    contract.submit_entry("ROOM11", "lamp")
    contract.submit_entry("ROOM11", "light")
    contract.submit_entry("ROOM11", "desk")

    direct_vm.sender = direct_bob
    contract.submit_entry("ROOM11", "cup")
    contract.submit_entry("ROOM11", "mug")
    contract.submit_entry("ROOM11", "bottle")

    resolved = contract.get_room("ROOM11")
    assert resolved.status == "resolved"
    assert str(resolved.winner).lower() == ZERO_ADDRESS
    assert resolved.owner_score == 1
    assert resolved.opponent_score == 1
    assert "resolved with no winner" in resolved.verdict_reasoning


def test_riddle_pack_generation_uses_the_selected_category(direct_vm, direct_deploy, direct_alice):
    contract = direct_deploy("contracts/riddle_game.py", ZERO_ADDRESS)
    _mock_riddle_pack(direct_vm, "ROOM07", "Nature")

    direct_vm.sender = direct_alice
    contract.register_profile("Alice")
    contract.create_room("ROOM07", "Nature")

    room = contract.get_room("ROOM07")
    assert room.prompt
    assert room.category == "Nature"
    assert room.question_count == 3


def test_riddle_forfeit_resolves_the_other_player_as_winner(direct_vm, direct_deploy, direct_alice, direct_bob):
    contract = direct_deploy("contracts/riddle_game.py", ZERO_ADDRESS)
    _mock_riddle_pack(direct_vm, "ROOM08")

    direct_vm.sender = direct_alice
    contract.register_profile("Alice")
    contract.create_room("ROOM08", "Tech")

    direct_vm.sender = direct_bob
    contract.register_profile("Bob")
    contract.join_room("ROOM08")
    contract.forfeit_room("ROOM08")

    room = contract.get_room("ROOM08")
    assert room.status == "provisional"
    assert room.winner == room.owner
    assert room.provisional_at > 0
    assert "wins by forfeit" in room.verdict_reasoning


# ---- two-phase settlement + appeals (Plan 1C) ----
def _riddle_forfeit_provisional(direct_vm, direct_deploy, direct_alice, direct_bob, rid, window=3600):
    contract = direct_deploy("contracts/riddle_game.py", ZERO_ADDRESS, False, window)
    _mock_riddle_pack(direct_vm, rid)
    direct_vm.sender = direct_alice
    contract.register_profile("Alice")
    contract.create_room(rid, "Tech", ZERO_ADDRESS, 0)
    direct_vm.sender = direct_bob
    contract.register_profile("Bob")
    contract.join_room(rid)
    contract.forfeit_room(rid)  # Bob quits -> Alice provisional winner, Bob loser
    return contract


def test_riddle_loser_can_file_one_appeal(direct_vm, direct_deploy, direct_alice, direct_bob):
    contract = _riddle_forfeit_provisional(direct_vm, direct_deploy, direct_alice, direct_bob, "RAP01")
    direct_vm.sender = direct_bob
    contract.file_appeal("RAP01", "My connection dropped before I could guess.")
    assert contract.get_room("RAP01").appeal_state == "filed"
    with direct_vm.expect_revert("already been filed"):
        contract.file_appeal("RAP01", "second attempt at an appeal")


def test_riddle_winner_cannot_appeal(direct_vm, direct_deploy, direct_alice, direct_bob):
    contract = _riddle_forfeit_provisional(direct_vm, direct_deploy, direct_alice, direct_bob, "RAP02")
    direct_vm.sender = direct_alice
    with direct_vm.expect_revert("losing player"):
        contract.file_appeal("RAP02", "I want a bigger margin of victory")


def test_riddle_appeal_upheld_resolves(direct_vm, direct_deploy, direct_alice, direct_bob):
    contract = _riddle_forfeit_provisional(direct_vm, direct_deploy, direct_alice, direct_bob, "RJU01")
    direct_vm.sender = direct_bob
    contract.file_appeal("RJU01", "I lagged but honestly the forfeit stands; weak grounds.")
    direct_vm.mock_llm(r"(?s).*APPEAL REVIEW.*",
                       {"decision": "upheld", "reasoning": "No evidence of an unfair result."})
    contract.judge_appeal("RJU01")
    room = contract.get_room("RJU01")
    assert room.appeal_result == "upheld"
    assert room.status == "resolved"


def test_riddle_appeal_overturned_voids(direct_vm, direct_deploy, direct_alice, direct_bob):
    contract = _riddle_forfeit_provisional(direct_vm, direct_deploy, direct_alice, direct_bob, "RJU02")
    direct_vm.sender = direct_bob
    contract.file_appeal("RJU02", "Verified outage knocked me offline mid-match.")
    direct_vm.mock_llm(r"(?s).*APPEAL REVIEW.*",
                       {"decision": "overturned", "reasoning": "Genuine disconnect; void."})
    contract.judge_appeal("RJU02")
    room = contract.get_room("RJU02")
    assert room.appeal_result == "overturned"
    assert room.status == "void"


def test_riddle_finalize_blocked_while_window_open(direct_vm, direct_deploy, direct_alice, direct_bob):
    contract = _riddle_forfeit_provisional(direct_vm, direct_deploy, direct_alice, direct_bob, "RFI01", window=3600)
    with direct_vm.expect_revert("Challenge window is still open"):
        contract.finalize_room("RFI01")


def test_riddle_finalize_after_window_resolves(direct_vm, direct_deploy, direct_alice, direct_bob):
    contract = _riddle_forfeit_provisional(direct_vm, direct_deploy, direct_alice, direct_bob, "RFI02", window=0)
    contract.finalize_room("RFI02")
    assert contract.get_room("RFI02").status == "resolved"
