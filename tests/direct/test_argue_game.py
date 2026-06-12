ZERO_ADDRESS = "0x0000000000000000000000000000000000000000"


def test_argue_debate_room_and_resolution_flow(direct_vm, direct_deploy, direct_alice, direct_bob):
    contract = direct_deploy("contracts/argue_game.py", ZERO_ADDRESS)

    direct_vm.mock_llm(
        r"(?s).*Generate one sharp debate motion.*Category: Tech.*ROOM01.*",
        {
            "prompt": "Cities should ban private cars from the busiest downtown districts within the next decade.",
        },
    )

    direct_vm.sender = direct_alice
    contract.register_profile("Alice")
    contract.create_room("ROOM01", "Tech", ZERO_ADDRESS, "debate")

    direct_vm.sender = direct_bob
    contract.register_profile("Bob")
    contract.join_room("ROOM01")

    direct_vm.sender = direct_alice
    contract.start_room("ROOM01")
    contract.submit_entry(
        "ROOM01",
        "Downtown car bans free up land, improve air quality, and push cities to invest in better transit rather than subsidizing congestion forever.",
    )

    direct_vm.mock_llm(
        r"(?s).*This room uses the debate style.*Cities should ban private cars.*",
        {
            "winner": "owner",
            "owner_score": 90,
            "opponent_score": 83,
            "reasoning": "Alice built the cleaner case and engaged the tradeoffs more directly than Bob.",
        },
    )

    direct_vm.sender = direct_bob
    contract.submit_entry(
        "ROOM01",
        "Blanket bans punish workers and small businesses before transit quality is good enough to absorb the demand those restrictions would create.",
    )

    room = contract.get_room("ROOM01")
    assert room.mode == "argue"
    assert room.argue_style == "debate"
    assert room.status == "provisional"
    assert room.owner_score == 90
    assert room.opponent_score == 83


def test_argue_convince_room_resolution_flow(direct_vm, direct_deploy, direct_alice, direct_bob):
    contract = direct_deploy("contracts/argue_game.py", ZERO_ADDRESS)

    direct_vm.mock_llm(
        r'(?s).*Generate a "Convince Me" challenge.*Category: Culture.*ROOM03.*',
        {
            "prompt": "Convince the contract that local music venues deserve direct city support during redevelopment projects.",
            "house_stance": "Small venues are emotionally appealing, but cities should not spend scarce money propping them up when housing and transit are under pressure.",
        },
    )

    direct_vm.sender = direct_alice
    contract.register_profile("Alice")
    contract.create_room("ROOM03", "Culture", ZERO_ADDRESS, "convince")

    direct_vm.sender = direct_bob
    contract.register_profile("Bob")
    contract.join_room("ROOM03")

    direct_vm.sender = direct_alice
    contract.start_room("ROOM03")
    contract.submit_entry(
        "ROOM03",
        "Losing local venues destroys the talent pipeline and the social fabric that makes districts worth living in after redevelopment is complete.",
    )

    direct_vm.mock_llm(
        r"(?s).*This room uses the convince style.*local music venues deserve direct city support.*",
        {
            "winner": "opponent",
            "owner_score": 81,
            "opponent_score": 88,
            "reasoning": "Bob gave the more complete case for why public support protects long-term district value.",
        },
    )

    direct_vm.sender = direct_bob
    contract.submit_entry(
        "ROOM03",
        "Targeted venue support is cheaper than rebuilding cultural identity later, and it protects the small businesses that keep districts active at night.",
    )

    room = contract.get_room("ROOM03")
    assert room.mode == "argue"
    assert room.argue_style == "convince"
    assert room.status == "provisional"
    assert room.house_stance.startswith("Small venues are emotionally appealing")


