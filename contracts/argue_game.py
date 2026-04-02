# { "Depends": "py-genlayer:1jb45aa8ynh2a9c9xn3b7qqh8sm5q93hwfp7jqmwsfhh8jpz09h6" }

from dataclasses import dataclass
import typing

try:
    from genlayer import *
except ModuleNotFoundError:
    from genlayer_py import *


ZERO_ADDRESS = Address("0x0000000000000000000000000000000000000000")
MODE = "argue"


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
class ArgueRoom:
    id: str
    mode: str
    argue_style: str
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


class ArgueGame(gl.Contract):
    owner: Address
    core_contract: Address
    single_room_only: bool
    local_profiles: TreeMap[Address, LocalProfile]
    rooms: TreeMap[str, ArgueRoom]
    room_ids: DynArray[str]

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
    def create_room(self, room_id: str, category: str, owner_profile: Address = ZERO_ADDRESS, argue_style: str = "debate"):
        owner_profile = self._normalize_address(owner_profile)
        normalized_id = room_id.strip().upper()
        normalized_category = self._normalize_category(category)
        normalized_style = self._normalize_argue_style(argue_style)

        if self.single_room_only and len(self.room_ids) > 0:
            raise Exception("This argue room contract is already initialized.")
        if not normalized_id:
            raise Exception("Room id is required.")
        if normalized_id in self.rooms:
            return
        if not normalized_category:
            raise Exception("Category is required.")

        owner_name = self._require_player_name(owner_profile)
        room_owner = owner_profile if self.core_contract != ZERO_ADDRESS else gl.message.sender_address

        self.rooms[normalized_id] = ArgueRoom(
            id=normalized_id,
            mode=MODE,
            argue_style=normalized_style,
            owner=room_owner,
            owner_name=owner_name,
            opponent=ZERO_ADDRESS,
            opponent_name="",
            category=normalized_category,
            prompt="",
            house_stance="",
            owner_submission="",
            opponent_submission="",
            status="waiting",
            winner=ZERO_ADDRESS,
            owner_score=u16(0),
            opponent_score=u16(0),
            verdict_reasoning="",
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
        room.status = "ready_to_start"
        self.rooms[room.id] = room

    @gl.public.write
    def submit_entry(self, room_id: str, submission: str):
        room = self._require_room(room_id)
        text = submission.strip()

        if room.status == "resolved":
            raise Exception("Resolved rooms cannot be edited.")
        if room.opponent == ZERO_ADDRESS:
            raise Exception("An argue room needs two players.")
        if not room.prompt or room.status == "ready_to_start":
            raise Exception("Start the room before submitting.")
        if room.status != "active":
            raise Exception("This argue room is not accepting submissions.")
        if len(text) < 40:
            raise Exception("Arguments must be at least 40 characters.")

        role = self._participant_role(room)
        if role == "owner":
            if room.owner_submission:
                raise Exception("You already submitted your argument.")
            room.owner_submission = text
        else:
            if room.opponent_submission:
                raise Exception("You already submitted your argument.")
            room.opponent_submission = text

        if room.owner_submission and room.opponent_submission:
            self._finalize_room(room)
            return

        self.rooms[room.id] = room

    @gl.public.write
    def start_room(self, room_id: str):
        room = self._require_room(room_id)

        if room.status == "resolved":
            raise Exception("Room already has a verdict.")
        if room.opponent == ZERO_ADDRESS:
            raise Exception("An argue room needs two players.")
        if room.prompt:
            raise Exception("Room already started.")

        self._require_room_owner(room)
        generated = self._generate_material(room.argue_style, room.id, room.category)
        room.prompt = generated["prompt"]
        room.house_stance = generated["house_stance"]
        room.status = "active"
        self.rooms[room.id] = room

    @gl.public.write
    def resolve_room(self, room_id: str):
        room = self._require_room(room_id)

        if room.opponent == ZERO_ADDRESS:
            raise Exception("An argue room needs two players.")
        if not room.prompt:
            raise Exception("Start the room before resolving it.")
        if not room.owner_submission or not room.opponent_submission:
            raise Exception("Both players must submit before resolution.")
        if room.status == "resolved":
            raise Exception("Room already has a verdict.")

        self._finalize_room(room)

    def _finalize_room(self, room: ArgueRoom):
        if room.status == "resolved":
            raise Exception("Room already has a verdict.")

        prompt = self._build_verdict_prompt(room)

        def leader_fn():
            response = gl.nondet.exec_prompt(prompt, response_format="json")
            return self._normalize_verdict(response)

        def validator_fn(leader_result):
            if not isinstance(leader_result, gl.vm.Return):
                return False
            return self._is_valid_verdict(leader_result.calldata)

        verdict = gl.vm.run_nondet_unsafe(leader_fn, validator_fn)
        loser = room.opponent if verdict["winner"] == "owner" else room.owner

        room.status = "resolved"
        room.winner = room.owner if verdict["winner"] == "owner" else room.opponent
        room.owner_score = verdict["owner_score"]
        room.opponent_score = verdict["opponent_score"]
        room.verdict_reasoning = verdict["reasoning"]
        self.rooms[room.id] = room

        self._emit_profile_result(room.id, room.winner, loser)

    @gl.public.write
    def forfeit_room(self, room_id: str):
        room = self._require_room(room_id)

        if room.status == "resolved":
            raise Exception("Room already has a verdict.")
        if room.opponent == ZERO_ADDRESS:
            raise Exception("An argue room needs two players before someone can quit.")

        role = self._participant_role(room)
        quitter = room.owner if role == "owner" else room.opponent
        winner = room.opponent if role == "owner" else room.owner
        winner_name = room.opponent_name if role == "owner" else room.owner_name
        quitter_name = room.owner_name if role == "owner" else room.opponent_name

        room.status = "resolved"
        room.winner = winner
        room.owner_score = u16(0 if role == "owner" else 100)
        room.opponent_score = u16(100 if role == "owner" else 0)
        room.verdict_reasoning = f"{quitter_name} quit the room, so {winner_name} wins by forfeit."
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
            ArgueRoom(
                id="",
                mode=MODE,
                argue_style="debate",
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

    def _generate_material(self, argue_style: str, room_id: str, category: str) -> TreeMap[str, str]:
        if argue_style == "convince":
            return self._generate_convince_material(room_id, category)
        return self._generate_debate_material(room_id, category)

    def _generate_debate_material(self, room_id: str, category: str) -> TreeMap[str, str]:
        generation_prompt = f"""
Generate one sharp debate motion for a two-player on-chain game.
Return valid JSON only with this key:
- "prompt": one debate motion, between 16 and 220 characters

Rules:
- Category: {category}
- The motion must feel original, specific, and arguable.
- It must create a clear proposition one side can support and the other can oppose.
- Do not output lists, numbering, or explanation.
- Avoid meta references to AI judging, blockchains, or the game itself unless the category naturally implies it.
- Use the room seed "{room_id}" to vary the result.
        """.strip()

        def leader_fn():
            response = gl.nondet.exec_prompt(generation_prompt, response_format="json")
            return self._normalize_generated_debate(response)

        def validator_fn(leader_result):
            if not isinstance(leader_result, gl.vm.Return):
                return False
            return self._is_valid_generated_debate(leader_result.calldata)

        return gl.vm.run_nondet_unsafe(leader_fn, validator_fn)

    def _generate_convince_material(self, room_id: str, category: str) -> TreeMap[str, str]:
        generation_prompt = f"""
Generate a "Convince Me" challenge for a two-player on-chain persuasion game.
Return valid JSON only with these keys:
- "prompt": what the contract wants the players to persuade it about, 24-220 characters
- "house_stance": the contract's starting position, 24-220 characters

Rules:
- Category: {category}
- The prompt must describe a concrete claim, proposal, or position to argue around.
- The house stance must be skeptical or resistant, but not identical to the prompt.
- The challenge should feel original and not like a stock template.
- Do not output lists, numbering, or explanation.
- Use the room seed "{room_id}" to vary the result.
        """.strip()

        def leader_fn():
            response = gl.nondet.exec_prompt(generation_prompt, response_format="json")
            return self._normalize_generated_convince(response)

        def validator_fn(leader_result):
            if not isinstance(leader_result, gl.vm.Return):
                return False
            return self._is_valid_generated_convince(leader_result.calldata)

        return gl.vm.run_nondet_unsafe(leader_fn, validator_fn)

    def _normalize_generated_debate(self, response: typing.Any) -> TreeMap[str, str]:
        if not isinstance(response, dict):
            raise Exception("Debate generation returned a non-dict payload.")

        prompt = str(response.get("prompt", "")).strip()
        if len(prompt) < 16:
            raise Exception("Generated debate prompt is too short.")
        if len(prompt) > 220:
            raise Exception("Generated debate prompt is too long.")

        return {"prompt": prompt, "house_stance": ""}

    def _is_valid_generated_debate(self, payload: typing.Any) -> bool:
        if not isinstance(payload, dict):
            return False
        prompt = payload.get("prompt")
        if not isinstance(prompt, str):
            return False
        cleaned = prompt.strip()
        return 16 <= len(cleaned) <= 220

    def _normalize_generated_convince(self, response: typing.Any) -> TreeMap[str, str]:
        if not isinstance(response, dict):
            raise Exception("Convince generation returned a non-dict payload.")

        prompt = str(response.get("prompt", "")).strip()
        house_stance = str(response.get("house_stance", "")).strip()
        if len(prompt) < 24 or len(prompt) > 220:
            raise Exception("Generated convince prompt is invalid.")
        if len(house_stance) < 24 or len(house_stance) > 220:
            raise Exception("Generated house stance is invalid.")

        return {"prompt": prompt, "house_stance": house_stance}

    def _is_valid_generated_convince(self, payload: typing.Any) -> bool:
        if not isinstance(payload, dict):
            return False
        prompt = payload.get("prompt")
        house_stance = payload.get("house_stance")
        if not isinstance(prompt, str) or not isinstance(house_stance, str):
            return False
        return 24 <= len(prompt.strip()) <= 220 and 24 <= len(house_stance.strip()) <= 220

    def _require_room(self, room_id: str) -> ArgueRoom:
        normalized_id = room_id.strip().upper()
        if normalized_id not in self.rooms:
            raise Exception("Room does not exist.")
        return self.rooms[normalized_id]

    def _require_owner(self):
        if gl.message.sender_address != self.owner:
            raise Exception("Only the contract owner can perform this action.")

    def _require_profile_owner(self, profile_address: Address) -> Address:
        if self.core_contract == ZERO_ADDRESS:
            if gl.message.sender_address not in self.local_profiles:
                raise Exception("Create a local profile before interacting with the argue game.")
            return gl.message.sender_address

        profile_address = self._normalize_address(profile_address)
        core = self._core()
        if not core.view().is_registered_profile(profile_address):
            raise Exception("Register a profile before interacting with this game.")

        owner = core.view().get_profile_owner(profile_address)
        if gl.message.sender_address == self.core_contract:
            return owner
        if owner != gl.message.sender_address:
            raise Exception("Only the current holder of this profile can perform that action.")
        return owner

    def _require_player_name(self, profile_address: Address) -> str:
        if self.core_contract == ZERO_ADDRESS:
            profile = self.local_profiles.get(gl.message.sender_address)
            if profile and profile.name:
                return profile.name
            raise Exception("Create a local profile before interacting with the argue game.")

        profile_address = self._normalize_address(profile_address)
        self._require_profile_owner(profile_address)
        core = self._core()
        profile = core.view().get_profile_by_address(profile_address)
        handle = str(profile.get("handle", "")).strip()
        if not handle:
            raise Exception("Profile did not return a valid handle.")
        return handle

    def _participant_role(self, room: ArgueRoom) -> str:
        sender = gl.message.sender_address
        if self.core_contract == ZERO_ADDRESS:
            if room.owner == sender:
                return "owner"
            if room.opponent == sender:
                return "opponent"
            raise Exception("Only room participants can submit.")

        core = self._core()
        if room.owner != ZERO_ADDRESS and core.view().get_profile_owner(room.owner) == sender:
            return "owner"
        if room.opponent != ZERO_ADDRESS and core.view().get_profile_owner(room.opponent) == sender:
            return "opponent"
        raise Exception("Only room participants can submit.")

    def _require_room_owner(self, room: ArgueRoom):
        sender = gl.message.sender_address
        if self.core_contract == ZERO_ADDRESS:
            if room.owner != sender:
                raise Exception("Only the room owner can start this room.")
            return

        core = self._core()
        if room.owner == ZERO_ADDRESS or core.view().get_profile_owner(room.owner) != sender:
            raise Exception("Only the room owner can start this room.")

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

    def _resolved_loser(self, room: ArgueRoom) -> Address:
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

    def _normalize_argue_style(self, argue_style: str) -> str:
        normalized = argue_style.strip().lower()
        if normalized in ("debate", "convince"):
            return normalized
        raise Exception("Unsupported argue style.")

    def _build_verdict_prompt(self, room: ArgueRoom) -> str:
        if room.argue_style == "convince":
            return f"""
You are judging an ArgueGame room for Verdict Arena.
Return valid JSON only with these keys:
- "winner": either "owner" or "opponent"
- "owner_score": integer 0-100
- "opponent_score": integer 0-100
- "reasoning": short explanation under 280 characters

Rules:
- This room uses the convince style.
- The contract starts from the house stance below.
- Both players are trying to move the judge away from that stance.
- Reward the submission that most effectively changes the judge's mind.
- Reward specificity, emotional intelligence, practical examples, and persuasive framing.
- Penalize generic praise, shallow slogans, and arguments that ignore the stated bias.
- Choose exactly one winner. No ties.
- In the "reasoning" field, refer to the players by their registered handles exactly as "{room.owner_name}" and "{room.opponent_name}".
- Never call them owner, opponent, player one, or player two inside the reasoning text.

House stance:
{room.house_stance}

Scenario:
{room.prompt}

{room.owner_name} submission:
{room.owner_submission}

{room.opponent_name} submission:
{room.opponent_submission}
            """.strip()

        return f"""
You are judging an ArgueGame room for Verdict Arena.
Return valid JSON only with these keys:
- "winner": either "owner" or "opponent"
- "owner_score": integer 0-100
- "opponent_score": integer 0-100
- "reasoning": short explanation under 280 characters

Rules:
- This room uses the debate style.
- The owner is the proposer. The opponent is the opposer.
- Judge who makes the stronger case, not who is objectively truthful.
- Reward structure, rebuttal quality, evidence, and direct engagement.
- Penalize dodging, contradiction, weak support, and empty rhetoric.
- Choose exactly one winner. No ties.
- In the "reasoning" field, refer to the players by their registered handles exactly as "{room.owner_name}" and "{room.opponent_name}".
- Never call them proposer, opposer, owner, opponent, player one, or player two inside the reasoning text.

Category: {room.category}
Prompt:
{room.prompt}

{room.owner_name} submission:
{room.owner_submission}

{room.opponent_name} submission:
{room.opponent_submission}
        """.strip()

    def _normalize_verdict(self, response: typing.Any) -> TreeMap[str, typing.Any]:
        if not isinstance(response, dict):
            raise Exception("LLM returned a non-dict verdict.")

        winner = str(response.get("winner", "")).strip().lower()
        if winner not in ("owner", "opponent"):
            raise Exception("Verdict winner must be 'owner' or 'opponent'.")

        owner_score = self._coerce_score(response.get("owner_score"))
        opponent_score = self._coerce_score(response.get("opponent_score"))
        reasoning = str(response.get("reasoning", "")).strip()
        if len(reasoning) < 16:
            raise Exception("Verdict reasoning is too short.")

        if winner == "owner" and owner_score <= opponent_score:
            owner_score = min(100, opponent_score + 1)
        if winner == "opponent" and opponent_score <= owner_score:
            opponent_score = min(100, owner_score + 1)

        return {
            "winner": winner,
            "owner_score": u16(owner_score),
            "opponent_score": u16(opponent_score),
            "reasoning": reasoning,
        }

    def _is_valid_verdict(self, verdict: typing.Any) -> bool:
        if not isinstance(verdict, dict):
            return False

        winner = verdict.get("winner")
        owner_score = verdict.get("owner_score")
        opponent_score = verdict.get("opponent_score")
        reasoning = verdict.get("reasoning")

        if winner not in ("owner", "opponent"):
            return False
        if not isinstance(reasoning, str) or len(reasoning.strip()) < 16:
            return False
        if not isinstance(owner_score, int) or not isinstance(opponent_score, int):
            return False
        if owner_score < 0 or owner_score > 100 or opponent_score < 0 or opponent_score > 100:
            return False
        if winner == "owner" and owner_score <= opponent_score:
            return False
        if winner == "opponent" and opponent_score <= owner_score:
            return False
        return True

    def _coerce_score(self, raw_score: typing.Any) -> int:
        try:
            score = int(round(float(str(raw_score).strip())))
        except (ValueError, TypeError):
            raise Exception("Verdict score must be numeric.")

        if score < 0 or score > 100:
            raise Exception("Verdict scores must be between 0 and 100.")
        return score

    def _normalize_address(self, value: typing.Any) -> Address:
        if isinstance(value, Address):
            return value
        if isinstance(value, bytes):
            return Address(value)
        if hasattr(value, "as_bytes"):
            return Address(value.as_bytes)
        return Address(value)
