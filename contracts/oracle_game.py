# { "Depends": "py-genlayer:1jb45aa8ynh2a9c9xn3b7qqh8sm5q93hwfp7jqmwsfhh8jpz09h6" }

from dataclasses import dataclass
import typing

try:
    from genlayer import *
except ModuleNotFoundError:
    from genlayer_py import *


ZERO_ADDRESS = Address("0x0000000000000000000000000000000000000000")
MODE = "oracle"
CHALLENGE_WINDOW_SECONDS = 3600

# Appeal image-evidence constants (identical to argue; appeals reuse the vision path).
EVIDENCE_GATEWAY = "https://ipfs.io/ipfs/"
MAX_CID_LEN = 100
MIN_CID_LEN = 16
MAX_EVIDENCE_BYTES = 5 * 1024 * 1024  # 5 MiB

_IMAGE_MAGICS = (
    b"\x89PNG\r\n\x1a\n",
    b"\xff\xd8\xff",
    b"GIF87a",
    b"GIF89a",
)


def _is_supported_image(data: bytes) -> bool:
    if any(data.startswith(magic) for magic in _IMAGE_MAGICS):
        return True
    return len(data) >= 12 and data[0:4] == b"RIFF" and data[8:12] == b"WEBP"


@gl.contract_interface
class VerdictDotFunCore:
    class View:
        def get_profile_owner(self, profile: Address, /) -> Address: ...
        def is_registered_profile(self, profile: Address, /) -> bool: ...
        def get_profile_by_address(self, profile: Address, /) -> TreeMap[str, typing.Any]: ...

    class Write:
        def apply_match_result(self, profile: Address, match_id: str, did_win: bool, mode: str, bonus_xp: u16 = u16(0), /) -> None: ...


@gl.contract_interface
class CreditLedgerIface:
    class Write:
        def open_escrow(self, room_id: str, mode: str, player_a: Address, player_b: Address, atto_stake: u256, /) -> None: ...
        def set_provisional(self, room_id: str, winner: Address, /) -> None: ...
        def finalize_winner(self, room_id: str, winner: Address, /) -> None: ...
        def finalize_void(self, room_id: str, /) -> None: ...


@allow_storage
@dataclass
class LocalProfile:
    name: str


@allow_storage
@dataclass
class OracleRoom:
    id: str
    mode: str
    owner: Address
    owner_name: str
    opponent: Address
    opponent_name: str
    category: str
    question: str
    source: str
    outcome: str
    status: str
    winner: Address
    owner_score: u16
    opponent_score: u16
    verdict_reasoning: str
    stake: u256
    provisional_at: u256
    appeal_state: str
    appeal_reason: str
    appeal_result: str
    evidence_uri: str


