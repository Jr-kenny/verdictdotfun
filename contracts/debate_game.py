# { "Depends": "py-genlayer:1jb45aa8ynh2a9c9xn3b7qqh8sm5q93hwfp7jqmwsfhh8jpz09h6" }

from dataclasses import dataclass
import typing

try:
    from genlayer import *
except ModuleNotFoundError:
    from genlayer_py import *


ZERO_ADDRESS = Address("0x0000000000000000000000000000000000000000")
MODE = "debate"
WINNER_XP = u256(20)
LOSER_PENALTY_XP = u256(5)


@gl.evm.contract_interface
class ProfileNft:
    class View:
        def has_profile(self, owner: Address, /) -> bool: ...
        def get_handle(self, owner: Address, /) -> str: ...

    class Write:
        def apply_match_result(
            self,
            match_id: str,
            winner: Address,
            loser: Address,
            winner_xp: u256,
            loser_penalty: u256,
            mode: str,
            /,
        ) -> None: ...


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
    profile_contract: Address
    local_profiles: TreeMap[Address, LocalProfile]
    rooms: TreeMap[str, DebateRoom]
    room_ids: DynArray[str]

    def __init__(self, profile_contract: str = "0x0000000000000000000000000000000000000000"):
        self.owner = gl.message.sender_address
        self.profile_contract = Address(profile_contract)

        root = gl.storage.Root.get()
        root.upgraders.get().append(gl.message.sender_address)

    @gl.public.write
    def register_profile(self, name: str):
        if self.profile_contract != ZERO_ADDRESS:
            raise Exception("Local profile registration is disabled when an external profile NFT is configured.")

        clean_name = name.strip()
        if len(clean_name) < 3:
            raise Exception("Profile names must be at least 3 characters.")
        if len(clean_name) > 24:
            raise Exception("Profile names must be 24 characters or fewer.")

        self.local_profiles[gl.message.sender_address] = LocalProfile(clean_name)

    @gl.public.write
    def set_profile_contract(self, profile_contract: str):
        self._require_owner()
        self.profile_contract = Address(profile_contract)

    @gl.public.write
    def create_room(self, room_id: str, category: str, prompt: str):
        sender = gl.message.sender_address
        normalized_id = room_id.strip().upper()
        normalized_category = category.strip()
        normalized_prompt = prompt.strip()

        if not normalized_id:
            raise Exception("Room id is required.")
        if normalized_id in self.rooms:
            raise Exception("Room already exists.")
        if len(normalized_prompt) < 12:
            raise Exception("Debate prompts must be at least 12 characters.")

        self.rooms[normalized_id] = DebateRoom(
            id=normalized_id,
            mode=MODE,
            owner=sender,
            owner_name=self._require_player_name(sender),
            opponent=ZERO_ADDRESS,
            opponent_name="",
            category=normalized_category,
            prompt=normalized_prompt,
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
    def join_room(self, room_id: str):
        sender = gl.message.sender_address
        room = self._require_room(room_id)

        if room.owner == sender:
            raise Exception("The proposer cannot join as the opposer.")
        if room.opponent != ZERO_ADDRESS:
            raise Exception("Room already has an opposer.")

        room.opponent = sender
        room.opponent_name = self._require_player_name(sender)
        room.status = "active" if room.owner_submission and room.opponent_submission else "waiting"
        self.rooms[room.id] = room

    @gl.public.write
    def submit_entry(self, room_id: str, submission: str):
        sender = gl.message.sender_address
        room = self._require_room(room_id)
        text = submission.strip()

        if room.status == "resolved":
            raise Exception("Resolved rooms cannot be edited.")
        if len(text) < 40:
            raise Exception("Debate submissions must be at least 40 characters.")

        if sender == room.owner:
            room.owner_submission = text
        elif sender == room.opponent:
            room.opponent_submission = text
        else:
            raise Exception("Only debate participants can submit.")

        room.status = "active" if room.owner_submission and room.opponent_submission else "waiting"
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
    def upgrade(self, new_code: bytes):
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
    def get_profile_contract(self) -> Address:
        return self.profile_contract

    def _require_room(self, room_id: str) -> DebateRoom:
        normalized_id = room_id.strip().upper()
        if normalized_id not in self.rooms:
            raise Exception("Room does not exist.")
        return self.rooms[normalized_id]

    def _require_owner(self):
        if gl.message.sender_address != self.owner:
            raise Exception("Only the contract owner can perform this action.")

    def _require_player_name(self, address: Address) -> str:
        if self.profile_contract != ZERO_ADDRESS:
            profile = ProfileNft(self.profile_contract)
            if not profile.view().has_profile(address):
                raise Exception("Mint a profile NFT before joining this game.")

            handle = profile.view().get_handle(address).strip()
            if not handle:
                raise Exception("Profile NFT did not return a valid handle.")
            return handle

        if address not in self.local_profiles or not self.local_profiles[address].name:
            raise Exception("Create a local profile before interacting with the debate game.")

        return self.local_profiles[address].name

    def _emit_profile_result(self, room_id: str, winner: Address, loser: Address):
        if self.profile_contract == ZERO_ADDRESS:
            return

        ProfileNft(self.profile_contract).emit().apply_match_result(
            f"{MODE}:{room_id}",
            winner,
            loser,
            WINNER_XP,
            LOSER_PENALTY_XP,
            MODE,
        )

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

Category: {room.category}
Prompt:
{room.prompt}

Proposer ({room.owner_name}) submission:
{room.owner_submission}

Opposer ({room.opponent_name}) submission:
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
