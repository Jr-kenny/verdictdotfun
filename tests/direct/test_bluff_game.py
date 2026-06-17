ZERO_ADDRESS = "0x0000000000000000000000000000000000000000"


def test_bluff_deploys_and_registers_local_profile(direct_vm, direct_deploy, direct_alice):
    contract = direct_deploy("contracts/bluff_game.py", ZERO_ADDRESS)
    direct_vm.sender = direct_alice
    contract.register_profile("Alice")
    # No exception means the contract loaded and storage works.
    assert list(contract.get_room_ids()) == []


def test_bluff_create_and_join_room(direct_vm, direct_deploy, direct_alice, direct_bob):
    contract = direct_deploy("contracts/bluff_game.py", ZERO_ADDRESS)

    direct_vm.sender = direct_alice
    contract.register_profile("Alice")
    contract.create_room("ROOM01", "Tech", ZERO_ADDRESS, 0)

    direct_vm.sender = direct_bob
    contract.register_profile("Bob")
    contract.join_room("ROOM01")

    room = contract.get_room("ROOM01")
    assert room.mode == "bluff"
    assert room.owner_name == "Alice"
    assert room.opponent_name == "Bob"
    assert room.status == "ready_to_start"


def test_bluff_start_generates_claim(direct_vm, direct_deploy, direct_alice, direct_bob):
    contract = direct_deploy("contracts/bluff_game.py", ZERO_ADDRESS)

    direct_vm.mock_llm(
        r"(?s).*Generate one hard-to-defend claim.*Category: Tech.*ROOM01.*",
        {"claim": "Dial-up internet was strictly better than modern broadband for human focus."},
    )

    direct_vm.sender = direct_alice
    contract.register_profile("Alice")
    contract.create_room("ROOM01", "Tech", ZERO_ADDRESS, 0)
    direct_vm.sender = direct_bob
    contract.register_profile("Bob")
    contract.join_room("ROOM01")

    direct_vm.sender = direct_alice
    contract.start_room("ROOM01")

    room = contract.get_room("ROOM01")
    assert room.status == "active"
    assert "Dial-up" in room.claim


def test_bluff_submit_requires_start_and_stores(direct_vm, direct_deploy, direct_alice, direct_bob):
    contract = direct_deploy("contracts/bluff_game.py", ZERO_ADDRESS)
    direct_vm.mock_llm(r"(?s).*Generate one hard-to-defend claim.*",
                       {"claim": "Pineapple belongs on pizza and improves digestion measurably."})
    direct_vm.sender = direct_alice
    contract.register_profile("Alice")
    contract.create_room("ROOM01", "Food", ZERO_ADDRESS, 0)
    direct_vm.sender = direct_bob
    contract.register_profile("Bob")
    contract.join_room("ROOM01")

    direct_vm.sender = direct_alice
    contract.start_room("ROOM01")
    contract.submit_entry("ROOM01", "Pineapple's bromelain genuinely aids digestion, and the sweet-savory contrast is the point of the dish.")

    room = contract.get_room("ROOM01")
    assert room.owner_submission != ""
    assert room.status == "active"


def test_bluff_full_resolution_flow(direct_vm, direct_deploy, direct_alice, direct_bob):
    contract = direct_deploy("contracts/bluff_game.py", ZERO_ADDRESS)
    direct_vm.mock_llm(r"(?s).*Generate one hard-to-defend claim.*",
                       {"claim": "Cold showers are the single most underrated productivity tool."})
    direct_vm.sender = direct_alice
    contract.register_profile("Alice")
    contract.create_room("ROOM01", "Health", ZERO_ADDRESS, 0)
    direct_vm.sender = direct_bob
    contract.register_profile("Bob")
    contract.join_room("ROOM01")
    direct_vm.sender = direct_alice
    contract.start_room("ROOM01")
    contract.submit_entry("ROOM01", "Cold exposure spikes norepinephrine, which sharpens focus for hours; the discomfort is exactly the training stimulus.")

    direct_vm.mock_llm(
        r"(?s).*You are judging a BLUFF match.*Cold showers are the single most underrated.*",
        {"winner": "owner", "owner_score": 88, "opponent_score": 71,
         "reasoning": "Alice grounded the claim in a concrete mechanism and stayed on the persuasive task."},
    )
    direct_vm.sender = direct_bob
    contract.submit_entry("ROOM01", "Anyone can call a habit underrated; the bar is whether it beats sleep and caffeine, and cold showers plausibly do for many.")

    room = contract.get_room("ROOM01")
    assert room.status == "provisional"
    assert room.owner_score == 88
    assert room.winner != ZERO_ADDRESS


