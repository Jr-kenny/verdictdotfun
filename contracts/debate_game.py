# { "Depends": "py-genlayer:1jb45aa8ynh2a9c9xn3b7qqh8sm5q93hwfp7jqmwsfhh8jpz09h6" }

from dataclasses import dataclass
import typing

try:
    from genlayer import *
except ModuleNotFoundError:
    from genlayer_py import *


ZERO_ADDRESS = Address("0x0000000000000000000000000000000000000000")
MODE = "debate"


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
class DebateRoom:
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


class DebateGame(gl.Contract):
    owner: Address
    profile_factory: Address
    single_room_only: bool
    local_profiles: TreeMap[Address, LocalProfile]
    rooms: TreeMap[str, DebateRoom]
    room_ids: DynArray[str]

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
            raise Exception("This debate room contract is already initialized.")
        if not normalized_id:
            raise Exception("Room id is required.")
        if normalized_id in self.rooms:
            raise Exception("Room already exists.")
        if not normalized_category:
            raise Exception("Category is required.")

        owner_name = self._require_player_name(owner_profile)
        room_owner = owner_profile if self.profile_factory != ZERO_ADDRESS else gl.message.sender_address
        prompt = self._generate_prompt(normalized_id, normalized_category)

        self.rooms[normalized_id] = DebateRoom(
            id=normalized_id,
            mode=MODE,
            owner=room_owner,
            owner_name=owner_name,
            opponent=ZERO_ADDRESS,
            opponent_name="",
            category=normalized_category,
            prompt=prompt,
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

        join_identity = opponent_profile if self.profile_factory != ZERO_ADDRESS else gl.message.sender_address

        if room.owner == join_identity:
            raise Exception("The proposer cannot join as the opposer.")
        if room.opponent != ZERO_ADDRESS:
            raise Exception("Room already has an opposer.")

        self._require_profile_owner(opponent_profile)
        room.opponent = join_identity
        room.opponent_name = self._require_player_name(opponent_profile)
        room.status = "active" if room.owner_submission and room.opponent_submission else "waiting"
        self.rooms[room.id] = room

    @gl.public.write
    def submit_entry(self, room_id: str, submission: str):
        room = self._require_room(room_id)
        text = submission.strip()

        if room.status == "resolved":
            raise Exception("Resolved rooms cannot be edited.")
        if len(text) < 40:
            raise Exception("Debate submissions must be at least 40 characters.")

        role = self._participant_role(room)

        if role == "owner":
            if room.owner_submission:
                raise Exception("You already submitted your debate case.")
            room.owner_submission = text
        else:
            if room.opponent_submission:
                raise Exception("You already submitted your debate case.")
            room.opponent_submission = text

        if room.owner_submission and room.opponent_submission:
            room.status = "active"
            self._finalize_room(room)
            return

        room.status = "waiting"
        self.rooms[room.id] = room

    @gl.public.write
    def resolve_room(self, room_id: str):
        room = self._require_room(room_id)

        if room.opponent == ZERO_ADDRESS:
            raise Exception("A debate needs both a proposer and an opposer.")
        if not room.owner_submission or not room.opponent_submission:
            raise Exception("Both sides must submit before the debate can be judged.")
        if room.status == "resolved":
            raise Exception("Room already has a verdict.")

        self._finalize_room(room)

    def _finalize_room(self, room: DebateRoom):
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
            raise Exception("A debate needs two players before someone can quit.")

        role = self._participant_role(room)
        quitter = room.owner if role == "owner" else room.opponent
        winner = room.opponent if role == "owner" else room.owner
        winner_name = room.opponent_name if role == "owner" else room.owner_name
        quitter_name = room.owner_name if role == "owner" else room.opponent_name

        room.status = "resolved"
        room.winner = winner
        room.owner_score = u16(0 if role == "owner" else 100)
        room.opponent_score = u16(100 if role == "owner" else 0)
        room.verdict_reasoning = f"{quitter_name} quit the debate, so {winner_name} wins by forfeit."
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
            DebateRoom(
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
            ),
        )

    @gl.public.view
    def get_room_ids(self) -> DynArray[str]:
        return self.room_ids

    @gl.public.view
    def get_profile_factory(self) -> Address:
        return self.profile_factory

    def _factory(self) -> ProfileFactory:
        if self.profile_factory == ZERO_ADDRESS:
            raise Exception("Profile factory is not configured.")
        return ProfileFactory(self.profile_factory)

    def _generate_prompt(self, room_id: str, category: str) -> str:
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
            return self._normalize_generated_prompt(response)

        def validator_fn(leader_result):
            if not isinstance(leader_result, gl.vm.Return):
                return False
            return self._is_valid_generated_prompt(leader_result.calldata)

        generated = gl.vm.run_nondet_unsafe(leader_fn, validator_fn)
        return generated["prompt"]

    def _normalize_generated_prompt(self, response: typing.Any) -> TreeMap[str, str]:
        if not isinstance(response, dict):
            raise Exception("Prompt generation returned a non-dict payload.")

        prompt = str(response.get("prompt", "")).strip()
        if len(prompt) < 16:
            raise Exception("Generated debate prompt is too short.")
        if len(prompt) > 220:
            raise Exception("Generated debate prompt is too long.")

        return {"prompt": prompt}

    def _is_valid_generated_prompt(self, payload: typing.Any) -> bool:
        if not isinstance(payload, dict):
            return False

        prompt = payload.get("prompt")
        if not isinstance(prompt, str):
            return False

        cleaned = prompt.strip()
        return 16 <= len(cleaned) <= 220

    def _require_room(self, room_id: str) -> DebateRoom:
        normalized_id = room_id.strip().upper()
        if normalized_id not in self.rooms:
            raise Exception("Room does not exist.")
        return self.rooms[normalized_id]

    def _require_owner(self):
        if gl.message.sender_address != self.owner:
            raise Exception("Only the contract owner can perform this action.")

    def _require_profile_owner(self, profile_address: Address) -> Address:
        if self.profile_factory == ZERO_ADDRESS:
            if gl.message.sender_address not in self.local_profiles:
                raise Exception("Create a local profile before interacting with the debate game.")
            return gl.message.sender_address

        profile_address = self._normalize_address(profile_address)
        factory = self._factory()
        if not factory.view().is_registered_profile(profile_address):
            raise Exception("Register a profile before interacting with this game.")

        owner = factory.view().get_profile_owner(profile_address)
        if gl.message.sender_address == self.profile_factory:
            return owner
        if owner != gl.message.sender_address:
            raise Exception("Only the current holder of this profile can perform that action.")
        return owner

    def _require_player_name(self, profile_address: Address) -> str:
        if self.profile_factory == ZERO_ADDRESS:
            profile = self.local_profiles.get(gl.message.sender_address)
            if profile and profile.name:
                return profile.name
            raise Exception("Create a local profile before interacting with the debate game.")

        profile_address = self._normalize_address(profile_address)
        self._require_profile_owner(profile_address)
        handle = PlayerProfile(profile_address).view().get_handle().strip()
        if not handle:
            raise Exception("Profile did not return a valid handle.")
        return handle

    def _participant_role(self, room: DebateRoom) -> str:
        sender = gl.message.sender_address
        if self.profile_factory == ZERO_ADDRESS:
            if room.owner == sender:
                return "owner"
            if room.opponent == sender:
                return "opponent"
            raise Exception("Only debate participants can submit.")

        factory = self._factory()

        if room.owner != ZERO_ADDRESS and factory.view().get_profile_owner(room.owner) == sender:
            return "owner"
        if room.opponent != ZERO_ADDRESS and factory.view().get_profile_owner(room.opponent) == sender:
            return "opponent"
        raise Exception("Only debate participants can submit.")

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

    def _resolved_loser(self, room: DebateRoom) -> Address:
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

    def _build_verdict_prompt(self, room: DebateRoom) -> str:
        return f"""
You are judging a DebateGame room for Verdict Arena.
Return valid JSON only with these keys:
- "winner": either "owner" or "opponent"
- "owner_score": integer 0-100
- "opponent_score": integer 0-100
- "reasoning": short explanation under 280 characters

Rules:
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
