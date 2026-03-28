ZERO_ADDRESS = "0x0000000000000000000000000000000000000000"


def _mock_quiz_pack(direct_vm, room_id: str):
    direct_vm.mock_llm(
        rf"(?s).*Generate a competitive head-to-head quiz pack for two players.*{room_id}.*",
        {
            "topic_title": "Machinery Systems Primer",
            "topic_summary": "A focused study note on how major industrial and transport machines convert power into controlled mechanical work.",
            "material_body": (
                "Machinery turns stored or supplied energy into controlled motion, force, and repeatable output. "
                "Simple machines such as levers, pulleys, wedges, screws, wheels, and inclined planes change how force is applied, "
                "but modern machinery combines those principles with engines, motors, bearings, shafts, and gear trains. "
                "A gearbox changes torque and speed by pairing gears with different tooth counts. Larger driven gears increase torque "
                "but lower rotational speed, while smaller driven gears do the opposite. Bearings reduce friction where rotating parts "
                "meet stationary supports, and lubrication protects surfaces from heat and wear. Hydraulic systems move force through "
                "pressurized fluid, so excavators and presses can multiply force with controlled precision. Pneumatic systems use compressed "
                "air, which reacts faster and stays cleaner but usually delivers less force than hydraulics. A flywheel stores rotational "
                "energy, smoothing power delivery in engines and industrial machines. A lathe spins the workpiece while a cutting tool shapes "
                "it, whereas a milling machine rotates the cutting tool itself. Steam engines historically used heat to turn water into high-pressure "
                "steam that pushed pistons, and modern electric motors now dominate many machines because they convert electrical energy into "
                "mechanical rotation efficiently. Maintenance matters because misalignment, overheating, contamination, and poor lubrication "
                "rapidly reduce accuracy and machine life."
            ),
            "questions": [
                {
                    "question": "Which machine component is primarily used to reduce friction between a rotating shaft and its support structure?",
                    "options": ["Bearing", "Crankcase", "Boiler shell", "Fuel injector", "Spark plug"],
                    "correct_option_index": 0,
                },
                {
                    "question": "When a larger driven gear is paired with a smaller driving gear, what is the main output change at the driven side?",
                    "options": [
                        "Torque increases while speed decreases",
                        "Torque decreases while speed increases",
                        "Voltage increases across the shaft",
                        "Lubrication becomes unnecessary",
                        "Compression ratio doubles automatically",
                    ],
                    "correct_option_index": 0,
                },
                {
                    "question": "Which kind of system usually delivers greater force for heavy equipment like excavators and presses?",
                    "options": ["Hydraulic system", "Pneumatic system", "Optical relay system", "Passive cooling loop", "Vacuum regulator only"],
                    "correct_option_index": 0,
                },
                {
                    "question": "What does a flywheel mainly do inside a machine or engine system?",
                    "options": [
                        "Stores rotational energy and smooths power delivery",
                        "Measures bearing temperature remotely",
                        "Separates compressed air from fuel",
                        "Locks the gearbox into neutral",
                        "Turns hydraulic fluid into steam",
                    ],
                    "correct_option_index": 0,
                },
                {
                    "question": "In a lathe, which part of the cutting process normally rotates during shaping?",
                    "options": ["The workpiece", "The coolant line", "The measuring caliper", "The machine foundation", "The safety guard only"],
                    "correct_option_index": 0,
                },
                {
                    "question": "Compared with hydraulics, pneumatic systems are usually described as having which tradeoff?",
                    "options": [
                        "Cleaner and faster response, but less force",
                        "Higher force and lower maintenance always",
                        "No need for seals or valves",
                        "Better torque than any gearbox",
                        "Permanent energy storage without losses",
                    ],
                    "correct_option_index": 0,
                },
                {
                    "question": "Why is lubrication critical inside machinery with moving surfaces?",
                    "options": [
                        "It reduces heat and wear between contacting parts",
                        "It raises the boiling point of air in pipes",
                        "It replaces bearings in all heavy machines",
                        "It increases electrical voltage at the motor",
                        "It eliminates alignment requirements completely",
                    ],
                    "correct_option_index": 0,
                },
                {
                    "question": "What energy conversion is performed by an electric motor in most industrial machines?",
                    "options": [
                        "Electrical energy into mechanical rotation",
                        "Mechanical rotation into nuclear energy",
                        "Hydraulic pressure into magnetic storage",
                        "Thermal radiation into lubrication flow",
                        "Steam pressure into chemical fuel",
                    ],
                    "correct_option_index": 0,
                },
                {
                    "question": "Which historical machine converted heated water into pressure that pushed pistons to do work?",
                    "options": ["Steam engine", "Wind tunnel", "Planetary gearbox", "Linear bearing", "Cooling manifold"],
                    "correct_option_index": 0,
                },
                {
                    "question": "Which issue is most directly associated with shortened machine life when maintenance is neglected?",
                    "options": [
                        "Misalignment, overheating, and contamination",
                        "Automatic torque balancing in bearings",
                        "Permanent elimination of friction losses",
                        "Gear teeth widening during idle time",
                        "Self-correcting shaft geometry",
                    ],
                    "correct_option_index": 0,
                },
                {
                    "question": "How does a milling machine differ from a lathe in the basic motion used for cutting?",
                    "options": [
                        "The cutting tool rotates instead of the workpiece",
                        "The workpiece never needs clamping",
                        "The machine removes material using fluid pressure only",
                        "The gearbox is replaced by a boiler",
                        "The tool remains fixed while gravity shapes the part",
                    ],
                    "correct_option_index": 0,
                },
            ],
        },
    )