def test_bluff_finalize_after_zero_window(direct_vm, direct_deploy, direct_alice, direct_bob):
    contract = direct_deploy("contracts/bluff_game.py", ZERO_ADDRESS, False, 0)
    direct_vm.mock_llm(r"(?s).*Generate one hard-to-defend claim.*", {"claim": "Mondays are objectively the best day of the week for deep work."})
    direct_vm.sender = direct_alice
    contract.register_profile("Alice"); contract.create_room("R1", "Life", ZERO_ADDRESS, 0)
    direct_vm.sender = direct_bob
    contract.register_profile("Bob"); contract.join_room("R1")
    direct_vm.sender = direct_alice; contract.start_room("R1")
    contract.submit_entry("R1", "A fresh week means peak willpower and an empty calendar; Monday is when deep work compounds best of all.")
    direct_vm.mock_llm(r"(?s).*You are judging a BLUFF match.*",
                       {"winner": "owner", "owner_score": 80, "opponent_score": 70, "reasoning": "Owner was sharper."})
    direct_vm.sender = direct_bob
    contract.submit_entry("R1", "Monday carries the weekend's inertia; calling it best for focus ignores how most people actually feel and perform.")
    direct_vm.sender = direct_alice
    contract.finalize_room("R1")
    assert contract.get_room("R1").status == "resolved"


def _forfeit_provisional(direct_vm, direct_deploy, direct_alice, direct_bob, rid, window=3600):
    contract = direct_deploy("contracts/bluff_game.py", ZERO_ADDRESS, False, window)
    direct_vm.mock_llm(
        r"(?s).*Generate one hard-to-defend claim.*" + rid + r".*",
        {"claim": "Public libraries are the most underrated startup incubators in any city."},
    )
    direct_vm.sender = direct_alice
    contract.register_profile("Alice")
    contract.create_room(rid, "Life", ZERO_ADDRESS, 0)
    direct_vm.sender = direct_bob
    contract.register_profile("Bob")
    contract.join_room(rid)
    contract.forfeit_room(rid)  # Bob quits -> Alice provisional winner, Bob is loser
    return contract


def test_bluff_forfeit_resolves_the_other_player_as_winner(direct_vm, direct_deploy, direct_alice, direct_bob):
    contract = direct_deploy("contracts/bluff_game.py", ZERO_ADDRESS)
    direct_vm.mock_llm(r"(?s).*Generate one hard-to-defend claim.*ROOM10.*",
                       {"claim": "City governments should publish all zoning changes as plain language summaries first."})
    direct_vm.sender = direct_alice
    contract.register_profile("Alice")
    contract.create_room("ROOM10", "Life", ZERO_ADDRESS, 0)
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


def test_bluff_loser_can_file_one_appeal(direct_vm, direct_deploy, direct_alice, direct_bob):
    contract = _forfeit_provisional(direct_vm, direct_deploy, direct_alice, direct_bob, "APP01")
    direct_vm.sender = direct_bob  # provisional loser
    contract.file_appeal("APP01", "My wifi dropped mid-round; I did not intend to quit.")
    assert contract.get_room("APP01").appeal_state == "filed"
    with direct_vm.expect_revert("already been filed"):
        contract.file_appeal("APP01", "trying to appeal a second time")


