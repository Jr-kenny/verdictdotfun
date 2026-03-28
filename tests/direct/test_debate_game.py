ZERO_ADDRESS = "0x0000000000000000000000000000000000000000"


def test_debate_room_and_resolution_flow(direct_vm, direct_deploy, direct_alice, direct_bob):
    contract = direct_deploy("contracts/debate_game.py", ZERO_ADDRESS)

    direct_vm.mock_llm(
        r"(?s).*Generate one sharp debate motion.*Category: Tech.*ROOM01.*",
        {
            "prompt": "Cities should ban private cars from the busiest downtown districts within the next decade.",
        },
    )

    direct_vm.sender = direct_alice
    contract.register_profile("Alice")
    contract.create_room("ROOM01", "Tech")
    contract.submit_entry(
        "ROOM01",
        "Downtown car bans free up land, improve air quality, and push cities to invest in better transit rather than subsidizing congestion forever.",
    )

    direct_vm.mock_llm(
        r"(?s).*You are judging a DebateGame room.*Cities should ban private cars.*",
        {
            "winner": "owner",
            "owner_score": 90,
            "opponent_score": 83,
            "reasoning": "Alice built the cleaner case and engaged the tradeoffs more directly than Bob.",
        },
    )

    direct_vm.sender = direct_bob
    contract.register_profile("Bob")
    contract.join_room("ROOM01")
    contract.submit_entry(
        "ROOM01",
        "Blanket bans punish workers and small businesses before transit quality is good enough to absorb the demand those restrictions would create.",
    )

    room = contract.get_room("ROOM01")

    assert room.mode == "debate"
    assert room.status == "resolved"
    assert room.owner_name == "Alice"
    assert room.opponent_name == "Bob"
    assert room.prompt == "Cities should ban private cars from the busiest downtown districts within the next decade."
    assert room.owner_score == 90
    assert room.opponent_score == 83


def test_debate_requires_local_profile_when_factory_is_not_configured(direct_vm, direct_deploy, direct_alice):
    contract = direct_deploy("contracts/debate_game.py", ZERO_ADDRESS)

    direct_vm.mock_llm(
        r"(?s).*Generate one sharp debate motion.*ROOM02.*",
        {
            "prompt": "Public universities should make at least one year of civic service a graduation requirement.",
        },
    )

    direct_vm.sender = direct_alice

    with direct_vm.expect_revert("Create a local profile before interacting with the debate game."):
        contract.create_room("ROOM02", "Tech")


def test_debate_prevents_submission_overwrite(direct_vm, direct_deploy, direct_alice):
    contract = direct_deploy("contracts/debate_game.py", ZERO_ADDRESS)

    direct_vm.mock_llm(
        r"(?s).*Generate one sharp debate motion.*ROOM08.*",
        {
            "prompt": "Open protocol standards create more long-term value than closed consumer platforms.",
        },
    )

    direct_vm.sender = direct_alice
    contract.register_profile("Alice")
    contract.create_room("ROOM08", "Tech")
    contract.submit_entry(
        "ROOM08",
        "Open standards compound because more builders can extend them, critique them, and improve them without waiting on one gatekeeper.",
    )

    with direct_vm.expect_revert("You already submitted your debate case."):
        contract.submit_entry(
            "ROOM08",
            "Trying to replace the first submission after seeing more context should not be allowed.",
        )


def test_debate_forfeit_resolves_the_other_player_as_winner(direct_vm, direct_deploy, direct_alice, direct_bob):
    contract = direct_deploy("contracts/debate_game.py", ZERO_ADDRESS)

    direct_vm.mock_llm(
        r"(?s).*Generate one sharp debate motion.*ROOM10.*",
        {
            "prompt": "Autonomous delivery drones should replace most urban courier services within the next decade.",
        },
    )

    direct_vm.sender = direct_alice
    contract.register_profile("Alice")
    contract.create_room("ROOM10", "Tech")

    direct_vm.sender = direct_bob
    contract.register_profile("Bob")
    contract.join_room("ROOM10")
    contract.forfeit_room("ROOM10")

    room = contract.get_room("ROOM10")
    assert room.status == "resolved"
    assert room.winner == room.owner
    assert room.owner_score == 100
    assert room.opponent_score == 0
