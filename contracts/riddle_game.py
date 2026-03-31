# { "Depends": "py-genlayer:1jb45aa8ynh2a9c9xn3b7qqh8sm5q93hwfp7jqmwsfhh8jpz09h6" }

from dataclasses import dataclass
import typing

try:
    from genlayer import *
except ModuleNotFoundError:
    from genlayer_py import *


ZERO_ADDRESS = Address("0x0000000000000000000000000000000000000000")
MODE = "riddle"
RIDDLE_COUNT = 3
RIDDLES_TO_WIN = 3


@gl.contract_interface
class VerdictDotFunCore:
    class View:
        def get_profile_owner(self, profile: Address, /) -> Address: ...
        def is_registered_profile(self, profile: Address, /) -> bool: ...
        def get_profile_by_address(self, profile: Address, /) -> TreeMap[str, typing.Any]: ...

    class Write:
        def apply_match_result(self, profile: Address, match_id: str, did_win: bool, mode: str, /) -> None: ...


@allow_storage
@dataclass
class LocalProfile:
    name: str


@allow_storage
@dataclass
class RiddleRoom:
    id: str
    mode: str
    owner: Address
    owner_name: str
    opponent: Address
    opponent_name: str
    category: str
    prompt: str
    house_stance: str
    owner_submission: str
    opponent_submission: str
    status: str
    winner: Address
    owner_score: u16
    opponent_score: u16
    verdict_reasoning: str
    owner_submission_order: u16
    opponent_submission_order: u16
    submission_count: u16
    question_count: u16
    current_question_index: u16
    revealed_answer: str