def test_bluff_winner_cannot_appeal(direct_vm, direct_deploy, direct_alice, direct_bob):
    contract = _forfeit_provisional(direct_vm, direct_deploy, direct_alice, direct_bob, "APP02")
    direct_vm.sender = direct_alice  # provisional winner
    with direct_vm.expect_revert("losing player"):
        contract.file_appeal("APP02", "I deserve to win even more")


def test_bluff_appeal_upheld_resolves_to_winner(direct_vm, direct_deploy, direct_alice, direct_bob):
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


def test_bluff_appeal_overturned_voids_room(direct_vm, direct_deploy, direct_alice, direct_bob):
    contract = _forfeit_provisional(direct_vm, direct_deploy, direct_alice, direct_bob, "JUD02")
    direct_vm.sender = direct_bob
    contract.file_appeal("JUD02", "Verified regional network outage during the match window.")
    direct_vm.mock_llm(r"(?s).*APPEAL REVIEW.*",
                       {"decision": "overturned", "reasoning": "Genuine disconnect; void and refund."})
    contract.judge_appeal("JUD02")
    room = contract.get_room("JUD02")
    assert room.appeal_result == "overturned"
    assert room.status == "void"


def test_bluff_finalize_blocked_while_window_open(direct_vm, direct_deploy, direct_alice, direct_bob):
    contract = _forfeit_provisional(direct_vm, direct_deploy, direct_alice, direct_bob, "FIN01", window=3600)
    with direct_vm.expect_revert("Challenge window is still open"):
        contract.finalize_room("FIN01")


def test_bluff_finalize_after_window_resolves(direct_vm, direct_deploy, direct_alice, direct_bob):
    contract = _forfeit_provisional(direct_vm, direct_deploy, direct_alice, direct_bob, "FIN02", window=0)
    contract.finalize_room("FIN02")
    assert contract.get_room("FIN02").status == "resolved"


def test_bluff_finalize_blocked_when_appeal_pending(direct_vm, direct_deploy, direct_alice, direct_bob):
    contract = _forfeit_provisional(direct_vm, direct_deploy, direct_alice, direct_bob, "FIN03", window=3600)
    direct_vm.sender = direct_bob
    contract.file_appeal("FIN03", "Please review my disconnect before finalizing.")
    with direct_vm.expect_revert("Resolve the pending appeal"):
        contract.finalize_room("FIN03")


def test_bluff_appeal_rejected_after_window_closed(direct_vm, direct_deploy, direct_alice, direct_bob):
    contract = _forfeit_provisional(direct_vm, direct_deploy, direct_alice, direct_bob, "FIN04", window=0)
    direct_vm.sender = direct_bob
    with direct_vm.expect_revert("challenge window has closed"):
        contract.file_appeal("FIN04", "Too late to appeal once the window has shut.")


PNG_BYTES = b"\x89PNG\r\n\x1a\n" + b"\x00" * 96  # PNG magic + filler
GATEWAY = r"ipfs\.io/ipfs/"
CID = "bafybeigdyrztexamplecidexamplecidexamplecid000"


def test_bluff_file_appeal_stores_evidence_cid(direct_vm, direct_deploy, direct_alice, direct_bob):
    contract = _forfeit_provisional(direct_vm, direct_deploy, direct_alice, direct_bob, "EVID1")
    direct_vm.sender = direct_bob
    contract.file_appeal("EVID1", "My screen froze; screenshot attached as proof.", CID)
    room = contract.get_room("EVID1")
    assert room.appeal_state == "filed"
    assert room.evidence_uri == CID


def test_bluff_file_appeal_strips_ipfs_scheme(direct_vm, direct_deploy, direct_alice, direct_bob):
    contract = _forfeit_provisional(direct_vm, direct_deploy, direct_alice, direct_bob, "EVID2")
    direct_vm.sender = direct_bob
    contract.file_appeal("EVID2", "Proof of the disconnect is attached.", "ipfs://" + CID)
    assert contract.get_room("EVID2").evidence_uri == CID