def test_argue_second_submission_auto_resolves_the_room(direct_vm, direct_deploy, direct_alice, direct_bob):
    contract = direct_deploy("contracts/argue_game.py", ZERO_ADDRESS)

    direct_vm.mock_llm(
        r"(?s).*Generate one sharp debate motion.*ROOM04.*",
        {
            "prompt": "Cities should replace minimum parking requirements with congestion pricing in their busiest districts.",
        },
    )

    direct_vm.sender = direct_alice
    contract.register_profile("Alice")
    contract.create_room("ROOM04", "Tech", ZERO_ADDRESS, "debate")

    direct_vm.sender = direct_bob
    contract.register_profile("Bob")
    contract.join_room("ROOM04")

    direct_vm.sender = direct_alice
    contract.start_room("ROOM04")
    contract.submit_entry(
        "ROOM04",
        "Parking mandates subsidize car storage, while congestion pricing directly targets peak road demand and funds better transit service.",
    )

    direct_vm.mock_llm(
        r"(?s).*This room uses the debate style.*minimum parking requirements.*",
        {
            "winner": "opponent",
            "owner_score": 84,
            "opponent_score": 91,
            "reasoning": "Bob did the better job connecting street design, pricing, and political feasibility into one coherent case.",
        },
    )

    direct_vm.sender = direct_bob
    contract.submit_entry(
        "ROOM04",
        "Congestion pricing is easier to tune over time, and ending parking mandates removes a hidden subsidy that keeps streets less productive.",
    )

    room = contract.get_room("ROOM04")
    assert room.status == "provisional"
    assert room.winner == room.opponent
    assert room.owner_score == 84
    assert room.opponent_score == 91


def test_argue_requires_local_profile_when_factory_is_not_configured(direct_vm, direct_deploy, direct_alice):
    contract = direct_deploy("contracts/argue_game.py", ZERO_ADDRESS)

    direct_vm.mock_llm(
        r"(?s).*Generate one sharp debate motion.*ROOM02.*",
        {
            "prompt": "Public universities should make at least one year of civic service a graduation requirement.",
        },
    )

    direct_vm.sender = direct_alice
    with direct_vm.expect_revert("Create a local profile before interacting with the argue game."):
        contract.create_room("ROOM02", "Tech", ZERO_ADDRESS, "debate")


def test_argue_prevents_submission_overwrite(direct_vm, direct_deploy, direct_alice, direct_bob):
    contract = direct_deploy("contracts/argue_game.py", ZERO_ADDRESS)

    direct_vm.mock_llm(
        r"(?s).*Generate one sharp debate motion.*ROOM08.*",
        {
            "prompt": "Open protocol standards create more long-term value than closed consumer platforms.",
        },
    )

    direct_vm.sender = direct_alice
    contract.register_profile("Alice")
    contract.create_room("ROOM08", "Tech", ZERO_ADDRESS, "debate")

    direct_vm.sender = direct_bob
    contract.register_profile("Bob")
    contract.join_room("ROOM08")

    direct_vm.sender = direct_alice
    contract.start_room("ROOM08")
    contract.submit_entry(
        "ROOM08",
        "Open standards compound because more builders can extend them, critique them, and improve them without waiting on one gatekeeper.",
    )

    with direct_vm.expect_revert("You already submitted your argument."):
        contract.submit_entry("ROOM08", "Trying to replace the first submission after seeing more context should not be allowed.")


def test_argue_forfeit_resolves_the_other_player_as_winner(direct_vm, direct_deploy, direct_alice, direct_bob):
    contract = direct_deploy("contracts/argue_game.py", ZERO_ADDRESS)

    direct_vm.mock_llm(
        r'(?s).*Generate a "Convince Me" challenge.*ROOM10.*',
        {
            "prompt": "Convince the contract that city governments should publish all zoning changes in plain language summaries.",
            "house_stance": "Plain language summaries are nice to have, but lawyers and planners already have the formal notices they need.",
        },
    )

    direct_vm.sender = direct_alice
    contract.register_profile("Alice")
    contract.create_room("ROOM10", "Culture", ZERO_ADDRESS, "convince")

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


