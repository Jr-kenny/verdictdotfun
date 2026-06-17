ZERO_ADDRESS = "0x0000000000000000000000000000000000000000"


def test_prompt_duel_full_resolution_flow(direct_vm, direct_deploy, direct_alice, direct_bob):
    contract = direct_deploy("contracts/prompt_duel_game.py", ZERO_ADDRESS)

    direct_vm.mock_llm(
        r"(?s).*Generate one target OUTPUT.*Category: Poetry.*ROOM01.*",
        {"target": "A short four-line poem about the sea at dawn, gentle and hopeful, with an ABAB rhyme."},
    )

    direct_vm.sender = direct_alice
    contract.register_profile("Alice")
    contract.create_room("ROOM01", "Poetry", ZERO_ADDRESS, 0)
    direct_vm.sender = direct_bob
    contract.register_profile("Bob")
    contract.join_room("ROOM01")
    direct_vm.sender = direct_alice
    contract.start_room("ROOM01")
    contract.submit_entry("ROOM01", "Write a four-line ABAB poem about the sea at dawn, gentle and hopeful.")

    direct_vm.mock_llm(
        r"(?s).*You are judging a PROMPT DUEL.*A short four-line poem about the sea at dawn.*",
        {"winner": "owner", "owner_score": 92, "opponent_score": 64,
         "reasoning": "Alice's prompt specifies form, subject, and tone, so its output lands closest to the target."},
    )
    direct_vm.sender = direct_bob
    contract.submit_entry("ROOM01", "write a poem about the ocean")

    room = contract.get_room("ROOM01")
    assert room.status == "provisional"
    assert room.target != ""
    assert room.owner_score == 92
    assert room.winner != ZERO_ADDRESS
