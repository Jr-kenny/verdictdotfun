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
