# { "Depends": "py-genlayer:1jb45aa8ynh2a9c9xn3b7qqh8sm5q93hwfp7jqmwsfhh8jpz09h6" }

from dataclasses import dataclass
import typing

try:
    from genlayer import *
except ModuleNotFoundError:
    from genlayer_py import *


ZERO_ADDRESS = Address("0x0000000000000000000000000000000000000000")
MODE = "quiz"
QUIZ_LENGTH = 11
QUIZ_OPTIONS = 5
QUESTIONS_TO_WIN = 6


@gl.contract_interface
class ProfileFactory:
    class View:
        def get_profile_owner(self, profile: Address, /) -> Address: ...
        def is_registered_profile(self, profile: Address, /) -> bool: ...


@gl.contract_interface
class PlayerProfile:
    class View:
        def get_handle(self, /) -> str: ...

    class Write:
        def apply_match_result(self, match_id: str, did_win: bool, mode: str, /) -> None: ...


@allow_storage
@dataclass
class LocalProfile:
    name: str


@allow_storage
@dataclass
class QuizRoom:
    id: str
    mode: str
    owner: Address
    owner_name: str
    opponent: Address
    opponent_name: str
    category: str
    prompt: str
    house_stance: str
    material_body: str
    owner_submission: str
    opponent_submission: str
    status: str
    winner: Address
    owner_score: u16
    opponent_score: u16
    verdict_reasoning: str
    question_count: u16
    current_question_index: u16
    owner_questions_secured: u16
    opponent_questions_secured: u16
    owner_attempts_used: u8
    opponent_attempts_used: u8
    owner_ready: bool
    opponent_ready: bool
    current_turn: Address
    revealed_answer: str
    accepted: bool