class RiddleGame(gl.Contract):
    owner: Address
    core_contract: Address
    single_room_only: bool
    local_profiles: TreeMap[Address, LocalProfile]
    rooms: TreeMap[str, RiddleRoom]
    room_ids: DynArray[str]
    room_prompts: TreeMap[str, str]
    room_answers: TreeMap[str, str]
    room_aliases: TreeMap[str, str]

    def __init__(self, core_contract: typing.Any = ZERO_ADDRESS, single_room_only: bool = False):
        self.owner = gl.message.sender_address
        self.core_contract = self._normalize_address(core_contract)
        self.single_room_only = single_room_only

        root = gl.storage.Root.get()
        root.upgraders.get().append(gl.message.sender_address)

    @gl.public.write
    def set_core_contract(self, core_contract: str):
        self._require_owner()
        self.core_contract = Address(core_contract)

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
            raise Exception("This riddle room contract is already initialized.")
        if not normalized_id:
            raise Exception("Room id is required.")
        if normalized_id in self.rooms:
            return
        if not normalized_category:
            raise Exception("Category is required.")

        generated = self._generate_riddle_pack(normalized_id, normalized_category)
        riddles = generated["riddles"]
        for index in range(len(riddles)):
            riddle = riddles[index]
            key = self._riddle_key(normalized_id, index)
            self.room_prompts[key] = riddle["prompt"]
            self.room_answers[key] = riddle["answer"]
            self.room_aliases[key] = "|".join(riddle["aliases"])

        room_owner = owner_profile if self.core_contract != ZERO_ADDRESS else gl.message.sender_address
        self.rooms[normalized_id] = RiddleRoom(
            id=normalized_id,
            mode=MODE,
            owner=room_owner,
            owner_name=self._require_player_name(owner_profile),
            opponent=ZERO_ADDRESS,
            opponent_name="",
            category=normalized_category,
            prompt=self.room_prompts.get(self._riddle_key(normalized_id, 0), ""),
            house_stance="",
            owner_submission="",
            opponent_submission="",
            status="waiting",
            winner=ZERO_ADDRESS,
            owner_score=u16(0),
            opponent_score=u16(0),
            verdict_reasoning="",
            owner_submission_order=u16(0),
            opponent_submission_order=u16(0),
            submission_count=u16(0),
            question_count=u16(RIDDLE_COUNT),
            current_question_index=u16(1),
            revealed_answer="",
        )
        self.room_ids.append(normalized_id)

    @gl.public.write
    def join_room(self, room_id: str, opponent_profile: Address = ZERO_ADDRESS):
        opponent_profile = self._normalize_address(opponent_profile)
        room = self._require_room(room_id)
        join_identity = opponent_profile if self.core_contract != ZERO_ADDRESS else gl.message.sender_address

        if room.owner == join_identity:
            raise Exception("The creator cannot join twice.")
        if room.opponent != ZERO_ADDRESS:
            raise Exception("Room already has a second player.")

        self._require_profile_owner(opponent_profile)
        room.opponent = join_identity
        room.opponent_name = self._require_player_name(opponent_profile)
        room.status = "active"
        self.rooms[room.id] = room

    @gl.public.write
    def submit_entry(self, room_id: str, submission: str):
        room = self._require_room(room_id)
        text = submission.strip()

        if room.status == "resolved":
            raise Exception("Resolved rooms cannot be edited.")
        if room.opponent == ZERO_ADDRESS:
            raise Exception("A riddle room needs two players.")
        if room.status != "active":
            raise Exception("This riddle round is not accepting guesses.")
        if len(text) < 2:
            raise Exception("Riddle guesses must be at least 2 characters.")

        participant = self._participant_profile(room)
        room.submission_count += 1

        if participant == room.owner:
            if room.owner_submission:
                raise Exception("You already submitted your guess for this riddle.")
            room.owner_submission = text
            room.owner_submission_order = room.submission_count
        else:
            if room.opponent_submission:
                raise Exception("You already submitted your guess for this riddle.")
            room.opponent_submission = text
            room.opponent_submission_order = room.submission_count

        self.rooms[room.id] = room

    @gl.public.write
    def resolve_room(self, room_id: str):
        room = self._require_room(room_id)

        if room.status == "resolved":
            raise Exception("Room already has a verdict.")
        if room.opponent == ZERO_ADDRESS:
            raise Exception("A riddle room needs two players.")
        if not room.owner_submission or not room.opponent_submission:
            raise Exception("Both players must submit before this round can resolve.")

        self._resolve_current_riddle(room)

    @gl.public.write
    def forfeit_room(self, room_id: str):
        room = self._require_room(room_id)

        if room.status == "resolved":
            raise Exception("Room already has a verdict.")
        if room.opponent == ZERO_ADDRESS:
            raise Exception("A riddle room needs two players before someone can quit.")

        quitter = self._participant_profile(room)
        winner = room.opponent if quitter == room.owner else room.owner
        winner_name = room.opponent_name if quitter == room.owner else room.owner_name
        quitter_name = room.owner_name if quitter == room.owner else room.opponent_name

        room.status = "resolved"
        room.winner = winner
        room.verdict_reasoning = f"{quitter_name} quit the riddle room, so {winner_name} wins by forfeit."
        self.rooms[room.id] = room

        self._emit_profile_result(room.id, winner, quitter)

    @gl.public.write
    def sync_profile_results(self, room_id: str):
        room = self._require_room(room_id)
        if room.status != "resolved":
            raise Exception("Only resolved rooms can sync profile results.")

        loser = self._resolved_loser(room)
        if room.winner == ZERO_ADDRESS or loser == ZERO_ADDRESS:
            raise Exception("Resolved room does not have a complete winner/loser pair.")

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
            RiddleRoom(
                id="",
                mode=MODE,
                owner=ZERO_ADDRESS,
                owner_name="",
                opponent=ZERO_ADDRESS,
                opponent_name="",
                category="",
                prompt="",
                house_stance="",
                owner_submission="",
                opponent_submission="",
                status="waiting",
                winner=ZERO_ADDRESS,
                owner_score=u16(0),
                opponent_score=u16(0),
                verdict_reasoning="",
                owner_submission_order=u16(0),
                opponent_submission_order=u16(0),
                submission_count=u16(0),
                question_count=u16(RIDDLE_COUNT),
                current_question_index=u16(1),
                revealed_answer="",
            ),
        )

    @gl.public.view
    def get_room_ids(self) -> DynArray[str]:
        return self.room_ids

    @gl.public.view
    def get_core_contract(self) -> Address:
        return self.core_contract

    def _core(self) -> VerdictDotFunCore:
        if self.core_contract == ZERO_ADDRESS:
            raise Exception("Core contract is not configured.")
        return VerdictDotFunCore(self.core_contract)

    def _generate_riddle_pack(self, room_id: str, category: str) -> TreeMap[str, typing.Any]:
        generation_prompt = f"""
Generate a {RIDDLE_COUNT}-round riddle pack for a two-player on-chain game.
Return valid JSON only with this key:
- "riddles": array of exactly {RIDDLE_COUNT} objects

Each riddle object must contain:
- "prompt": the riddle text, 40-280 characters
- "answer": the canonical answer, 1-80 characters
- "aliases": array of 1 to 4 short acceptable alternatives

Rules:
- Category: {category}
- Generate exactly {RIDDLE_COUNT} original riddles.
- Each riddle must point clearly toward a single answer or a very tight answer family.
- The answer and aliases must be short enough for deterministic matching.
- Avoid references to the game, AI judging, or blockchains unless the category naturally implies it.
- Do not output numbering or explanation.
- Use the room seed "{room_id}" to vary the result.
        """.strip()

        def leader_fn():
            response = gl.nondet.exec_prompt(generation_prompt, response_format="json")
            return self._normalize_generated_riddle_pack(response)

        def validator_fn(leader_result):
            if not isinstance(leader_result, gl.vm.Return):
                return False
            return self._is_valid_generated_riddle_pack(leader_result.calldata)

        return gl.vm.run_nondet_unsafe(leader_fn, validator_fn)

    def _normalize_generated_riddle_pack(self, response: typing.Any) -> TreeMap[str, typing.Any]:
        if not isinstance(response, dict):
            raise Exception("Riddle generation returned a non-dict payload.")

        riddles_raw = response.get("riddles")
        if not isinstance(riddles_raw, list) or len(riddles_raw) != RIDDLE_COUNT:
            raise Exception(f"Generated riddle pack must contain exactly {RIDDLE_COUNT} riddles.")

        riddles = []
        seen_prompts = set()
        seen_answers = set()

        for riddle in riddles_raw:
            if not isinstance(riddle, dict):
                raise Exception("Generated riddle entries must be objects.")

            prompt = str(riddle.get("prompt", "")).strip()
            answer = str(riddle.get("answer", "")).strip()
            aliases_raw = riddle.get("aliases", [])

            if len(prompt) < 40 or len(prompt) > 280:
                raise Exception("Generated riddle prompt is invalid.")
            if len(answer) < 1 or len(answer) > 80:
                raise Exception("Generated riddle answer is invalid.")
            if not isinstance(aliases_raw, list) or len(aliases_raw) < 1 or len(aliases_raw) > 4:
                raise Exception("Generated riddle aliases are invalid.")

            prompt_key = prompt.lower()
            answer_key = self._normalize_answer(answer)
            if prompt_key in seen_prompts or answer_key in seen_answers:
                raise Exception("Generated riddles must be unique.")
            seen_prompts.add(prompt_key)
            seen_answers.add(answer_key)

            aliases = []
            seen_aliases = set()
            for alias in aliases_raw:
                alias_text = str(alias).strip()
                if not alias_text or len(alias_text) > 80:
                    raise Exception("Generated riddle alias is invalid.")
                alias_key = self._normalize_answer(alias_text)
                if alias_key in seen_aliases:
                    raise Exception("Generated riddle aliases must be unique.")
                seen_aliases.add(alias_key)
                aliases.append(alias_text)

            riddles.append({
                "prompt": prompt,
                "answer": answer,
                "aliases": aliases,
            })

        return {"riddles": riddles}

    def _is_valid_generated_riddle_pack(self, payload: typing.Any) -> bool:
        if not isinstance(payload, dict):
            return False

        riddles = payload.get("riddles")
        if not isinstance(riddles, list) or len(riddles) != RIDDLE_COUNT:
            return False

        seen_prompts = set()
        seen_answers = set()
        for riddle in riddles:
            if not isinstance(riddle, dict):
                return False

            prompt = riddle.get("prompt")
            answer = riddle.get("answer")
            aliases = riddle.get("aliases")

            if not isinstance(prompt, str) or len(prompt.strip()) < 40 or len(prompt.strip()) > 280:
                return False
            if not isinstance(answer, str) or len(answer.strip()) < 1 or len(answer.strip()) > 80:
                return False
            if not isinstance(aliases, list) or len(aliases) < 1 or len(aliases) > 4:
                return False

            prompt_key = prompt.strip().lower()
            answer_key = self._normalize_answer(answer)
            if prompt_key in seen_prompts or answer_key in seen_answers:
                return False
            seen_prompts.add(prompt_key)
            seen_answers.add(answer_key)

            alias_keys = set()
            for alias in aliases:
                if not isinstance(alias, str) or not alias.strip() or len(alias.strip()) > 80:
                    return False
                alias_key = self._normalize_answer(alias)
                if alias_key in alias_keys:
                    return False
                alias_keys.add(alias_key)

        return True

    def _resolve_current_riddle(self, room: RiddleRoom):
        accepted_answers = [self.room_answers.get(self._current_riddle_key(room), "")]
        alias_blob = self.room_aliases.get(self._current_riddle_key(room), "")
        if alias_blob:
            accepted_answers.extend(part.strip() for part in alias_blob.split("|") if part.strip())

        owner_exact = self._matches_any_answer(self._normalize_answer(room.owner_submission), accepted_answers)
        opponent_exact = self._matches_any_answer(self._normalize_answer(room.opponent_submission), accepted_answers)
        canonical_answer = accepted_answers[0] if accepted_answers else ""

        if owner_exact and not opponent_exact:
            room.owner_score += 1
            room.verdict_reasoning = f"{room.owner_name} solved riddle {int(room.current_question_index)} while {room.opponent_name} missed it."
        elif opponent_exact and not owner_exact:
            room.opponent_score += 1
            room.verdict_reasoning = f"{room.opponent_name} solved riddle {int(room.current_question_index)} while {room.owner_name} missed it."
        elif owner_exact and opponent_exact:
            if int(room.owner_submission_order) <= int(room.opponent_submission_order):
                room.owner_score += 1
                room.verdict_reasoning = f"Both solved riddle {int(room.current_question_index)}, but {room.owner_name} locked the correct answer first."
            else:
                room.opponent_score += 1
                room.verdict_reasoning = f"Both solved riddle {int(room.current_question_index)}, but {room.opponent_name} locked the correct answer first."
        else:
            room.verdict_reasoning = f"Neither player solved riddle {int(room.current_question_index)}."

        room.revealed_answer = canonical_answer

        if int(room.owner_score) >= RIDDLES_TO_WIN:
            self._finalize_room(room, room.owner, room.opponent, f"{room.owner_name} solved three riddles first.")
            return
        if int(room.opponent_score) >= RIDDLES_TO_WIN:
            self._finalize_room(room, room.opponent, room.owner, f"{room.opponent_name} solved three riddles first.")
            return

        if int(room.current_question_index) >= int(room.question_count):
            self._finalize_from_scoreline(room)
            return

        next_index = int(room.current_question_index) + 1
        room.current_question_index = u16(next_index)
        room.prompt = self.room_prompts.get(self._riddle_key(room.id, next_index - 1), "")
        room.owner_submission = ""
        room.opponent_submission = ""
        room.owner_submission_order = u16(0)
        room.opponent_submission_order = u16(0)
        room.submission_count = u16(0)
        room.status = "active"
        self.rooms[room.id] = room

    def _finalize_from_scoreline(self, room: RiddleRoom):
        owner_score = int(room.owner_score)
        opponent_score = int(room.opponent_score)

        if owner_score > opponent_score:
            self._finalize_room(
                room,
                room.owner,
                room.opponent,
                f"{room.owner_name} solved more riddles across the full {RIDDLE_COUNT}-round match.",
            )
            return

        if opponent_score > owner_score:
            self._finalize_room(
                room,
                room.opponent,
                room.owner,
                f"{room.opponent_name} solved more riddles across the full {RIDDLE_COUNT}-round match.",
            )
            return

        room.status = "resolved"
        room.winner = ZERO_ADDRESS
        room.verdict_reasoning = f"The {RIDDLE_COUNT}-riddle match ended level, so the room resolved with no winner and no XP payout."
        self.rooms[room.id] = room

    def _finalize_room(self, room: RiddleRoom, winner: Address, loser: Address, reasoning: str):
        room.status = "resolved"
        room.winner = winner
        room.verdict_reasoning = reasoning
        self.rooms[room.id] = room
        self._emit_profile_result(room.id, winner, loser)

    def _require_room(self, room_id: str) -> RiddleRoom:
        normalized_id = room_id.strip().upper()
        if normalized_id not in self.rooms:
            raise Exception("Room does not exist.")
        return self.rooms[normalized_id]

    def _require_owner(self):
        if gl.message.sender_address != self.owner:
            raise Exception("Only the contract owner can perform this action.")

    def _require_profile_owner(self, profile_address: Address):
        if self.core_contract == ZERO_ADDRESS:
            if gl.message.sender_address not in self.local_profiles:
                raise Exception("Create a local profile before interacting with the riddle game.")
            return

        profile_address = self._normalize_address(profile_address)
        core = self._core()
        if not core.view().is_registered_profile(profile_address):
            raise Exception("Register a profile before interacting with this game.")

        owner = core.view().get_profile_owner(profile_address)
        if gl.message.sender_address == self.core_contract:
            return owner
        if owner != gl.message.sender_address:
            raise Exception("Only the current holder of this profile can perform that action.")

    def _require_player_name(self, profile_address: Address) -> str:
        if self.core_contract == ZERO_ADDRESS:
            profile = self.local_profiles.get(gl.message.sender_address)
            if profile and profile.name:
                return profile.name
            raise Exception("Create a local profile before interacting with the riddle game.")

        profile_address = self._normalize_address(profile_address)
        self._require_profile_owner(profile_address)
        core = self._core()
        profile = core.view().get_profile_by_address(profile_address)
        handle = str(profile.get("handle", "")).strip()
        if not handle:
            raise Exception("Profile did not return a valid handle.")
        return handle

    def _participant_profile(self, room: RiddleRoom) -> Address:
        sender = gl.message.sender_address
        if self.core_contract == ZERO_ADDRESS:
            if room.owner == sender:
                return room.owner
            if room.opponent == sender:
                return room.opponent
            raise Exception("Only room participants can submit.")

        core = self._core()

        if room.owner != ZERO_ADDRESS and core.view().get_profile_owner(room.owner) == sender:
            return room.owner
        if room.opponent != ZERO_ADDRESS and core.view().get_profile_owner(room.opponent) == sender:
            return room.opponent
        raise Exception("Only room participants can submit.")

    def _normalize_answer(self, answer: str) -> str:
        raw = answer.strip().lower()
        normalized = ""
        last_was_space = False
        for char in raw:
            if char.isalnum():
                normalized += char
                last_was_space = False
            elif char in (" ", "-", "_", "/", "'", ".", ",", ":", ";") and not last_was_space:
                normalized += " "
                last_was_space = True
        return normalized.strip()

    def _matches_any_answer(self, normalized_input: str, accepted_answers: typing.List[str]) -> bool:
        if not normalized_input:
            return False

        for accepted in accepted_answers:
            normalized_accepted = self._normalize_answer(accepted)
            if not normalized_accepted:
                continue
            if normalized_input == normalized_accepted:
                return True
            if len(normalized_accepted) >= 4 and normalized_accepted in normalized_input:
                return True
            if len(normalized_input) >= 4 and normalized_input in normalized_accepted:
                return True
        return False

    def _emit_profile_result(self, room_id: str, winner: Address, loser: Address):
        if self.core_contract == ZERO_ADDRESS:
            return
        winner = self._normalize_address(winner)
        loser = self._normalize_address(loser)
        if winner == ZERO_ADDRESS or loser == ZERO_ADDRESS:
            return

        match_id = self._match_id(room_id)
        core = self._core()
        core.emit(on="accepted").apply_match_result(winner, match_id, True, MODE)
        core.emit(on="accepted").apply_match_result(loser, match_id, False, MODE)

    def _resolved_loser(self, room: RiddleRoom) -> Address:
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

    def _riddle_key(self, room_id: str, index: int) -> str:
        return f"{room_id}:{index}"

    def _current_riddle_key(self, room: RiddleRoom) -> str:
        return self._riddle_key(room.id, int(room.current_question_index) - 1)

    def _normalize_address(self, value: typing.Any) -> Address:
        if isinstance(value, Address):
            return value
        if isinstance(value, bytes):
            return Address(value)
        if hasattr(value, "as_bytes"):
            return Address(value.as_bytes)
        return Address(value)