# ---- two-phase settlement + appeals (Plan 1C) ----
def _forfeit_provisional(direct_vm, direct_deploy, direct_alice, direct_bob, rid, window=3600):
    contract = direct_deploy("contracts/argue_game.py", ZERO_ADDRESS, False, window)
    direct_vm.mock_llm(
        r'(?s).*Generate a "Convince Me" challenge.*' + rid + r".*",
        {"prompt": "Convince the contract that public libraries deserve protected funding.",
         "house_stance": "Libraries are pleasant but optional when budgets are tight."},
    )
    direct_vm.sender = direct_alice
    contract.register_profile("Alice")
    contract.create_room(rid, "Culture", ZERO_ADDRESS, "convince", 0)
    direct_vm.sender = direct_bob
    contract.register_profile("Bob")
    contract.join_room(rid)
    contract.forfeit_room(rid)  # Bob quits -> Alice provisional winner, Bob is loser
    return contract


def test_loser_can_file_one_appeal(direct_vm, direct_deploy, direct_alice, direct_bob):
    contract = _forfeit_provisional(direct_vm, direct_deploy, direct_alice, direct_bob, "APP01")
    direct_vm.sender = direct_bob  # provisional loser
    contract.file_appeal("APP01", "My wifi dropped mid-round; I did not intend to quit.")
    assert contract.get_room("APP01").appeal_state == "filed"
    with direct_vm.expect_revert("already been filed"):
        contract.file_appeal("APP01", "trying to appeal a second time")


def test_winner_cannot_appeal(direct_vm, direct_deploy, direct_alice, direct_bob):
    contract = _forfeit_provisional(direct_vm, direct_deploy, direct_alice, direct_bob, "APP02")
    direct_vm.sender = direct_alice  # provisional winner
    with direct_vm.expect_revert("losing player"):
        contract.file_appeal("APP02", "I deserve to win even more")


def test_appeal_upheld_resolves_to_winner(direct_vm, direct_deploy, direct_alice, direct_bob):
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


def test_appeal_overturned_voids_room(direct_vm, direct_deploy, direct_alice, direct_bob):
    contract = _forfeit_provisional(direct_vm, direct_deploy, direct_alice, direct_bob, "JUD02")
    direct_vm.sender = direct_bob
    contract.file_appeal("JUD02", "Verified regional network outage during the match window.")
    direct_vm.mock_llm(r"(?s).*APPEAL REVIEW.*",
                       {"decision": "overturned", "reasoning": "Genuine disconnect; void and refund."})
    contract.judge_appeal("JUD02")
    room = contract.get_room("JUD02")
    assert room.appeal_result == "overturned"
    assert room.status == "void"


def test_finalize_blocked_while_window_open(direct_vm, direct_deploy, direct_alice, direct_bob):
    # default 3600s window; clock is frozen at provisional time, so elapsed ~ 0 < window
    contract = _forfeit_provisional(direct_vm, direct_deploy, direct_alice, direct_bob, "FIN01", window=3600)
    with direct_vm.expect_revert("Challenge window is still open"):
        contract.finalize_room("FIN01")


def test_finalize_after_window_resolves(direct_vm, direct_deploy, direct_alice, direct_bob):
    # zero-length window: finalize is immediately allowed
    contract = _forfeit_provisional(direct_vm, direct_deploy, direct_alice, direct_bob, "FIN02", window=0)
    contract.finalize_room("FIN02")
    assert contract.get_room("FIN02").status == "resolved"


def test_finalize_blocked_when_appeal_pending(direct_vm, direct_deploy, direct_alice, direct_bob):
    # non-zero window so the appeal can be filed; finalize's appeal-pending guard fires first
    contract = _forfeit_provisional(direct_vm, direct_deploy, direct_alice, direct_bob, "FIN03", window=3600)
    direct_vm.sender = direct_bob
    contract.file_appeal("FIN03", "Please review my disconnect before finalizing.")
    with direct_vm.expect_revert("Resolve the pending appeal"):
        contract.finalize_room("FIN03")


def test_appeal_rejected_after_window_closed(direct_vm, direct_deploy, direct_alice, direct_bob):
    # zero-length window: the challenge window is already closed
    contract = _forfeit_provisional(direct_vm, direct_deploy, direct_alice, direct_bob, "FIN04", window=0)
    direct_vm.sender = direct_bob
    with direct_vm.expect_revert("challenge window has closed"):
        contract.file_appeal("FIN04", "Too late to appeal once the window has shut.")
