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
    contract.resolve_room("ROOM01")

    room = contract.get_room("ROOM01")
    assert room.mode == "argue"
    assert room.argue_style == "debate"
    assert room.status == "resolved"
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
    contract.resolve_room("ROOM03")

    room = contract.get_room("ROOM03")
    assert room.mode == "argue"
    assert room.argue_style == "convince"
    assert room.status == "resolved"
    assert room.house_stance.startswith("Small venues are emotionally appealing")


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
    assert room.status == "resolved"
    assert room.winner == room.owner
    assert room.owner_score == 100
    assert room.opponent_score == 0
