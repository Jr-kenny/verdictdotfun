ZERO_ADDRESS = "0x0000000000000000000000000000000000000000"


def test_quiz_room_resolution_flow(direct_vm, direct_deploy, direct_alice, direct_bob):
    contract = direct_deploy("contracts/quiz_game.py", ZERO_ADDRESS)

    direct_vm.sender = direct_alice
    contract.register_profile("Alice")
    contract.create_room(
        "ROOM04",
        "History",
        "Which city served as the first capital of Nigeria after independence, and why was it later replaced?",
    )
    contract.submit_entry(
        "ROOM04",
        "Lagos served as the capital after independence, but it was replaced because congestion and national planning pushed the seat of government toward Abuja.",
    )

    direct_vm.sender = direct_bob
    contract.register_profile("Bob")
    contract.join_room("ROOM04")
    contract.submit_entry(
        "ROOM04",
        "The first capital was Lagos, and Abuja replaced it later to give the country a more central, purpose-built federal capital.",
    )

    direct_vm.mock_llm(
        r".*Judge the answers by factual correctness.*",
        {
            "winner": "opponent",
            "owner_score": 84,
            "opponent_score": 91,
            "reasoning": "Bob answered the question more directly and explained the reason for the capital move more cleanly.",
        },
    )

    direct_vm.sender = direct_bob
    contract.resolve_room("ROOM04")

    room = contract.get_room("ROOM04")

    assert room.mode == "quiz"
    assert room.status == "resolved"
    assert room.owner_score == 84
    assert room.opponent_score == 91


def test_quiz_requires_meaningful_answers(direct_vm, direct_deploy, direct_alice):
    contract = direct_deploy("contracts/quiz_game.py", ZERO_ADDRESS)

    direct_vm.sender = direct_alice
    contract.register_profile("Alice")
    contract.create_room("ROOM05", "Science", "Why do eclipses happen?")

    with direct_vm.expect_revert("Quiz answers must be at least 8 characters."):
        contract.submit_entry("ROOM05", "Moon")