def test_quiz_shared_round_resolves_when_a_player_secures_six(direct_vm, direct_deploy, direct_alice, direct_bob):
    contract = direct_deploy("contracts/quiz_game.py", ZERO_ADDRESS)
    _mock_quiz_pack(direct_vm, "ROOM04")

    direct_vm.sender = direct_alice
    contract.register_profile("Alice")
    contract.create_room("ROOM04", "Tech")

    direct_vm.sender = direct_bob
    contract.register_profile("Bob")
    contract.join_room("ROOM04")
    contract.accept_room("ROOM04")

    direct_vm.sender = direct_alice
    contract.start_quiz("ROOM04")
    room = contract.get_room("ROOM04")
    assert room.status == "studying"
    assert room.question_count == 11
    assert room.material_body

    contract.ready_up("ROOM04")

    direct_vm.sender = direct_bob
    contract.ready_up("ROOM04")

    current_question = contract.get_current_question("ROOM04")
    assert current_question["question_index"] == 1
    assert len(current_question["options"]) == 5

    direct_vm.sender = direct_alice
    contract.submit_entry("ROOM04", 1, 0)

    room = contract.get_room("ROOM04")
    assert room.owner_questions_secured == 1
    assert room.current_question_index == 2

    contract.submit_entry("ROOM04", 2, 1)
    room = contract.get_room("ROOM04")
    assert room.current_turn == room.opponent

    direct_vm.sender = direct_bob
    contract.submit_entry("ROOM04", 2, 0)
    room = contract.get_room("ROOM04")
    assert room.opponent_questions_secured == 1
    assert room.current_question_index == 3

    direct_vm.sender = direct_alice
    contract.submit_entry("ROOM04", 3, 1)
    direct_vm.sender = direct_bob
    contract.submit_entry("ROOM04", 3, 2)
    direct_vm.sender = direct_alice
    contract.submit_entry("ROOM04", 3, 3)
    direct_vm.sender = direct_bob
    contract.submit_entry("ROOM04", 3, 4)

    room = contract.get_room("ROOM04")
    assert room.current_question_index == 4
    assert room.revealed_answer == "Hydraulic system"

    for question_index in [4, 5, 6, 7, 8]:
        direct_vm.sender = direct_alice
        contract.submit_entry("ROOM04", question_index, 0)

    resolved = contract.get_room("ROOM04")
    assert resolved.status == "resolved"
    assert resolved.winner == resolved.owner
    assert resolved.owner_score == 6
    assert resolved.opponent_score == 1
    assert "secured six questions first" in resolved.verdict_reasoning