def test_bluff_file_appeal_rejects_url_evidence(direct_vm, direct_deploy, direct_alice, direct_bob):
    contract = _forfeit_provisional(direct_vm, direct_deploy, direct_alice, direct_bob, "EVID3")
    direct_vm.sender = direct_bob
    with direct_vm.expect_revert("bare IPFS CID"):
        contract.file_appeal("EVID3", "Here is my evidence link.", "https://evil.example.com/x.png")


def test_bluff_text_only_appeal_leaves_evidence_empty(direct_vm, direct_deploy, direct_alice, direct_bob):
    contract = _forfeit_provisional(direct_vm, direct_deploy, direct_alice, direct_bob, "EVID4")
    direct_vm.sender = direct_bob
    contract.file_appeal("EVID4", "Plain text appeal with no screenshot.")
    assert contract.get_room("EVID4").evidence_uri == ""


def test_bluff_appeal_with_image_evidence_overturned(direct_vm, direct_deploy, direct_alice, direct_bob):
    contract = _forfeit_provisional(direct_vm, direct_deploy, direct_alice, direct_bob, "VIS1")
    direct_vm.sender = direct_bob
    contract.file_appeal("VIS1", "Screenshot shows the disconnect error dialog.", CID)
    direct_vm.mock_web(GATEWAY, {"status": 200, "body": PNG_BYTES})
    direct_vm.mock_llm(r"(?s).*APPEAL REVIEW.*",
                       {"decision": "overturned", "reasoning": "Screenshot confirms a genuine disconnect."})
    contract.judge_appeal("VIS1")
    room = contract.get_room("VIS1")
    assert room.appeal_result == "overturned"
    assert room.status == "void"


def test_bluff_appeal_prompt_notes_attached_evidence(direct_vm, direct_deploy, direct_alice, direct_bob):
    contract = _forfeit_provisional(direct_vm, direct_deploy, direct_alice, direct_bob, "VIS2")
    direct_vm.sender = direct_bob
    contract.file_appeal("VIS2", "See the attached screenshot of the crash.", CID)
    direct_vm.mock_web(GATEWAY, {"status": 200, "body": PNG_BYTES})
    direct_vm.mock_llm(r"(?s).*APPEAL REVIEW.*attached an image.*",
                       {"decision": "upheld", "reasoning": "Image does not support the claim."})
    contract.judge_appeal("VIS2")
    assert contract.get_room("VIS2").appeal_result == "upheld"


def test_bluff_appeal_non_image_evidence_dismisses_appeal(direct_vm, direct_deploy, direct_alice, direct_bob):
    contract = _forfeit_provisional(direct_vm, direct_deploy, direct_alice, direct_bob, "VIS3")
    direct_vm.sender = direct_bob
    contract.file_appeal("VIS3", "Attached file is my evidence of the fault.", CID)
    direct_vm.mock_web(GATEWAY, {"status": 200, "body": b"this is plain text, not an image"})
    contract.judge_appeal("VIS3")  # no LLM mock needed: dismissed before the prompt runs
    room = contract.get_room("VIS3")
    assert room.appeal_result == "upheld"
    assert room.status == "resolved"


def test_bluff_appeal_gateway_5xx_is_transient(direct_vm, direct_deploy, direct_alice, direct_bob):
    contract = _forfeit_provisional(direct_vm, direct_deploy, direct_alice, direct_bob, "VIS5")
    direct_vm.sender = direct_bob
    contract.file_appeal("VIS5", "Screenshot evidence attached for review.", CID)
    direct_vm.mock_web(GATEWAY, {"status": 503, "body": b"gateway down"})
    with direct_vm.expect_revert("TRANSIENT"):
        contract.judge_appeal("VIS5")