class OracleGame(gl.Contract):
    owner: Address
    core_contract: Address
    single_room_only: bool
    local_profiles: TreeMap[Address, LocalProfile]
    rooms: TreeMap[str, OracleRoom]
    room_ids: DynArray[str]
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
            raise gl.vm.UserError("[EXPECTED] Profile names must be at least 3 characters.")
        if len(clean_name) > 24:
            raise gl.vm.UserError("[EXPECTED] Profile names must be 24 characters or fewer.")
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
            raise gl.vm.UserError("[EXPECTED] This oracle room contract is already initialized.")
        if not normalized_id:
            raise gl.vm.UserError("[EXPECTED] Room id is required.")
        if normalized_id in self.rooms:
            return
        if not normalized_category:
            raise gl.vm.UserError("[EXPECTED] Category is required.")

        owner_name = self._require_player_name(owner_profile)
        room_owner = owner_profile if self.core_contract != ZERO_ADDRESS else gl.message.sender_address

        self.rooms[normalized_id] = OracleRoom(
            id=normalized_id, mode=MODE, owner=room_owner, owner_name=owner_name,
            opponent=ZERO_ADDRESS, opponent_name="", category=normalized_category,
            question="", source="", outcome="", status="waiting",
            winner=ZERO_ADDRESS, owner_score=u16(0), opponent_score=u16(0),
            verdict_reasoning="", stake=u256(int(stake)), provisional_at=u256(0),
            appeal_state="none", appeal_reason="", appeal_result="", evidence_uri="",
        )
        self.room_ids.append(normalized_id)

    @gl.public.write
    def join_room(self, room_id: str, opponent_profile: Address = ZERO_ADDRESS):
        opponent_profile = self._normalize_address(opponent_profile)
        room = self._require_room(room_id)
        join_identity = opponent_profile if self.core_contract != ZERO_ADDRESS else gl.message.sender_address

        if room.owner == join_identity:
            raise gl.vm.UserError("[EXPECTED] The creator cannot join twice.")
        if room.opponent != ZERO_ADDRESS:
            raise gl.vm.UserError("[EXPECTED] Room already has a second player.")

        self._require_profile_owner(opponent_profile)
        room.opponent = join_identity
        room.opponent_name = self._require_player_name(opponent_profile)
        room.status = "ready_to_start"
        self.rooms[room.id] = room
        self._open_escrow_if_staked(room)

    @gl.public.write
    def operator_resolve(self, room_id: str, outcome: str):
        # Fallback resolution for when the live web fetch is unavailable on a network.
        # Gated to the contract owner (operator); the standard path is resolve_room.
        self._require_owner()
        room = self._require_room(room_id)
        if room.opponent == ZERO_ADDRESS:
            raise gl.vm.UserError("[EXPECTED] An oracle room needs two players.")
        if not room.question or room.status == "ready_to_start":
            raise gl.vm.UserError("[EXPECTED] Start the room before resolving.")
        if room.status != "active":
            raise gl.vm.UserError("[EXPECTED] This oracle room is not awaiting resolution.")
        decided = outcome.strip().lower()
        if decided not in ("yes", "no"):
            raise gl.vm.UserError("[EXPECTED] Outcome must be 'yes' or 'no'.")
        self._apply_outcome(room, decided, "Resolved by the operator fallback path.")

    @gl.public.write
    def start_room(self, room_id: str):
        room = self._require_room(room_id)
        if room.status == "resolved":
            raise gl.vm.UserError("[EXPECTED] Room already has a verdict.")
        if room.opponent == ZERO_ADDRESS:
            raise gl.vm.UserError("[EXPECTED] A oracle room needs two players.")
        if room.question:
            raise gl.vm.UserError("[EXPECTED] Room already started.")
        self._require_room_owner(room)
        pack = self._generate_question(room.id, room.category)
        room.question = pack["question"]
        room.source = pack["source"]
        room.status = "active"
        self.rooms[room.id] = room

    def _generate_question(self, room_id: str, category: str) -> TreeMap[str, str]:
        generation_prompt = f"""
Generate one YES/NO forecast question about a near-future, publicly checkable event, plus a
public web source where its outcome can be verified.
Return valid JSON only with these keys:
- "question": a clear YES/NO question, 20-200 characters
- "source": a single public https:// URL where the outcome can be checked

Rules:
- Category: {category}
- The question must have a clear YES or NO answer once the event resolves.
- The source must be a real, stable, public https URL (no logins, no localhost, no IP addresses).
- Do not output lists, numbering, or explanation.
- Use the room seed "{room_id}" to vary the result.
        """.strip()

        def leader_fn():
            response = gl.nondet.exec_prompt(generation_prompt, response_format="json")
            return self._normalize_question_pack(response)

        def validator_fn(leader_result):
            if not isinstance(leader_result, gl.vm.Return):
                return False
            return self._is_valid_question_pack(leader_result.calldata)

        return gl.vm.run_nondet_unsafe(leader_fn, validator_fn)

    def _normalize_question_pack(self, response: typing.Any) -> TreeMap[str, str]:
        data = response if isinstance(response, dict) else {}
        question = str(data.get("question", "")).strip()
        source = str(data.get("source", "")).strip()
        if not (source.startswith("https://") and len(source) <= 300):
            source = ""
        return {"question": question, "source": source}

    def _is_valid_question_pack(self, payload: typing.Any) -> bool:
        if not isinstance(payload, dict):
            return False
        question = str(payload.get("question", "")).strip()
        source = str(payload.get("source", "")).strip()
        if not 20 <= len(question) <= 200:
            return False
        return source.startswith("https://") and len(source) <= 300

    def _open_escrow_if_staked(self, room: OracleRoom):
        if self.credit_ledger == ZERO_ADDRESS:
            return
        if int(room.stake) <= 0:
            return
        CreditLedgerIface(self.credit_ledger).emit(on="accepted").open_escrow(
            room.id, MODE, room.owner, room.opponent, room.stake
        )

    @gl.public.write
    def resolve_room(self, room_id: str):
        room = self._require_room(room_id)

        if room.opponent == ZERO_ADDRESS:
            raise gl.vm.UserError("[EXPECTED] An oracle room needs two players.")
        if not room.question or room.status == "ready_to_start":
            raise gl.vm.UserError("[EXPECTED] Start the room before resolving it.")
        if room.status != "active":
            raise gl.vm.UserError("[EXPECTED] This oracle room is not awaiting resolution.")

        result = self._resolve_outcome(room.question, room.source)
        if result["outcome"] not in ("yes", "no"):
            raise gl.vm.UserError("[EXPECTED] The outcome could not be determined yet; try again later.")
        self._apply_outcome(room, result["outcome"], result["reasoning"])

    def _apply_outcome(self, room: OracleRoom, outcome: str, reasoning: str):
        # Owner backs YES, opponent backs NO; the side matching the resolved outcome wins.
        room.outcome = outcome
        room.verdict_reasoning = reasoning
        if outcome == "yes":
            winner = room.owner
            room.owner_score = u16(100)
            room.opponent_score = u16(0)
        else:
            winner = room.opponent
            room.owner_score = u16(0)
            room.opponent_score = u16(100)
        self._enter_provisional(room, winner)

    def _resolve_outcome(self, question: str, source: str) -> TreeMap[str, typing.Any]:
        prompt = self._build_resolution_prompt(question)

        def leader_fn():
            evidence = self._fetch_source_text(source)
            full_prompt = prompt + "\n\nSOURCE CONTENT (verbatim, may be truncated):\n" + evidence
            response = gl.nondet.exec_prompt(full_prompt, response_format="json")
            return self._normalize_outcome(response)

        def validator_fn(leader_result):
            if not isinstance(leader_result, gl.vm.Return):
                return False
            return self._is_valid_outcome(leader_result.calldata)

        return gl.vm.run_nondet_unsafe(leader_fn, validator_fn)

    def _build_resolution_prompt(self, question: str) -> str:
        return f"""You are an impartial oracle resolving a YES/NO forecast question by reading a
source. Base your decision ONLY on the source content provided below; do not use outside
knowledge. If the source does not clearly settle the question, answer "unknown".

QUESTION:
{question}

Return valid JSON only with these keys:
- "outcome": "yes", "no", or "unknown"
- "reasoning": one or two sentences citing what in the source decided it""".strip()

    def _fetch_source_text(self, source: str) -> str:
        if not source:
            return "(no source was provided)"
        if not source.startswith("https://"):
            raise gl.vm.UserError("[EXPECTED] Resolution source must be an https URL.")
        res = gl.nondet.web.get(source)
        if res.status >= 500:
            raise gl.vm.UserError("[TRANSIENT] Resolution source is unavailable.")
        if res.status >= 400:
            raise gl.vm.UserError(f"[EXTERNAL] Resolution source could not be fetched (status {res.status}).")
        body = res.body or b""
        return body.decode("utf-8", errors="ignore")[:4000]

    def _normalize_outcome(self, response: typing.Any) -> TreeMap[str, typing.Any]:
        data = response if isinstance(response, dict) else {}
        raw = str(data.get("outcome", "")).strip().lower()
        if raw in ("yes", "true", "y"):
            outcome = "yes"
        elif raw in ("no", "false", "n"):
            outcome = "no"
        else:
            outcome = "unknown"
        return {"outcome": outcome, "reasoning": str(data.get("reasoning", "")).strip()[:600]}

    def _is_valid_outcome(self, outcome: typing.Any) -> bool:
        return isinstance(outcome, dict) and outcome.get("outcome") in ("yes", "no", "unknown")

    def _enter_provisional(self, room: OracleRoom, winner: Address):
        room.status = "provisional"
        room.winner = winner
        room.provisional_at = u256(self._now_epoch())
        self.rooms[room.id] = room
        if self.credit_ledger != ZERO_ADDRESS and int(room.stake) > 0:
            CreditLedgerIface(self.credit_ledger).emit(on="accepted").set_provisional(room.id, winner)

    def _settle_winner(self, room: OracleRoom):
        room.status = "resolved"
        self.rooms[room.id] = room
        loser = self._resolved_loser(room)
        if self.credit_ledger != ZERO_ADDRESS and int(room.stake) > 0:
            CreditLedgerIface(self.credit_ledger).emit(on="accepted").finalize_winner(room.id, room.winner)
        self._emit_profile_result(room.id, room.winner, loser, self._wager_bonus_xp(room))

    def _wager_bonus_xp(self, room: OracleRoom) -> int:
        # Wagered wins are worth more: +1 XP per credit staked, capped so a single match cannot
        # dwarf the ladder (base win XP is 100; the cap keeps a wagered win at most a few x).
        return min(int(room.stake) // (10 ** 18), 200)

    def _settle_void(self, room: OracleRoom):
        if self.credit_ledger != ZERO_ADDRESS and int(room.stake) > 0:
            CreditLedgerIface(self.credit_ledger).emit(on="accepted").finalize_void(room.id)

    def _resolved_loser(self, room: OracleRoom) -> Address:
        if room.winner == room.owner:
            return room.opponent
        if room.winner == room.opponent:
            return room.owner
        return ZERO_ADDRESS

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

    def _match_id(self, room_id: str) -> str:
        return f"{MODE}:{room_id}"

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

    @gl.public.write
    def forfeit_room(self, room_id: str):
        room = self._require_room(room_id)

        if room.status == "resolved":
            raise gl.vm.UserError("[EXPECTED] Room already has a verdict.")
        if room.opponent == ZERO_ADDRESS:
            raise gl.vm.UserError("[EXPECTED] A oracle room needs two players before someone can quit.")

        role = self._participant_role(room)
        winner = room.opponent if role == "owner" else room.owner
        winner_name = room.opponent_name if role == "owner" else room.owner_name
        quitter_name = room.owner_name if role == "owner" else room.opponent_name

        room.owner_score = u16(0 if role == "owner" else 100)
        room.opponent_score = u16(100 if role == "owner" else 0)
        room.verdict_reasoning = f"{quitter_name} quit the room, so {winner_name} wins by forfeit."
        self._enter_provisional(room, winner)

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

        role = self._participant_role(room)
        identity = room.owner if role == "owner" else room.opponent
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

    def _build_appeal_prompt(self, room: OracleRoom) -> str:
        evidence_note = (
            "The losing player attached an image as evidence; it is provided alongside this "
            "prompt. Judge whether the attached image actually supports the stated reason — "
            "ignore the claim if the image does not corroborate it.\n"
            if room.evidence_uri
            else "No image evidence was attached; judge on the written reason alone.\n"
        )
        return f"""APPEAL REVIEW — you are the impartial judge for a wager match.

A provisional result was reached. The losing player has appealed. Decide whether the
provisional result should stand ("upheld") or be voided and stakes refunded ("overturned").

Overturn ONLY when the appeal shows the result was unfair due to a genuine technical
fault (e.g., a verified disconnect that prevented play), NOT mere disagreement with the
verdict or a desire to replay.

{evidence_note}Match question: {room.question}
Provisional verdict reasoning: {room.verdict_reasoning}
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

    @gl.public.write
    def sync_profile_results(self, room_id: str):
        room = self._require_room(room_id)
        if room.status != "resolved":
            raise gl.vm.UserError("[EXPECTED] Only resolved rooms can sync profile results.")

        loser = self._resolved_loser(room)
        if room.winner == ZERO_ADDRESS or loser == ZERO_ADDRESS:
            raise gl.vm.UserError("[EXPECTED] Resolved room does not have a complete winner/loser pair.")

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
            OracleRoom(
                id="",
                mode=MODE,
                owner=ZERO_ADDRESS,
                owner_name="",
                opponent=ZERO_ADDRESS,
                opponent_name="",
                category="",
                question="",
                source="",
                outcome="",
                status="waiting",
                winner=ZERO_ADDRESS,
                owner_score=u16(0),
                opponent_score=u16(0),
                verdict_reasoning="",
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
            raise gl.vm.UserError("[EXPECTED] Core contract is not configured.")
        return VerdictDotFunCore(self.core_contract)

    def _require_room(self, room_id: str) -> OracleRoom:
        normalized_id = room_id.strip().upper()
        if normalized_id not in self.rooms:
            raise gl.vm.UserError("[EXPECTED] Room does not exist.")
        return self.rooms[normalized_id]

    def _require_owner(self):
        if gl.message.sender_address != self.owner:
            raise gl.vm.UserError("[EXPECTED] Only the contract owner can perform this action.")

    def _require_profile_owner(self, profile_address: Address) -> Address:
        if self.core_contract == ZERO_ADDRESS:
            if gl.message.sender_address not in self.local_profiles:
                raise gl.vm.UserError("[EXPECTED] Create a local profile before interacting with the oracle game.")
            return gl.message.sender_address

        profile_address = self._normalize_address(profile_address)
        core = self._core()
        if not core.view().is_registered_profile(profile_address):
            raise gl.vm.UserError("[EXPECTED] Register a profile before interacting with this game.")

        owner = core.view().get_profile_owner(profile_address)
        if gl.message.sender_address == self.core_contract:
            return owner
        if owner != gl.message.sender_address:
            raise gl.vm.UserError("[EXPECTED] Only the current holder of this profile can perform that action.")
        return owner

    def _require_player_name(self, profile_address: Address) -> str:
        if self.core_contract == ZERO_ADDRESS:
            profile = self.local_profiles.get(gl.message.sender_address)
            if profile and profile.name:
                return profile.name
            raise gl.vm.UserError("[EXPECTED] Create a local profile before interacting with the oracle game.")

        profile_address = self._normalize_address(profile_address)
        self._require_profile_owner(profile_address)
        core = self._core()
        profile = core.view().get_profile_by_address(profile_address)
        handle = str(profile.get("handle", "")).strip()
        if not handle:
            raise gl.vm.UserError("[EXPECTED] Profile did not return a valid handle.")
        return handle

    def _participant_role(self, room: OracleRoom) -> str:
        sender = gl.message.sender_address
        if self.core_contract == ZERO_ADDRESS:
            if room.owner == sender:
                return "owner"
            if room.opponent == sender:
                return "opponent"
            raise gl.vm.UserError("[EXPECTED] Only room participants can submit.")

        core = self._core()
        if room.owner != ZERO_ADDRESS and core.view().get_profile_owner(room.owner) == sender:
            return "owner"
        if room.opponent != ZERO_ADDRESS and core.view().get_profile_owner(room.opponent) == sender:
            return "opponent"
        raise gl.vm.UserError("[EXPECTED] Only room participants can submit.")

    def _require_room_owner(self, room: OracleRoom):
        sender = gl.message.sender_address
        if self.core_contract == ZERO_ADDRESS:
            if room.owner != sender:
                raise gl.vm.UserError("[EXPECTED] Only the room owner can start this room.")
            return

        core = self._core()
        if room.owner == ZERO_ADDRESS or core.view().get_profile_owner(room.owner) != sender:
            raise gl.vm.UserError("[EXPECTED] Only the room owner can start this room.")

    def _now_epoch(self) -> int:
        raw = gl.message_raw["datetime"]
        if hasattr(raw, "timestamp"):
            return int(raw.timestamp())
        import datetime as _dt
        return int(_dt.datetime.fromisoformat(str(raw).replace("Z", "+00:00")).timestamp())

    def _normalize_category(self, category: str) -> str:
        cleaned = category.strip()
        if not cleaned:
            return ""
        return " ".join(part.capitalize() for part in cleaned.split())

    def _normalize_address(self, value: typing.Any) -> Address:
        if isinstance(value, Address):
            return value
        if isinstance(value, bytes):
            return Address(value)
        if hasattr(value, "as_bytes"):
            return Address(value.as_bytes)
        return Address(value)
