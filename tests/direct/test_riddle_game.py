ZERO_ADDRESS = "0x0000000000000000000000000000000000000000"


def _mock_riddle_pack(direct_vm, room_id: str, category: str = "Tech"):
    direct_vm.mock_llm(
        rf"(?s).*Generate a five-round riddle pack.*Category: {category}.*{room_id}.*",
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
                {
                    "prompt": "I sit beside a monitor, translate hand movement into pointer motion, and usually click twice. What am I?",
                    "answer": "computer mouse",
                    "aliases": ["mouse"],
                },
                {
                    "prompt": "I print ink onto paper in homes and offices, but I am not a photocopier. What am I?",
                    "answer": "printer",
                    "aliases": ["inkjet printer", "laser printer"],
                },
            ]
        },
    )


def test_riddle_match_runs_for_five_rounds_and_first_to_three_wins(direct_vm, direct_deploy, direct_alice, direct_bob):
    contract = direct_deploy("contracts/riddle_game.py", ZERO_ADDRESS)
    _mock_riddle_pack(direct_vm, "ROOM06")

    direct_vm.sender = direct_alice
    contract.register_profile("Alice")
    contract.create_room("ROOM06", "Tech")

    room = contract.get_room("ROOM06")
    assert room.question_count == 5
    assert room.current_question_index == 1

    direct_vm.sender = direct_bob
    contract.register_profile("Bob")
    contract.join_room("ROOM06")

    direct_vm.sender = direct_alice
    contract.submit_entry("ROOM06", "smartphone")
    direct_vm.sender = direct_bob
    contract.submit_entry("ROOM06", "tablet")

    room = contract.get_room("ROOM06")
    assert room.owner_score == 1
    assert room.current_question_index == 2
    assert room.prompt.startswith("I hold hot drinks")

    direct_vm.sender = direct_alice
    contract.submit_entry("ROOM06", "mug")
    direct_vm.sender = direct_bob
    contract.submit_entry("ROOM06", "cup")

    room = contract.get_room("ROOM06")
    assert room.owner_score == 1
    assert room.opponent_score == 0
    assert room.current_question_index == 3
    assert room.revealed_answer == "thermos"

    direct_vm.sender = direct_alice
    contract.submit_entry("ROOM06", "ceiling fan")
    direct_vm.sender = direct_bob
    contract.submit_entry("ROOM06", "fan")

    room = contract.get_room("ROOM06")
    assert room.owner_score == 2
    assert room.opponent_score == 0
    assert room.current_question_index == 4

    direct_vm.sender = direct_alice
    contract.submit_entry("ROOM06", "keyboard")
    direct_vm.sender = direct_bob
    contract.submit_entry("ROOM06", "mouse")

    room = contract.get_room("ROOM06")
    assert room.owner_score == 2
    assert room.opponent_score == 1
    assert room.current_question_index == 5

    direct_vm.sender = direct_alice
    contract.submit_entry("ROOM06", "printer")
    direct_vm.sender = direct_bob
    contract.submit_entry("ROOM06", "scanner")

    resolved = contract.get_room("ROOM06")
    assert resolved.status == "resolved"
    assert resolved.winner == resolved.owner
    assert resolved.owner_score == 3
    assert resolved.opponent_score == 1
    assert "solved three riddles first" in resolved.verdict_reasoning


def test_riddle_pack_generation_uses_the_selected_category(direct_vm, direct_deploy, direct_alice):
    contract = direct_deploy("contracts/riddle_game.py", ZERO_ADDRESS)
    _mock_riddle_pack(direct_vm, "ROOM07", "Nature")

    direct_vm.sender = direct_alice
    contract.register_profile("Alice")
    contract.create_room("ROOM07", "Nature")

    room = contract.get_room("ROOM07")
    assert room.prompt
    assert room.category == "Nature"
    assert room.question_count == 5


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
    assert room.status == "resolved"
    assert room.winner == room.owner
    assert "wins by forfeit" in room.verdict_reasoning
