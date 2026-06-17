# { "Depends": "py-genlayer:1jb45aa8ynh2a9c9xn3b7qqh8sm5q93hwfp7jqmwsfhh8jpz09h6" }

from dataclasses import dataclass
import typing

try:
    from genlayer import *
except ModuleNotFoundError:
    from genlayer_py import *


ZERO_ADDRESS = Address("0x0000000000000000000000000000000000000000")
MODE = "riddle"
CHALLENGE_WINDOW_SECONDS = 3600
RIDDLE_COUNT = 3
RIDDLES_TO_WIN = 3
MAX_ATTEMPTS_PER_RIDDLE = 3

# Appeal image evidence: stored as a bare IPFS CID (content-addressed so every
# validator fetches identical bytes -> consensus-safe), fetched through a public
# gateway at judge time and passed to the vision model.
EVIDENCE_GATEWAY = "https://ipfs.io/ipfs/"
MAX_CID_LEN = 100
MIN_CID_LEN = 16
MAX_EVIDENCE_BYTES = 5 * 1024 * 1024  # 5 MiB

# Magic-byte signatures for the image formats the judge accepts. Sniffing bytes
# is deterministic and gateway-agnostic (more robust than trusting a header).
_IMAGE_MAGICS = (
    b"\x89PNG\r\n\x1a\n",  # PNG
    b"\xff\xd8\xff",       # JPEG
    b"GIF87a",             # GIF
    b"GIF89a",             # GIF
)


def _is_supported_image(data: bytes) -> bool:
    if any(data.startswith(magic) for magic in _IMAGE_MAGICS):
        return True
    # WebP: "RIFF" .... "WEBP"
    return len(data) >= 12 and data[0:4] == b"RIFF" and data[8:12] == b"WEBP"


@gl.contract_interface
class VerdictDotFunCore:
    class View:
        def get_profile_owner(self, profile: Address, /) -> Address: ...
        def is_registered_profile(self, profile: Address, /) -> bool: ...
        def get_profile_by_address(self, profile: Address, /) -> TreeMap[str, typing.Any]: ...

    class Write:
        def apply_match_result(self, profile: Address, match_id: str, did_win: bool, mode: str, bonus_xp: u16 = u16(0), /) -> None: ...


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
    stake: u256
    provisional_at: u256
    appeal_state: str
    appeal_reason: str
    appeal_result: str
    evidence_uri: str