def test_quiz_requires_acceptance_and_readiness_before_live_answers(direct_vm, direct_deploy, direct_alice, direct_bob):
    contract = direct_deploy("contracts/quiz_game.py", ZERO_ADDRESS)
    _mock_quiz_pack(direct_vm, "ROOM05")

    direct_vm.sender = direct_alice
    contract.register_profile("Alice")
    contract.create_room("ROOM05", "Tech")

    direct_vm.sender = direct_bob
    contract.register_profile("Bob")
    contract.join_room("ROOM05")

    direct_vm.sender = direct_alice
    with direct_vm.expect_revert("The joining player must accept the room before the quiz can start."):
        contract.start_quiz("ROOM05")

    direct_vm.sender = direct_bob
    contract.accept_room("ROOM05")

    direct_vm.sender = direct_alice
    contract.start_quiz("ROOM05")

    with direct_vm.expect_revert("The quiz is not currently accepting answers."):
        contract.submit_entry("ROOM05", 1, 0)

    contract.ready_up("ROOM05")

    direct_vm.sender = direct_bob
    with direct_vm.expect_revert("The quiz is not currently accepting answers."):
        contract.submit_entry("ROOM05", 1, 0)

    contract.ready_up("ROOM05")

    owner_state = contract.get_player_state("ROOM05", direct_alice)
    opponent_state = contract.get_player_state("ROOM05", direct_bob)
    assert owner_state["status"] == "active"
    assert owner_state["can_answer"] is True
    assert opponent_state["can_answer"] is True


def test_quiz_resolves_without_a_winner_if_every_question_is_skipped(direct_vm, direct_deploy, direct_alice, direct_bob):
    contract = direct_deploy("contracts/quiz_game.py", ZERO_ADDRESS)
    _mock_quiz_pack(direct_vm, "ROOM06")

    direct_vm.sender = direct_alice
    contract.register_profile("Alice")
    contract.create_room("ROOM06", "Tech")

    direct_vm.sender = direct_bob
    contract.register_profile("Bob")
    contract.join_room("ROOM06")
    contract.accept_room("ROOM06")

    direct_vm.sender = direct_alice
    contract.start_quiz("ROOM06")
    contract.ready_up("ROOM06")

    direct_vm.sender = direct_bob
    contract.ready_up("ROOM06")

    for question_index in range(1, 12):
      direct_vm.sender = direct_alice
      contract.submit_entry("ROOM06", question_index, 1)
      direct_vm.sender = direct_bob
      contract.submit_entry("ROOM06", question_index, 2)
      direct_vm.sender = direct_alice
      contract.submit_entry("ROOM06", question_index, 3)
      direct_vm.sender = direct_bob
      contract.submit_entry("ROOM06", question_index, 4)

    resolved = contract.get_room("ROOM06")
    assert resolved.status == "resolved"
    assert str(resolved.winner) == ZERO_ADDRESS
    assert resolved.owner_score == 0
    assert resolved.opponent_score == 0
    assert "no winner and no XP payout" in resolved.verdict_reasoning


def test_quiz_forfeit_resolves_the_other_player_as_winner(direct_vm, direct_deploy, direct_alice, direct_bob):
    contract = direct_deploy("contracts/quiz_game.py", ZERO_ADDRESS)
    _mock_quiz_pack(direct_vm, "ROOM07")

    direct_vm.sender = direct_alice
    contract.register_profile("Alice")
    contract.create_room("ROOM07", "Tech")

    direct_vm.sender = direct_bob
    contract.register_profile("Bob")
    contract.join_room("ROOM07")
    contract.accept_room("ROOM07")

    direct_vm.sender = direct_alice
    contract.start_quiz("ROOM07")
    contract.ready_up("ROOM07")

    direct_vm.sender = direct_bob
    contract.ready_up("ROOM07")
    contract.forfeit_room("ROOM07")

    resolved = contract.get_room("ROOM07")
    assert resolved.status == "resolved"
    assert resolved.winner == resolved.owner
    assert "wins by forfeit" in resolved.verdict_reasoning
