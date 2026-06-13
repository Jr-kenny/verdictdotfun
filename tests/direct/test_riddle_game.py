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


# ---- image evidence for appeals (handoff #1) ----
PNG_BYTES = b"\x89PNG\r\n\x1a\n" + b"\x00" * 96
GATEWAY = r"ipfs\.io/ipfs/"
CID = "bafybeigdyrztexamplecidexamplecidexamplecid000"


def test_riddle_file_appeal_stores_evidence_cid(direct_vm, direct_deploy, direct_alice, direct_bob):
    contract = _riddle_forfeit_provisional(direct_vm, direct_deploy, direct_alice, direct_bob, "REVID1")
    direct_vm.sender = direct_bob
    contract.file_appeal("REVID1", "My screen froze; screenshot attached as proof.", CID)
    room = contract.get_room("REVID1")
    assert room.appeal_state == "filed"
    assert room.evidence_uri == CID


def test_riddle_file_appeal_strips_ipfs_scheme(direct_vm, direct_deploy, direct_alice, direct_bob):
    contract = _riddle_forfeit_provisional(direct_vm, direct_deploy, direct_alice, direct_bob, "REVID2")
    direct_vm.sender = direct_bob
    contract.file_appeal("REVID2", "Proof of the disconnect is attached.", "ipfs://" + CID)
    assert contract.get_room("REVID2").evidence_uri == CID


def test_riddle_file_appeal_rejects_url_evidence(direct_vm, direct_deploy, direct_alice, direct_bob):
    contract = _riddle_forfeit_provisional(direct_vm, direct_deploy, direct_alice, direct_bob, "REVID3")
    direct_vm.sender = direct_bob
    with direct_vm.expect_revert("bare IPFS CID"):
        contract.file_appeal("REVID3", "Here is my evidence link.", "https://evil.example.com/x.png")


def test_riddle_text_only_appeal_leaves_evidence_empty(direct_vm, direct_deploy, direct_alice, direct_bob):
    contract = _riddle_forfeit_provisional(direct_vm, direct_deploy, direct_alice, direct_bob, "REVID4")
    direct_vm.sender = direct_bob
    contract.file_appeal("REVID4", "Plain text appeal with no screenshot.")
    assert contract.get_room("REVID4").evidence_uri == ""


def test_riddle_appeal_with_image_evidence_overturned(direct_vm, direct_deploy, direct_alice, direct_bob):
    contract = _riddle_forfeit_provisional(direct_vm, direct_deploy, direct_alice, direct_bob, "RVIS1")
    direct_vm.sender = direct_bob
    contract.file_appeal("RVIS1", "Screenshot shows the disconnect error dialog.", CID)
    direct_vm.mock_web(GATEWAY, {"status": 200, "body": PNG_BYTES})
    direct_vm.mock_llm(r"(?s).*APPEAL REVIEW.*",
                       {"decision": "overturned", "reasoning": "Screenshot confirms a genuine disconnect."})
    contract.judge_appeal("RVIS1")
    room = contract.get_room("RVIS1")
    assert room.appeal_result == "overturned"
    assert room.status == "void"


def test_riddle_appeal_prompt_notes_attached_evidence(direct_vm, direct_deploy, direct_alice, direct_bob):
    contract = _riddle_forfeit_provisional(direct_vm, direct_deploy, direct_alice, direct_bob, "RVIS2")
    direct_vm.sender = direct_bob
    contract.file_appeal("RVIS2", "See the attached screenshot of the crash.", CID)
    direct_vm.mock_web(GATEWAY, {"status": 200, "body": PNG_BYTES})
    direct_vm.mock_llm(r"(?s).*APPEAL REVIEW.*attached an image.*",
                       {"decision": "upheld", "reasoning": "Image does not support the claim."})
    contract.judge_appeal("RVIS2")
    assert contract.get_room("RVIS2").appeal_result == "upheld"


def test_riddle_appeal_non_image_evidence_dismisses_appeal(direct_vm, direct_deploy, direct_alice, direct_bob):
    # Junk evidence dismisses the appeal instead of deadlocking the room.
    contract = _riddle_forfeit_provisional(direct_vm, direct_deploy, direct_alice, direct_bob, "RVIS3")
    direct_vm.sender = direct_bob
    contract.file_appeal("RVIS3", "Attached file is my evidence of the fault.", CID)
    direct_vm.mock_web(GATEWAY, {"status": 200, "body": b"this is plain text, not an image"})
    contract.judge_appeal("RVIS3")
    room = contract.get_room("RVIS3")
    assert room.appeal_result == "upheld"
    assert room.status == "resolved"


def test_riddle_appeal_oversize_evidence_dismisses_appeal(direct_vm, direct_deploy, direct_alice, direct_bob):
    contract = _riddle_forfeit_provisional(direct_vm, direct_deploy, direct_alice, direct_bob, "RVIS4")
    direct_vm.sender = direct_bob
    contract.file_appeal("RVIS4", "Large screenshot attached as evidence here.", CID)
    oversize = b"\x89PNG\r\n\x1a\n" + b"\x00" * (5 * 1024 * 1024 + 1)
    direct_vm.mock_web(GATEWAY, {"status": 200, "body": oversize})
    contract.judge_appeal("RVIS4")
    assert contract.get_room("RVIS4").appeal_result == "upheld"


def test_riddle_appeal_gateway_5xx_is_transient(direct_vm, direct_deploy, direct_alice, direct_bob):
    contract = _riddle_forfeit_provisional(direct_vm, direct_deploy, direct_alice, direct_bob, "RVIS5")
    direct_vm.sender = direct_bob
    contract.file_appeal("RVIS5", "Screenshot evidence attached for review.", CID)
    direct_vm.mock_web(GATEWAY, {"status": 503, "body": b"gateway down"})
    with direct_vm.expect_revert("TRANSIENT"):
        contract.judge_appeal("RVIS5")
