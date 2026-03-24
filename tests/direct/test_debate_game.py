ZERO_ADDRESS = "0x0000000000000000000000000000000000000000"


def test_debate_room_and_resolution_flow(direct_vm, direct_deploy, direct_alice, direct_bob):
    contract = direct_deploy("contracts/debate_game.py", ZERO_ADDRESS)

    direct_vm.sender = direct_alice
    contract.register_profile("Alice")
    contract.create_room(
        "ROOM01",
        "Tech",
        "AI copilots should draft the opening pass for most engineering documents.",
    )
    contract.submit_entry(
        "ROOM01",
        "A first-pass copilot accelerates teams when humans still own review, challenge assumptions, and keep the final call.",
    )

    direct_vm.sender = direct_bob
    contract.register_profile("Bob")
    contract.join_room("ROOM01")
    contract.submit_entry(
        "ROOM01",
        "The first draft sets the frame for every later decision, so outsourcing it weakens design intent before real thinking begins.",
    )

    direct_vm.mock_llm(
        r".*The owner is the proposer.*",
        {
            "winner": "owner",
            "owner_score": 90,
            "opponent_score": 83,
            "reasoning": "Alice built the cleaner case and engaged the tradeoffs more directly than Bob.",
        },
    )

    direct_vm.sender = direct_alice
    contract.resolve_room("ROOM01")

    room = contract.get_room("ROOM01")

    assert room.mode == "debate"
    assert room.status == "resolved"
    assert room.owner_name == "Alice"
    assert room.opponent_name == "Bob"
    assert room.owner_score == 90
    assert room.opponent_score == 83


def test_debate_requires_local_profile_when_nft_is_not_configured(direct_vm, direct_deploy, direct_alice):
    contract = direct_deploy("contracts/debate_game.py", ZERO_ADDRESS)

    direct_vm.sender = direct_alice

    with direct_vm.expect_revert("Create a local profile before interacting with the debate game."):
        contract.create_room(
            "ROOM02",
            "Tech",
            "Protocol-native AI judges are better than off-chain moderation.",
        )
