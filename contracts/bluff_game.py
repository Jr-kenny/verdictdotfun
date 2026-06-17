# { "Depends": "py-genlayer:1jb45aa8ynh2a9c9xn3b7qqh8sm5q93hwfp7jqmwsfhh8jpz09h6" }

from dataclasses import dataclass
import typing

try:
    from genlayer import *
except ModuleNotFoundError:
    from genlayer_py import *


ZERO_ADDRESS = Address("0x0000000000000000000000000000000000000000")
MODE = "bluff"
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
class BluffRoom:
    id: str
    mode: str
    owner: Address
    owner_name: str
    opponent: Address
    opponent_name: str
    category: str
    claim: str
    owner_submission: str
    opponent_submission: str
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


class BluffGame(gl.Contract):
    owner: Address
    core_contract: Address
    single_room_only: bool
    local_profiles: TreeMap[Address, LocalProfile]
    rooms: TreeMap[str, BluffRoom]
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
            raise gl.vm.UserError("[EXPECTED] This bluff room contract is already initialized.")
        if not normalized_id:
            raise gl.vm.UserError("[EXPECTED] Room id is required.")
        if normalized_id in self.rooms:
            return
        if not normalized_category:
            raise gl.vm.UserError("[EXPECTED] Category is required.")

        owner_name = self._require_player_name(owner_profile)
        room_owner = owner_profile if self.core_contract != ZERO_ADDRESS else gl.message.sender_address

        self.rooms[normalized_id] = BluffRoom(
            id=normalized_id, mode=MODE, owner=room_owner, owner_name=owner_name,
            opponent=ZERO_ADDRESS, opponent_name="", category=normalized_category,
            claim="", owner_submission="", opponent_submission="", status="waiting",
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
            raise Exception("The creator cannot join twice.")
        if room.opponent != ZERO_ADDRESS:
            raise Exception("Room already has a second player.")

        self._require_profile_owner(opponent_profile)
        room.opponent = join_identity
        room.opponent_name = self._require_player_name(opponent_profile)
        room.status = "ready_to_start"
        self.rooms[room.id] = room
        self._open_escrow_if_staked(room)

    def _open_escrow_if_staked(self, room: BluffRoom):
        if self.credit_ledger == ZERO_ADDRESS:
            return
        if int(room.stake) <= 0:
            return
        CreditLedgerIface(self.credit_ledger).emit(on="accepted").open_escrow(
            room.id, MODE, room.owner, room.opponent, room.stake
        )

    @gl.public.view
    def get_room(self, room_id: str) -> TreeMap[str, typing.Any]:
        normalized_id = room_id.strip().upper()
        return self.rooms.get(
            normalized_id,
            BluffRoom(
                id="",
                mode=MODE,
                owner=ZERO_ADDRESS,
                owner_name="",
                opponent=ZERO_ADDRESS,
                opponent_name="",
                category="",
                claim="",
                owner_submission="",
                opponent_submission="",
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
            raise Exception("Core contract is not configured.")
        return VerdictDotFunCore(self.core_contract)

    def _require_room(self, room_id: str) -> BluffRoom:
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
                raise Exception("Create a local profile before interacting with the bluff game.")
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
            raise Exception("Create a local profile before interacting with the bluff game.")

        profile_address = self._normalize_address(profile_address)
        self._require_profile_owner(profile_address)
        core = self._core()
        profile = core.view().get_profile_by_address(profile_address)
        handle = str(profile.get("handle", "")).strip()
        if not handle:
            raise Exception("Profile did not return a valid handle.")
        return handle

    def _participant_role(self, room: BluffRoom) -> str:
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

    def _require_room_owner(self, room: BluffRoom):
        sender = gl.message.sender_address
        if self.core_contract == ZERO_ADDRESS:
            if room.owner != sender:
                raise Exception("Only the room owner can start this room.")
            return

        core = self._core()
        if room.owner == ZERO_ADDRESS or core.view().get_profile_owner(room.owner) != sender:
            raise Exception("Only the room owner can start this room.")

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
