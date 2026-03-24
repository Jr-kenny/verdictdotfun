ZERO_ADDRESS = "0x0000000000000000000000000000000000000000"


def test_convince_me_room_resolution_flow(direct_vm, direct_deploy, direct_alice, direct_bob):
    contract = direct_deploy("contracts/convince_me_game.py", ZERO_ADDRESS, "WhatsApp is bad.")

    direct_vm.sender = direct_alice
    contract.register_profile("Alice")
    contract.create_room(
        "ROOM03",
        "Social",
        "Convince the judge that WhatsApp is still the best default messaging tool for family groups.",
    )
    contract.submit_entry(
        "ROOM03",
        "WhatsApp wins on reach and habit, so the best product is the one your relatives will actually open and use every day.",
    )

    direct_vm.sender = direct_bob
    contract.register_profile("Bob")
    contract.join_room("ROOM03")
    contract.submit_entry(
        "ROOM03",
        "Its low-friction onboarding and voice note culture make it uniquely effective for families that would ignore more polished apps.",
    )

    direct_vm.mock_llm(
        r".*ConvinceMeGame room.*",
        {
            "winner": "opponent",
            "owner_score": 81,
            "opponent_score": 89,
            "reasoning": "Bob made the stronger emotional and practical case for why people actually keep choosing WhatsApp.",
        },
    )

    direct_vm.sender = direct_alice
    contract.resolve_room("ROOM03")

    room = contract.get_room("ROOM03")

    assert room.mode == "convince"
    assert room.status == "resolved"
    assert room.house_stance == "WhatsApp is bad."
    assert room.owner_score == 81
    assert room.opponent_score == 89


def test_convince_me_uses_configured_house_stance(direct_vm, direct_deploy):
    contract = direct_deploy("contracts/convince_me_game.py", ZERO_ADDRESS, "Email is better than chat.")

    assert contract.get_house_stance() == "Email is better than chat."
