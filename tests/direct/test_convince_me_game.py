ZERO_ADDRESS = "0x0000000000000000000000000000000000000000"


def test_convince_me_room_resolution_flow(direct_vm, direct_deploy, direct_alice, direct_bob):
    contract = direct_deploy("contracts/convince_me_game.py", ZERO_ADDRESS)

    direct_vm.mock_llm(
        r'(?s).*Generate a "Convince Me" challenge.*Category: Culture.*ROOM03.*',
        {
            "prompt": "Convince the contract that local music venues deserve direct city support during redevelopment projects.",
            "house_stance": "Small venues are emotionally appealing, but cities should not spend scarce money propping them up when housing and transit are under pressure.",
        },
    )

    direct_vm.sender = direct_alice
    contract.register_profile("Alice")
    contract.create_room("ROOM03", "Culture")
    contract.submit_entry(
        "ROOM03",
        "Losing local venues destroys the talent pipeline and the social fabric that makes districts worth living in after redevelopment is complete.",
    )

    direct_vm.mock_llm(
        r"(?s).*You are judging a ConvinceMeGame room.*local music venues deserve direct city support.*",
        {
            "winner": "opponent",
            "owner_score": 81,
            "opponent_score": 88,
            "reasoning": "Bob gave the more complete case for why public support protects long-term district value.",
        },
    )

    direct_vm.sender = direct_bob
    contract.register_profile("Bob")
    contract.join_room("ROOM03")
    contract.submit_entry(
        "ROOM03",
        "Targeted venue support is cheaper than rebuilding cultural identity later, and it protects the small businesses that keep districts active at night.",
    )

    room = contract.get_room("ROOM03")
    assert room.status == "resolved"
    assert room.owner_name == "Alice"
    assert room.opponent_name == "Bob"
    assert room.owner_score == 81
    assert room.opponent_score == 88


def test_convince_me_generates_room_specific_materials(direct_vm, direct_deploy, direct_alice):
    contract = direct_deploy("contracts/convince_me_game.py", ZERO_ADDRESS)

    direct_vm.mock_llm(
        r'(?s).*Generate a "Convince Me" challenge.*ROOM10.*',
        {
            "prompt": "Convince the contract that rivers inside major cities should get personhood status.",
            "house_stance": "Granting personhood to rivers sounds symbolic and vague compared with enforceable environmental rules.",
        },
    )
    direct_vm.mock_llm(
        r'(?s).*Generate a "Convince Me" challenge.*ROOM11.*',
        {
            "prompt": "Convince the contract that city governments should publish all zoning changes in plain language summaries.",
            "house_stance": "Plain language summaries are nice to have, but lawyers and planners already have the formal notices they need.",
        },
    )

    direct_vm.sender = direct_alice
    contract.register_profile("Alice")
    contract.create_room("ROOM10", "Culture")
    contract.create_room("ROOM11", "Culture")

    room_one = contract.get_room("ROOM10")
    room_two = contract.get_room("ROOM11")

    assert room_one.prompt != room_two.prompt
    assert room_one.house_stance != room_two.house_stance


def test_convince_me_prevents_submission_overwrite(direct_vm, direct_deploy, direct_alice):
    contract = direct_deploy("contracts/convince_me_game.py", ZERO_ADDRESS)

    direct_vm.mock_llm(
        r'(?s).*Generate a "Convince Me" challenge.*ROOM12.*',
        {
            "prompt": "Convince the contract that public libraries should lend creative software access the same way they lend books.",
            "house_stance": "Libraries should focus on reading and study access rather than becoming subsidized software providers.",
        },
    )

    direct_vm.sender = direct_alice
    contract.register_profile("Alice")
    contract.create_room("ROOM12", "Culture")
    contract.submit_entry(
        "ROOM12",
        "Shared software access extends the library mission by lowering creative barriers for students and job seekers who cannot afford subscriptions.",
    )

    with direct_vm.expect_revert("You already submitted your persuasion case."):
        contract.submit_entry(
            "ROOM12",
            "Replacing the original persuasion case should not be allowed.",
        )