@gl.contract_interface
class CreditLedgerIface:
    class Write:
        def open_escrow(self, room_id: str, mode: str, player_a: Address, player_b: Address, atto_stake: u256, /) -> None: ...
        def set_provisional(self, room_id: str, winner: Address, /) -> None: ...
        def finalize_winner(self, room_id: str, winner: Address, /) -> None: ...
        def finalize_tie(self, room_id: str, /) -> None: ...
        def finalize_void(self, room_id: str, /) -> None: ...


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
    credit_ledger: Address
    challenge_window_seconds: u256

    def __init__(self, core_contract: typing.Any = ZERO_ADDRESS, single_room_only: bool = False, challenge_window_seconds: u256 = u256(CHALLENGE_WINDOW_SECONDS)):
        self.owner = gl.message.sender_address
        self.core_contract = self._normalize_address(core_contract)
        self.single_room_only = single_room_only
        self.credit_ledger = ZERO_ADDRESS
        self.challenge_window_seconds = u256(int(challenge_window_seconds))

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
    def set_credit_ledger(self, ledger: Address):
        self._require_owner()
        self.credit_ledger = self._normalize_address(ledger)

    @gl.public.write
    def create_room(self, room_id: str, category: str, owner_profile: Address = ZERO_ADDRESS, stake: u256 = u256(0)):
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
            stake=u256(int(stake)),
            provisional_at=u256(0),
            appeal_state="none",
            appeal_reason="",
            appeal_result="",
            evidence_uri="",
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
        self._open_escrow_if_staked(room)

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
        accepted_answers = [self.room_answers.get(self._current_riddle_key(room), "")]
        alias_blob = self.room_aliases.get(self._current_riddle_key(room), "")
        if alias_blob:
            accepted_answers.extend(part.strip() for part in alias_blob.split("|") if part.strip())
        canonical_answer = accepted_answers[0] if accepted_answers else ""

        room.submission_count += u16(1)
        riddle_number = int(room.current_question_index)

        if participant == room.owner:
            if int(room.owner_submission_order) >= MAX_ATTEMPTS_PER_RIDDLE:
                raise Exception(f"You already used all {MAX_ATTEMPTS_PER_RIDDLE} guesses for this riddle.")
            room.owner_submission = text
            room.owner_submission_order += u16(1)
            attempt_number = int(room.owner_submission_order)
            player_name = room.owner_name
        else:
            if int(room.opponent_submission_order) >= MAX_ATTEMPTS_PER_RIDDLE:
                raise Exception(f"You already used all {MAX_ATTEMPTS_PER_RIDDLE} guesses for this riddle.")
            room.opponent_submission = text
            room.opponent_submission_order += u16(1)
            attempt_number = int(room.opponent_submission_order)
            player_name = room.opponent_name

        is_correct = self._matches_any_answer(self._normalize_answer(text), accepted_answers)
        if is_correct:
            room.revealed_answer = canonical_answer
            if participant == room.owner:
                room.owner_score += u16(1)
            else:
                room.opponent_score += u16(1)

            room.verdict_reasoning = f"{player_name} solved riddle {riddle_number} on guess {attempt_number}."
            self._complete_current_riddle(room)
            return

        remaining_guesses = MAX_ATTEMPTS_PER_RIDDLE - attempt_number
        guess_word = "guess" if remaining_guesses == 1 else "guesses"
        room.verdict_reasoning = f"{player_name} missed riddle {riddle_number}. {remaining_guesses} {guess_word} left for them this round."

        if (
            int(room.owner_submission_order) >= MAX_ATTEMPTS_PER_RIDDLE
            and int(room.opponent_submission_order) >= MAX_ATTEMPTS_PER_RIDDLE
        ):
            room.revealed_answer = canonical_answer
            room.verdict_reasoning = f"Neither player solved riddle {riddle_number} after {MAX_ATTEMPTS_PER_RIDDLE} guesses each."
            self._complete_current_riddle(room)
            return

        self.rooms[room.id] = room

    @gl.public.write
    def resolve_room(self, room_id: str):
        del room_id
        raise Exception("Riddle guesses resolve immediately on submission.")

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

        room.verdict_reasoning = f"{quitter_name} quit the riddle room, so {winner_name} wins by forfeit."
        self._enter_provisional(room, winner)

    @gl.public.write
    def sync_profile_results(self, room_id: str):
        room = self._require_room(room_id)
        if room.status != "resolved":
            raise Exception("Only resolved rooms can sync profile results.")

        loser = self._resolved_loser(room)
        if room.winner == ZERO_ADDRESS or loser == ZERO_ADDRESS:
            raise Exception("Resolved room does not have a complete winner/loser pair.")

        self._emit_profile_result(room.id, room.winner, loser, self._wager_bonus_xp(room))

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
                stake=u256(0),
                provisional_at=u256(0),
                appeal_state="none",
                appeal_reason="",
                appeal_result="",
                evidence_uri="",
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

    def _complete_current_riddle(self, room: RiddleRoom):
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
        self._settle_tie(room)

    def _finalize_room(self, room: RiddleRoom, winner: Address, loser: Address, reasoning: str):
        del loser
        room.verdict_reasoning = reasoning
        self._enter_provisional(room, winner)

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

    @gl.public.write
    def file_appeal(self, room_id: str, reason: str, evidence_uri: str = ""):
        room = self._require_room(room_id)
        if room.status != "provisional":
            raise gl.vm.UserError("[EXPECTED] Only provisional rooms can be appealed.")
        if room.appeal_state != "none":
            raise gl.vm.UserError("[EXPECTED] An appeal has already been filed for this room.")
        elapsed = self._now_epoch() - int(room.provisional_at)
        if elapsed >= int(self.challenge_window_seconds):
            raise gl.vm.UserError("[EXPECTED] The challenge window has closed.")
        identity = self._participant_profile(room)
        loser = self._resolved_loser(room)
        if identity != loser:
            raise gl.vm.UserError("[EXPECTED] Only the losing player can file an appeal.")
        cleaned = reason.strip()
        if len(cleaned) < 8:
            raise gl.vm.UserError("[EXPECTED] Appeal reason must be at least 8 characters.")
        if len(cleaned) > 600:
            raise gl.vm.UserError("[EXPECTED] Appeal reason must be 600 characters or fewer.")
        room.appeal_state = "filed"
        room.appeal_reason = cleaned
        room.evidence_uri = self._normalize_evidence_cid(evidence_uri)
        self.rooms[room.id] = room

    def _normalize_evidence_cid(self, evidence_uri: str) -> str:
        cid = evidence_uri.strip()
        if not cid:
            return ""
        if cid.startswith("ipfs://"):
            cid = cid[len("ipfs://"):]
        if len(cid) < MIN_CID_LEN or len(cid) > MAX_CID_LEN:
            raise gl.vm.UserError("[EXPECTED] Evidence CID length is out of range.")
        if not cid.isalnum():
            raise gl.vm.UserError("[EXPECTED] Evidence must be a bare IPFS CID (alphanumeric, no URL).")
        return cid

    def _fetch_evidence_image(self, cid: str) -> bytes:
        res = gl.nondet.web.get(EVIDENCE_GATEWAY + cid, headers={"Accept": "image/*"})
        if res.status >= 500:
            raise gl.vm.UserError("[TRANSIENT] Evidence gateway is unavailable.")
        if res.status >= 400:
            raise gl.vm.UserError(f"[EXTERNAL] Evidence could not be fetched (status {res.status}).")
        body = res.body or b""
        if len(body) == 0:
            raise gl.vm.UserError("[EXPECTED] Evidence image was empty.")
        if len(body) > MAX_EVIDENCE_BYTES:
            raise gl.vm.UserError("[EXPECTED] Evidence image exceeds the size limit.")
        if not _is_supported_image(body):
            raise gl.vm.UserError("[EXPECTED] Evidence is not a supported image format.")
        return body

    @gl.public.write
    def judge_appeal(self, room_id: str):
        room = self._require_room(room_id)
        if room.status != "provisional":
            raise gl.vm.UserError("[EXPECTED] Room is not awaiting a verdict.")
        if room.appeal_state != "filed":
            raise gl.vm.UserError("[EXPECTED] No appeal is pending for this room.")

        prompt = self._build_appeal_prompt(room)
        cid = room.evidence_uri

        def leader_fn():
            images = None
            if cid:
                try:
                    images = [self._fetch_evidence_image(cid)]
                except gl.vm.UserError as e:
                    msg = e.message if hasattr(e, "message") else str(e)
                    if msg.startswith("[TRANSIENT]"):
                        raise  # retryable: revert so the appeal can be judged later
                    # Deterministic bad evidence dismisses the appeal rather than
                    # deadlocking the room (finalize is blocked while it is pending).
                    return {"decision": "upheld",
                            "reasoning": "Appeal evidence was not a fetchable image, so the provisional result stands."}
            response = gl.nondet.exec_prompt(prompt, response_format="json", images=images)
            return self._normalize_appeal(response)

        def validator_fn(leaders_res: gl.vm.Result) -> bool:
            if not isinstance(leaders_res, gl.vm.Return):
                return self._appeal_errors_agree(leaders_res, leader_fn)
            try:
                validator = leader_fn()
            except Exception:
                return False  # leader succeeded, validator failed -> disagree
            return validator["decision"] == leaders_res.calldata["decision"]

        decision = gl.vm.run_nondet_unsafe(leader_fn, validator_fn)
        room.appeal_state = "judged"
        room.appeal_result = decision["decision"]
        room.verdict_reasoning = room.verdict_reasoning + " | Appeal: " + decision["reasoning"]
        if decision["decision"] == "upheld":
            self.rooms[room.id] = room
            self._settle_winner(room)
        else:
            room.status = "void"
            self.rooms[room.id] = room
            self._settle_void(room)

    @gl.public.write
    def finalize_room(self, room_id: str):
        room = self._require_room(room_id)
        if room.status != "provisional":
            raise gl.vm.UserError("[EXPECTED] Room is not awaiting finalization.")
        if room.appeal_state == "filed":
            raise gl.vm.UserError("[EXPECTED] Resolve the pending appeal before finalizing.")
        elapsed = self._now_epoch() - int(room.provisional_at)
        if elapsed < int(self.challenge_window_seconds):
            raise gl.vm.UserError("[EXPECTED] Challenge window is still open.")
        self._settle_winner(room)

    def _now_epoch(self) -> int:
        raw = gl.message_raw["datetime"]
        if hasattr(raw, "timestamp"):
            return int(raw.timestamp())
        import datetime as _dt
        return int(_dt.datetime.fromisoformat(str(raw).replace("Z", "+00:00")).timestamp())

    def _enter_provisional(self, room: RiddleRoom, winner: Address):
        room.status = "provisional"
        room.winner = winner
        room.provisional_at = u256(self._now_epoch())
        self.rooms[room.id] = room
        if self.credit_ledger != ZERO_ADDRESS and int(room.stake) > 0:
            CreditLedgerIface(self.credit_ledger).emit(on="accepted").set_provisional(room.id, winner)

    def _open_escrow_if_staked(self, room: RiddleRoom):
        if self.credit_ledger == ZERO_ADDRESS:
            return
        if int(room.stake) <= 0:
            return
        CreditLedgerIface(self.credit_ledger).emit(on="accepted").open_escrow(
            room.id, MODE, room.owner, room.opponent, room.stake
        )

    def _settle_winner(self, room: RiddleRoom):
        room.status = "resolved"
        self.rooms[room.id] = room
        loser = self._resolved_loser(room)
        if self.credit_ledger != ZERO_ADDRESS and int(room.stake) > 0:
            CreditLedgerIface(self.credit_ledger).emit(on="accepted").finalize_winner(room.id, room.winner)
        self._emit_profile_result(room.id, room.winner, loser, self._wager_bonus_xp(room))

    def _wager_bonus_xp(self, room: RiddleRoom) -> int:
        # Wagered wins are worth more: +1 XP per credit staked, capped (base win XP is 100).
        return min(int(room.stake) // (10 ** 18), 200)

    def _settle_void(self, room: RiddleRoom):
        if self.credit_ledger != ZERO_ADDRESS and int(room.stake) > 0:
            CreditLedgerIface(self.credit_ledger).emit(on="accepted").finalize_void(room.id)

    def _settle_tie(self, room: RiddleRoom):
        if self.credit_ledger != ZERO_ADDRESS and int(room.stake) > 0:
            CreditLedgerIface(self.credit_ledger).emit(on="accepted").finalize_tie(room.id)

    def _build_appeal_prompt(self, room: RiddleRoom) -> str:
        evidence_note = (
            "The losing player attached an image as evidence; it is provided alongside this "
            "prompt. Judge whether the attached image actually supports the stated reason — "
            "ignore the claim if the image does not corroborate it.\n"
            if room.evidence_uri
            else "No image evidence was attached; judge on the written reason alone.\n"
        )
        return f"""APPEAL REVIEW — you are the impartial judge for a wager match.

A provisional result was reached in a riddle match. The losing player has appealed.
Decide whether the provisional result should stand ("upheld") or be voided and stakes
refunded ("overturned").

Overturn ONLY when the appeal shows the result was unfair due to a genuine technical
fault (e.g., a verified disconnect that prevented play), NOT mere disagreement.

{evidence_note}Provisional verdict reasoning: {room.verdict_reasoning}
Owner score: {int(room.owner_score)}  Opponent score: {int(room.opponent_score)}
Appeal reason from the losing player: {room.appeal_reason}

Return JSON: {{"decision": "upheld" | "overturned", "reasoning": "<one or two sentences>"}}"""

    def _appeal_errors_agree(self, leaders_res: gl.vm.Result, leader_fn: typing.Callable) -> bool:
        # Validator path for when the leader returned an error rather than a decision.
        # Deterministic faults ([EXPECTED]/[EXTERNAL]) must match exactly; a transient
        # gateway failure ([TRANSIENT]) agrees if the validator hit one too; anything
        # else (LLM misbehavior) disagrees to force rotation.
        leader_msg = leaders_res.message if hasattr(leaders_res, "message") else ""
        try:
            leader_fn()
            return False  # leader errored, validator succeeded -> disagree
        except gl.vm.UserError as e:
            validator_msg = e.message if hasattr(e, "message") else str(e)
            if validator_msg.startswith("[EXPECTED]") or validator_msg.startswith("[EXTERNAL]"):
                return validator_msg == leader_msg
            if validator_msg.startswith("[TRANSIENT]") and leader_msg.startswith("[TRANSIENT]"):
                return True
            return False
        except Exception:
            return False

    def _normalize_appeal(self, response: typing.Any) -> typing.Dict[str, str]:
        if not isinstance(response, dict):
            raise gl.vm.UserError("[LLM_ERROR] Appeal response was not a JSON object.")
        raw = str(response.get("decision", "")).strip().lower()
        if raw not in ["upheld", "overturned"]:
            if raw in ["uphold", "stand", "valid", "deny", "denied", "reject", "rejected"]:
                raw = "upheld"
            elif raw in ["overturn", "void", "refund", "grant", "granted", "accept", "accepted"]:
                raw = "overturned"
            else:
                raise gl.vm.UserError(f"[LLM_ERROR] Unrecognized appeal decision: {raw}")
        reasoning = str(response.get("reasoning", "")).strip()
        if not reasoning:
            reasoning = "No reasoning provided."
        return {"decision": raw, "reasoning": reasoning}

    def _emit_profile_result(self, room_id: str, winner: Address, loser: Address, bonus_xp: int = 0):

        if self.core_contract == ZERO_ADDRESS:
            return
        winner = self._normalize_address(winner)
        loser = self._normalize_address(loser)
        if winner == ZERO_ADDRESS or loser == ZERO_ADDRESS:
            return

        match_id = self._match_id(room_id)
        core = self._core()
        core.emit(on="accepted").apply_match_result(winner, match_id, True, MODE, u16(int(bonus_xp)))
        core.emit(on="accepted").apply_match_result(loser, match_id, False, MODE, u16(0))

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