class QuizGame(gl.Contract):
    owner: Address
    profile_factory: Address
    single_room_only: bool
    local_profiles: TreeMap[Address, LocalProfile]
    rooms: TreeMap[str, QuizRoom]
    room_ids: DynArray[str]
    room_questions: TreeMap[str, str]
    room_option_blobs: TreeMap[str, str]
    room_correct_indices: TreeMap[str, u8]

    def __init__(self, profile_factory: typing.Any = ZERO_ADDRESS, single_room_only: bool = False):
        self.owner = gl.message.sender_address
        self.profile_factory = self._normalize_address(profile_factory)
        self.single_room_only = single_room_only

        root = gl.storage.Root.get()
        root.upgraders.get().append(gl.message.sender_address)

    @gl.public.write
    def set_profile_factory(self, profile_factory: str):
        self._require_owner()
        self.profile_factory = Address(profile_factory)

    @gl.public.write
    def register_profile(self, name: str):
        clean_name = name.strip()
        if len(clean_name) < 3:
            raise Exception("Profile names must be at least 3 characters.")
        if len(clean_name) > 24:
            raise Exception("Profile names must be 24 characters or fewer.")
        self.local_profiles[gl.message.sender_address] = LocalProfile(clean_name)

    @gl.public.write
    def create_room(self, room_id: str, category: str, owner_profile: Address = ZERO_ADDRESS):
        owner_profile = self._normalize_address(owner_profile)
        normalized_id = room_id.strip().upper()
        normalized_category = self._normalize_category(category)

        if self.single_room_only and len(self.room_ids) > 0:
            raise Exception("This quiz room contract is already initialized.")
        if not normalized_id:
            raise Exception("Room id is required.")
        if normalized_id in self.rooms:
            raise Exception("Room already exists.")
        if not normalized_category:
            raise Exception("Category is required.")

        room_owner = owner_profile if self.profile_factory != ZERO_ADDRESS else gl.message.sender_address
        self.rooms[normalized_id] = QuizRoom(
            id=normalized_id,
            mode=MODE,
            owner=room_owner,
            owner_name=self._require_player_name(owner_profile),
            opponent=ZERO_ADDRESS,
            opponent_name="",
            category=normalized_category,
            prompt="",
            house_stance="",
            material_body="",
            owner_submission="",
            opponent_submission="",
            status="waiting",
            winner=ZERO_ADDRESS,
            owner_score=u16(0),
            opponent_score=u16(0),
            verdict_reasoning="",
            question_count=u16(0),
            current_question_index=u16(0),
            owner_questions_secured=u16(0),
            opponent_questions_secured=u16(0),
            owner_attempts_used=u8(0),
            opponent_attempts_used=u8(0),
            owner_ready=False,
            opponent_ready=False,
            current_turn=ZERO_ADDRESS,
            revealed_answer="",
            accepted=False,
        )
        self.room_ids.append(normalized_id)

    @gl.public.write
    def join_room(self, room_id: str, opponent_profile: Address = ZERO_ADDRESS):
        opponent_profile = self._normalize_address(opponent_profile)
        room = self._require_room(room_id)
        join_identity = opponent_profile if self.profile_factory != ZERO_ADDRESS else gl.message.sender_address

        if room.owner == join_identity:
            raise Exception("The creator cannot join twice.")
        if room.opponent != ZERO_ADDRESS:
            raise Exception("Room already has a second player.")

        self._require_profile_owner(opponent_profile)
        room.opponent = join_identity
        room.opponent_name = self._require_player_name(opponent_profile)
        room.status = "pending_accept"
        self.rooms[room.id] = room

    @gl.public.write
    def accept_room(self, room_id: str):
        room = self._require_room(room_id)
        if room.opponent == ZERO_ADDRESS:
            raise Exception("A quiz room needs an opponent before it can be accepted.")
        if room.accepted:
            raise Exception("This quiz room has already been accepted.")

        participant = self._participant_profile(room)
        if participant != room.opponent:
            raise Exception("Only the joining player can accept this quiz room.")

        room.accepted = True
        room.status = "ready_to_start"
        self.rooms[room.id] = room

    @gl.public.write
    def start_quiz(self, room_id: str):
        room = self._require_room(room_id)
        participant = self._participant_profile(room)

        if participant != room.owner:
            raise Exception("Only the room owner can start the quiz.")
        if room.opponent == ZERO_ADDRESS or not room.accepted:
            raise Exception("The joining player must accept the room before the quiz can start.")
        if room.question_count > 0:
            raise Exception("This quiz has already been generated.")

        generated = self._generate_quiz_pack(room.id, room.category)
        questions = generated["questions"]

        for index in range(len(questions)):
            question = questions[index]
            key = self._question_key(room.id, index)
            options = question.get("options", [])
            self.room_questions[key] = str(question["question"]).strip()
            self.room_option_blobs[key] = "||".join(str(option).strip() for option in options)
            self.room_correct_indices[key] = u8(int(question["correct_option_index"]))

        room.prompt = generated["topic_title"]
        room.house_stance = generated["topic_summary"]
        room.material_body = generated["material_body"]
        room.question_count = u16(len(questions))
        room.current_question_index = u16(1)
        room.status = "studying"
        room.revealed_answer = ""
        room.owner_ready = False
        room.opponent_ready = False
        self.rooms[room.id] = room

    @gl.public.write
    def ready_up(self, room_id: str):
        room = self._require_room(room_id)
        participant = self._participant_profile(room)

        if room.status != "studying":
            raise Exception("Quiz material is not waiting on player readiness.")

        if participant == room.owner:
            room.owner_ready = True
        else:
            room.opponent_ready = True

        if room.owner_ready and room.opponent_ready:
            room.status = "active"
            room.current_turn = ZERO_ADDRESS
            room.owner_attempts_used = u8(0)
            room.opponent_attempts_used = u8(0)
            room.revealed_answer = ""

        self.rooms[room.id] = room

    @gl.public.write
    def submit_entry(self, room_id: str, question_index: u16, option_index: u8):
        room = self._require_room(room_id)
        participant = self._participant_profile(room)

        if room.status != "active":
            raise Exception("The quiz is not currently accepting answers.")
        if room.winner != ZERO_ADDRESS or room.status == "resolved":
            raise Exception("Resolved rooms cannot be edited.")
        if int(question_index) != int(room.current_question_index):
            raise Exception("That question is no longer active.")
        if int(option_index) < 0 or int(option_index) >= QUIZ_OPTIONS:
            raise Exception("Quiz answers must select one of the five stored options.")
        if room.current_turn != ZERO_ADDRESS and participant != room.current_turn:
            raise Exception("It is currently the other player's turn to answer this question.")

        owner_attempts = int(room.owner_attempts_used)
        opponent_attempts = int(room.opponent_attempts_used)
        if participant == room.owner and owner_attempts >= 2:
            raise Exception("You already used both attempts for this question.")
        if participant == room.opponent and opponent_attempts >= 2:
            raise Exception("You already used both attempts for this question.")

        question_key = self._question_key(room.id, int(room.current_question_index) - 1)
        options = self._split_options(self.room_option_blobs.get(question_key, ""))
        if len(options) != QUIZ_OPTIONS:
            raise Exception("Quiz options are unavailable for this question.")

        selected_option = options[int(option_index)]
        correct_index = int(self.room_correct_indices.get(question_key, u8(255)))
        if correct_index < 0 or correct_index >= QUIZ_OPTIONS:
            raise Exception("Quiz answer key is unavailable for this question.")

        if participant == room.owner:
            room.owner_submission = selected_option
        else:
            room.opponent_submission = selected_option

        if int(option_index) == correct_index:
            if participant == room.owner:
                room.owner_questions_secured += 1
            else:
                room.opponent_questions_secured += 1

            room.revealed_answer = options[correct_index]
            self._advance_after_correct(room, participant)
            return

        if participant == room.owner:
            room.owner_attempts_used += 1
        else:
            room.opponent_attempts_used += 1

        room.revealed_answer = ""

        owner_attempts = int(room.owner_attempts_used)
        opponent_attempts = int(room.opponent_attempts_used)
        if owner_attempts >= 2 and opponent_attempts >= 2:
            room.revealed_answer = options[correct_index]
            self._advance_after_double_fail(room)
            return

        room.current_turn = room.opponent if participant == room.owner else room.owner
        self.rooms[room.id] = room

    @gl.public.write
    def resolve_room(self, room_id: str):
        room = self._require_room(room_id)

        if room.status == "resolved":
            raise Exception("Room already has a verdict.")
        if room.question_count == 0:
            raise Exception("The quiz has not started yet.")
        if int(room.current_question_index) <= int(room.question_count):
            raise Exception("The quiz is still in progress.")

        self._resolve_from_scoreline(room)

    @gl.public.write
    def forfeit_room(self, room_id: str):
        room = self._require_room(room_id)

        if room.status == "resolved":
            raise Exception("Room already has a verdict.")
        if room.opponent == ZERO_ADDRESS:
            raise Exception("A quiz room needs two players before someone can quit.")

        quitter = self._participant_profile(room)
        winner = room.opponent if quitter == room.owner else room.owner
        winner_name = room.opponent_name if quitter == room.owner else room.owner_name
        quitter_name = room.owner_name if quitter == room.owner else room.opponent_name

        room.status = "resolved"
        room.winner = winner
        room.owner_score = room.owner_questions_secured
        room.opponent_score = room.opponent_questions_secured
        room.verdict_reasoning = f"{quitter_name} quit the quiz, so {winner_name} wins by forfeit."
        self.rooms[room.id] = room

        self._emit_profile_result(room.id, winner, quitter)

    @gl.public.write
    def sync_profile_results(self, room_id: str):
        room = self._require_room(room_id)
        if room.status != "resolved":
            raise Exception("Only resolved rooms can sync profile results.")

        loser = self._resolved_loser(room)
        if room.winner == ZERO_ADDRESS or loser == ZERO_ADDRESS:
            return

        self._emit_profile_result(room.id, room.winner, loser)

    @gl.public.write
    def upgrade(self, new_code: bytes):
        self._require_owner()
        root = gl.storage.Root.get()
        code = root.code.get()
        code.truncate()
        code.extend(new_code)

    @gl.public.view
    def get_room(self, room_id: str) -> TreeMap[str, typing.Any]:
        normalized_id = room_id.strip().upper()

        return self.rooms.get(
            normalized_id,
            QuizRoom(
                id="",
                mode=MODE,
                owner=ZERO_ADDRESS,
                owner_name="",
                opponent=ZERO_ADDRESS,
                opponent_name="",
                category="",
                prompt="",
                house_stance="",
                material_body="",
                owner_submission="",
                opponent_submission="",
                status="waiting",
                winner=ZERO_ADDRESS,
                owner_score=u16(0),
                opponent_score=u16(0),
                verdict_reasoning="",
                question_count=u16(0),
                current_question_index=u16(0),
                owner_questions_secured=u16(0),
                opponent_questions_secured=u16(0),
                owner_attempts_used=u8(0),
                opponent_attempts_used=u8(0),
                owner_ready=False,
                opponent_ready=False,
                current_turn=ZERO_ADDRESS,
                revealed_answer="",
                accepted=False,
            ),
        )

    @gl.public.view
    def get_room_ids(self) -> DynArray[str]:
        return self.room_ids

    @gl.public.view
    def get_profile_factory(self) -> Address:
        return self.profile_factory

    @gl.public.view
    def get_current_question(self, room_id: str) -> TreeMap[str, typing.Any]:
        room = self._require_room(room_id)
        if room.question_count == 0:
            return {
                "question_index": u16(0),
                "question": "",
                "options": [],
                "revealed_answer": room.revealed_answer,
                "current_turn": room.current_turn,
            }

        current_index = int(room.current_question_index)
        if current_index <= 0:
            current_index = 1

        key = self._question_key(room.id, current_index - 1)
        options = self._split_options(self.room_option_blobs.get(key, ""))
        return {
            "question_index": room.current_question_index,
            "question": self.room_questions.get(key, ""),
            "options": options,
            "revealed_answer": room.revealed_answer,
            "current_turn": room.current_turn,
        }

    @gl.public.view
    def get_player_state(self, room_id: str, profile_address: Address) -> TreeMap[str, typing.Any]:
        room = self._require_room(room_id)
        role = self._profile_role(room, profile_address)
        questions_secured = room.owner_questions_secured if role == "owner" else room.opponent_questions_secured
        attempts_used = room.owner_attempts_used if role == "owner" else room.opponent_attempts_used
        ready = room.owner_ready if role == "owner" else room.opponent_ready
        latest_submission = room.owner_submission if role == "owner" else room.opponent_submission
        waiting_on_other = room.current_turn != ZERO_ADDRESS and room.current_turn != self._normalize_address(profile_address)
        can_answer = room.status == "active" and not waiting_on_other and int(attempts_used) < 2

        return {
            "role": role,
            "ready": ready,
            "questions_secured": questions_secured,
            "attempts_used": attempts_used,
            "attempts_remaining": u8(max(0, 2 - int(attempts_used))),
            "total_questions": room.question_count,
            "question_index": room.current_question_index,
            "latest_submission": latest_submission,
            "waiting_on_other": waiting_on_other,
            "can_answer": can_answer,
            "status": room.status,
        }

    def _factory(self) -> ProfileFactory:
        if self.profile_factory == ZERO_ADDRESS:
            raise Exception("Profile factory is not configured.")
        return ProfileFactory(self.profile_factory)

    def _generate_quiz_pack(self, room_id: str, category: str) -> TreeMap[str, typing.Any]:
        variation = self._seed_variation(room_id)
        generation_prompt = f"""
Generate a competitive head-to-head quiz pack for two players.
Return valid JSON only with these keys:
- "topic_title": a focused topic title, 10-100 characters
- "topic_summary": one-sentence summary of the topic, 24-180 characters
- "material_body": a study note of 600-2200 characters teaching the topic clearly
- "questions": array of exactly {QUIZ_LENGTH} objects

Each question object must contain:
- "question": a precise question, 20-180 characters
- "options": array of exactly {QUIZ_OPTIONS} answer choices
- "correct_option_index": integer from 0 to 4

Rules:
- Category: {category}
- Pick one coherent topic inside the category.
- The room seed must materially change the chosen subtopic, framing, and study-note angle.
- Avoid repeating the same generic topic or summary wording across different room seeds in the same category.
- Use this seed profile when choosing the subtopic and framing:
  - Variation lane: {variation["lane"]}
  - Lens: {variation["lens"]}
  - Difficulty focus: {variation["difficulty"]}
- The study note must contain the information needed to answer the quiz.
- The same 11 questions are shared by both players.
- Questions must become slightly harder over time.
- Wrong options must be plausible, hard, and non-obvious.
- Do not use "all of the above" or trick wording.
- Use the room seed "{room_id}" to vary the pack.
        """.strip()

        def leader_fn():
            response = gl.nondet.exec_prompt(generation_prompt, response_format="json")
            return self._normalize_generated_quiz(response)

        def validator_fn(leader_result):
            if not isinstance(leader_result, gl.vm.Return):
                return False
            return self._is_valid_generated_quiz(leader_result.calldata)

        return gl.vm.run_nondet_unsafe(leader_fn, validator_fn)

    def _normalize_generated_quiz(self, response: typing.Any) -> TreeMap[str, typing.Any]:
        if not isinstance(response, dict):
            raise Exception("Quiz generation returned a non-dict payload.")

        topic_title = str(response.get("topic_title", "")).strip()
        topic_summary = str(response.get("topic_summary", "")).strip()
        material_body = str(response.get("material_body", "")).strip()
        questions = response.get("questions")

        if len(topic_title) < 10 or len(topic_title) > 100:
            raise Exception("Generated quiz topic title is invalid.")
        if len(topic_summary) < 24 or len(topic_summary) > 180:
            raise Exception("Generated quiz summary is invalid.")
        if len(material_body) < 600 or len(material_body) > 2200:
            raise Exception("Generated quiz study material is invalid.")
        if not isinstance(questions, list) or len(questions) != QUIZ_LENGTH:
            raise Exception("Generated quiz must contain exactly eleven questions.")

        normalized_questions = []
        seen_questions = set()
        for question in questions:
            if not isinstance(question, dict):
                raise Exception("Quiz questions must be objects.")

            prompt_text = str(question.get("question", "")).strip()
            options_raw = question.get("options", [])
            correct_option_index = question.get("correct_option_index")

            if len(prompt_text) < 20 or len(prompt_text) > 180:
                raise Exception("Quiz question text is invalid.")
            if not isinstance(options_raw, list) or len(options_raw) != QUIZ_OPTIONS:
                raise Exception("Each quiz question must contain exactly five options.")

            try:
                correct_index = int(correct_option_index)
            except (ValueError, TypeError):
                raise Exception("Quiz correct option index is invalid.")

            if correct_index < 0 or correct_index >= QUIZ_OPTIONS:
                raise Exception("Quiz correct option index is out of range.")

            options = []
            seen_options = set()
            for option in options_raw:
                option_text = str(option).strip()
                if len(option_text) < 1 or len(option_text) > 140:
                    raise Exception("Quiz option text is invalid.")
                option_key = option_text.lower()
                if option_key in seen_options:
                    raise Exception("Quiz options must be unique per question.")
                seen_options.add(option_key)
                options.append(option_text)

            dedupe_key = prompt_text.lower()
            if dedupe_key in seen_questions:
                raise Exception("Quiz questions must be unique.")
            seen_questions.add(dedupe_key)

            normalized_questions.append(
                {
                    "question": prompt_text,
                    "options": options,
                    "correct_option_index": correct_index,
                }
            )

        return {
            "topic_title": topic_title,
            "topic_summary": topic_summary,
            "material_body": material_body,
            "questions": normalized_questions,
        }

    def _seed_variation(self, room_id: str) -> TreeMap[str, str]:
        seed = room_id.strip().upper()
        if not seed:
            seed = "ROOM00"

        total = 0
        for char in seed:
            total += ord(char)

        lanes = [
            "foundations and first principles",
            "historical turning points",
            "real-world applications",
            "failure modes and risks",
            "systems and architecture",
            "measurement and performance tradeoffs",
        ]
        lenses = [
            "practical operator perspective",
            "student study guide perspective",
            "decision-maker perspective",
            "builder perspective",
            "comparative analysis perspective",
            "problem-solving perspective",
        ]
        difficulties = [
            "definitions first, then layered application",
            "conceptual comparisons and edge cases",
            "mechanism-heavy explanation",
            "timeline and evolution emphasis",
            "tradeoff-heavy explanation",
            "scenario-based reasoning emphasis",
        ]

        return {
            "lane": lanes[total % len(lanes)],
            "lens": lenses[(total // 3) % len(lenses)],
            "difficulty": difficulties[(total // 5) % len(difficulties)],
        }

    def _is_valid_generated_quiz(self, payload: typing.Any) -> bool:
        if not isinstance(payload, dict):
            return False

        topic_title = payload.get("topic_title")
        topic_summary = payload.get("topic_summary")
        material_body = payload.get("material_body")
        questions = payload.get("questions")

        if not isinstance(topic_title, str) or not isinstance(topic_summary, str) or not isinstance(material_body, str):
            return False
        if len(topic_title.strip()) < 10 or len(topic_title.strip()) > 100:
            return False
        if len(topic_summary.strip()) < 24 or len(topic_summary.strip()) > 180:
            return False
        if len(material_body.strip()) < 600 or len(material_body.strip()) > 2200:
            return False
        if not isinstance(questions, list) or len(questions) != QUIZ_LENGTH:
            return False

        seen_questions = set()
        for question in questions:
            if not isinstance(question, dict):
                return False
            prompt_text = question.get("question")
            options = question.get("options")
            correct_option_index = question.get("correct_option_index")
            if not isinstance(prompt_text, str) or len(prompt_text.strip()) < 20 or len(prompt_text.strip()) > 180:
                return False
            if not isinstance(options, list) or len(options) != QUIZ_OPTIONS:
                return False
            if not isinstance(correct_option_index, int) or correct_option_index < 0 or correct_option_index >= QUIZ_OPTIONS:
                return False
            if prompt_text.strip().lower() in seen_questions:
                return False
            seen_questions.add(prompt_text.strip().lower())
            seen_options = set()
            for option in options:
                if not isinstance(option, str) or not option.strip() or len(option.strip()) > 140:
                    return False
                option_key = option.strip().lower()
                if option_key in seen_options:
                    return False
                seen_options.add(option_key)

        return True

    def _advance_after_correct(self, room: QuizRoom, participant: Address):
        if participant == room.owner and int(room.owner_questions_secured) >= QUESTIONS_TO_WIN:
            self._resolve_with_winner(room, room.owner, room.opponent, f"{room.owner_name} secured six questions first.")
            return
        if participant == room.opponent and int(room.opponent_questions_secured) >= QUESTIONS_TO_WIN:
            self._resolve_with_winner(room, room.opponent, room.owner, f"{room.opponent_name} secured six questions first.")
            return

        next_index = int(room.current_question_index) + 1
        if next_index > int(room.question_count):
            room.current_question_index = u16(next_index)
            self._resolve_from_scoreline(room)
            return

        room.current_question_index = u16(next_index)
        room.current_turn = ZERO_ADDRESS
        room.owner_attempts_used = u8(0)
        room.opponent_attempts_used = u8(0)
        self.rooms[room.id] = room

    def _advance_after_double_fail(self, room: QuizRoom):
        next_index = int(room.current_question_index) + 1
        if next_index > int(room.question_count):
            room.current_question_index = u16(next_index)
            self._resolve_from_scoreline(room)
            return

        room.current_question_index = u16(next_index)
        room.current_turn = ZERO_ADDRESS
        room.owner_attempts_used = u8(0)
        room.opponent_attempts_used = u8(0)
        self.rooms[room.id] = room

    def _resolve_from_scoreline(self, room: QuizRoom):
        owner_score = int(room.owner_questions_secured)
        opponent_score = int(room.opponent_questions_secured)

        if owner_score > opponent_score:
            self._resolve_with_winner(
                room,
                room.owner,
                room.opponent,
                f"{room.owner_name} secured more questions across the full eleven-question round.",
            )
            return

        if opponent_score > owner_score:
            self._resolve_with_winner(
                room,
                room.opponent,
                room.owner,
                f"{room.opponent_name} secured more questions across the full eleven-question round.",
            )
            return

        room.status = "resolved"
        room.winner = ZERO_ADDRESS
        room.owner_score = u16(owner_score)
        room.opponent_score = u16(opponent_score)
        room.verdict_reasoning = (
            "The round ended level on secured questions, so the quiz resolved with no winner and no XP payout."
        )
        self.rooms[room.id] = room

    def _resolve_with_winner(self, room: QuizRoom, winner: Address, loser: Address, reasoning: str):
        room.status = "resolved"
        room.winner = winner
        room.owner_score = room.owner_questions_secured
        room.opponent_score = room.opponent_questions_secured
        room.verdict_reasoning = reasoning
        self.rooms[room.id] = room
        self._emit_profile_result(room.id, winner, loser)

    def _require_room(self, room_id: str) -> QuizRoom:
        normalized_id = room_id.strip().upper()
        if normalized_id not in self.rooms:
            raise Exception("Room does not exist.")
        return self.rooms[normalized_id]

    def _require_owner(self):
        if gl.message.sender_address != self.owner:
            raise Exception("Only the contract owner can perform this action.")

    def _require_profile_owner(self, profile_address: Address):
        if self.profile_factory == ZERO_ADDRESS:
            if gl.message.sender_address not in self.local_profiles:
                raise Exception("Create a local profile before interacting with the quiz game.")
            return

        profile_address = self._normalize_address(profile_address)
        factory = self._factory()
        if not factory.view().is_registered_profile(profile_address):
            raise Exception("Register a profile before interacting with this game.")

        owner = factory.view().get_profile_owner(profile_address)
        if gl.message.sender_address == self.profile_factory:
            return owner
        if owner != gl.message.sender_address:
            raise Exception("Only the current holder of this profile can perform that action.")

    def _require_player_name(self, profile_address: Address) -> str:
        if self.profile_factory == ZERO_ADDRESS:
            profile = self.local_profiles.get(gl.message.sender_address)
            if profile and profile.name:
                return profile.name
            raise Exception("Create a local profile before interacting with the quiz game.")

        profile_address = self._normalize_address(profile_address)
        self._require_profile_owner(profile_address)
        handle = PlayerProfile(profile_address).view().get_handle().strip()
        if not handle:
            raise Exception("Profile did not return a valid handle.")
        return handle

    def _participant_profile(self, room: QuizRoom) -> Address:
        sender = gl.message.sender_address
        if self.profile_factory == ZERO_ADDRESS:
            if room.owner == sender:
                return room.owner
            if room.opponent == sender:
                return room.opponent
            raise Exception("Only room participants can interact with this quiz.")

        factory = self._factory()

        if room.owner != ZERO_ADDRESS and factory.view().get_profile_owner(room.owner) == sender:
            return room.owner
        if room.opponent != ZERO_ADDRESS and factory.view().get_profile_owner(room.opponent) == sender:
            return room.opponent
        raise Exception("Only room participants can interact with this quiz.")

    def _profile_role(self, room: QuizRoom, profile_address: Address) -> str:
        normalized = self._normalize_address(profile_address)
        if normalized == room.owner:
            return "owner"
        if normalized == room.opponent:
            return "opponent"
        raise Exception("Only room participants can access this quiz state.")

    def _normalize_address(self, player: typing.Any) -> Address:
        if isinstance(player, Address):
            return player
        if isinstance(player, bytes):
            return Address(player)
        if hasattr(player, "as_bytes"):
            return Address(player.as_bytes)
        return Address(player)

    def _question_key(self, room_id: str, index: int) -> str:
        return f"{room_id}:{index}"

    def _split_options(self, blob: str) -> typing.List[str]:
        if not blob:
            return []
        return [part.strip() for part in blob.split("||")]

    def _emit_profile_result(self, room_id: str, winner: Address, loser: Address):
        if self.profile_factory == ZERO_ADDRESS:
            return
        winner = self._normalize_address(winner)
        loser = self._normalize_address(loser)
        if winner == ZERO_ADDRESS or loser == ZERO_ADDRESS:
            return

        match_id = self._match_id(room_id)
        PlayerProfile(winner).emit(on="accepted").apply_match_result(match_id, True, MODE)
        PlayerProfile(loser).emit(on="accepted").apply_match_result(match_id, False, MODE)

    def _resolved_loser(self, room: QuizRoom) -> Address:
        if room.winner == room.owner:
            return room.opponent
        if room.winner == room.opponent:
            return room.owner
        return ZERO_ADDRESS

    def _match_id(self, room_id: str) -> str:
        return f"{MODE}:{room_id}"

    def _normalize_category(self, category: str) -> str:
        cleaned = category.strip()
        if not cleaned:
            return ""
        return " ".join(part.capitalize() for part in cleaned.split())
