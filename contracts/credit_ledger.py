# { "Depends": "py-genlayer:1jb45aa8ynh2a9c9xn3b7qqh8sm5q93hwfp7jqmwsfhh8jpz09h6" }

import typing
from dataclasses import dataclass

from genlayer import *

ZERO_ADDRESS = Address("0x0000000000000000000000000000000000000000")
ERR = "[EXPECTED] "


@allow_storage
@dataclass
class Escrow:
    room_id: str
    mode: str
    player_a: Address
    player_b: Address
    stake: u256          # per-player atto-credits
    pot: u256            # total locked atto-credits
    state: str           # "open" | "provisional" | "final" | "void"
    provisional_winner: Address


@allow_storage
@dataclass
class PendingRedeem:
    redeem_id: u256
    profile: Address
    payout_wallet: Address
    token: str
    atto_amount: u256
    settled: bool


class CreditLedger(gl.Contract):
    owner: Address
    core: Address
    bridge: Address
    balances: TreeMap[Address, u256]
    processed_deposits: TreeMap[str, bool]
    approved_callers: TreeMap[Address, bool]
    escrows: TreeMap[str, Escrow]
    redeems: TreeMap[u256, PendingRedeem]
    redeem_nonce: u256

    def __init__(self, core: Address = ZERO_ADDRESS, bridge: Address = ZERO_ADDRESS):
        self.owner = gl.message.sender_address
        self.core = self._addr(core)
        self.bridge = self._addr(bridge)
        self.redeem_nonce = u256(0)

    # ---- admin ----
    @gl.public.write
    def set_bridge(self, bridge: Address) -> None:
        self._require_owner()
        self.bridge = self._addr(bridge)

    @gl.public.write
    def set_core(self, core: Address) -> None:
        self._require_owner()
        self.core = self._addr(core)

    @gl.public.write
    def approve_caller(self, caller: Address, allowed: bool) -> None:
        # owner or core may approve mode contracts
        if gl.message.sender_address != self.owner and gl.message.sender_address != self.core:
            raise gl.vm.UserError(ERR + "Only owner or core can approve callers.")
        self.approved_callers[self._addr(caller)] = allowed

    # ---- credit (bridge-only, idempotent) ----
    @gl.public.write
    def credit(self, profile: Address, atto_amount: u256, deposit_ref: str) -> None:
        self._require_bridge()
        ref = deposit_ref.strip()
        if not ref:
            raise gl.vm.UserError(ERR + "deposit_ref is required.")
        if int(atto_amount) <= 0:
            raise gl.vm.UserError(ERR + "Credit amount must be positive.")
        if self.processed_deposits.get(ref, False):
            return  # idempotent replay
        p = self._addr(profile)
        self.balances[p] = u256(int(self.balances.get(p, u256(0))) + int(atto_amount))
        self.processed_deposits[ref] = True

    # ---- escrow ----
    @gl.public.write
    def open_escrow(
        self,
        room_id: str,
        mode: str,
        player_a: Address,
        player_b: Address,
        atto_stake: u256,
    ) -> None:
        self._require_approved_caller()
        rid = room_id.strip().upper()
        if not rid:
            raise gl.vm.UserError(ERR + "Room id is required.")
        if rid in self.escrows:
            raise gl.vm.UserError(ERR + "Escrow already exists for this room.")
        stake = int(atto_stake)
        if stake <= 0:
            raise gl.vm.UserError(ERR + "Stake must be positive.")

        a = self._addr(player_a)
        b = self._addr(player_b)
        if a == b:
            raise gl.vm.UserError(ERR + "Players must be distinct.")
        if int(self.balances.get(a, u256(0))) < stake:
            raise gl.vm.UserError(ERR + "Player A has insufficient credits.")
        if int(self.balances.get(b, u256(0))) < stake:
            raise gl.vm.UserError(ERR + "Player B has insufficient credits.")

        self.balances[a] = u256(int(self.balances[a]) - stake)
        self.balances[b] = u256(int(self.balances[b]) - stake)
        self.escrows[rid] = Escrow(
            room_id=rid,
            mode=mode.strip().lower(),
            player_a=a,
            player_b=b,
            stake=u256(stake),
            pot=u256(stake * 2),
            state="open",
            provisional_winner=ZERO_ADDRESS,
        )

    @gl.public.view
    def get_escrow(self, room_id: str) -> Escrow:
        rid = room_id.strip().upper()
        if rid not in self.escrows:
            raise gl.vm.UserError(ERR + "No escrow for this room.")
        return self.escrows[rid]

    # ---- settlement transitions ----
    @gl.public.write
    def set_provisional(self, room_id: str, winner: Address) -> None:
        self._require_approved_caller()
        esc = self._active_escrow(room_id)
        if esc.state != "open":
            raise gl.vm.UserError(ERR + "Escrow is not open.")
        w = self._addr(winner)
        if w != esc.player_a and w != esc.player_b:
            raise gl.vm.UserError(ERR + "Winner must be a participant.")
        esc.provisional_winner = w
        esc.state = "provisional"
        self.escrows[esc.room_id] = esc

    @gl.public.write
    def finalize_winner(self, room_id: str, winner: Address) -> None:
        self._require_approved_caller_or_bridge()
        esc = self._active_escrow(room_id)
        if esc.state not in ["open", "provisional"]:
            raise gl.vm.UserError(ERR + "Escrow already finalized.")
        w = self._addr(winner)
        if w != esc.player_a and w != esc.player_b:
            raise gl.vm.UserError(ERR + "Winner must be a participant.")
        self.balances[w] = u256(int(self.balances.get(w, u256(0))) + int(esc.pot))
        esc.state = "final"
        esc.provisional_winner = w
        self.escrows[esc.room_id] = esc

    @gl.public.write
    def finalize_tie(self, room_id: str) -> None:
        self._require_approved_caller_or_bridge()
        self._refund_both(room_id, "final")

    @gl.public.write
    def finalize_void(self, room_id: str) -> None:
        self._require_approved_caller_or_bridge()
        self._refund_both(room_id, "void")

    def _refund_both(self, room_id: str, end_state: str) -> None:
        esc = self._active_escrow(room_id)
        if esc.state not in ["open", "provisional"]:
            raise gl.vm.UserError(ERR + "Escrow already finalized.")
        self.balances[esc.player_a] = u256(int(self.balances.get(esc.player_a, u256(0))) + int(esc.stake))
        self.balances[esc.player_b] = u256(int(self.balances.get(esc.player_b, u256(0))) + int(esc.stake))
        esc.state = end_state
        self.escrows[esc.room_id] = esc

    # ---- redeem requests (bridge-driven) ----
    @gl.public.write
    def request_redeem(
        self,
        profile: Address,
        atto_amount: u256,
        payout_wallet: Address,
        token: str,
    ) -> u256:
        self._require_bridge()
        p = self._addr(profile)
        amount = int(atto_amount)
        if amount <= 0:
            raise gl.vm.UserError(ERR + "Redeem amount must be positive.")
        if int(self.balances.get(p, u256(0))) < amount:
            raise gl.vm.UserError(ERR + "Insufficient redeemable balance.")
        self.balances[p] = u256(int(self.balances[p]) - amount)

        redeem_id = u256(int(self.redeem_nonce))
        self.redeems[redeem_id] = PendingRedeem(
            redeem_id=redeem_id,
            profile=p,
            payout_wallet=self._addr(payout_wallet),
            token=token.strip(),
            atto_amount=u256(amount),
            settled=False,
        )
        self.redeem_nonce = u256(int(self.redeem_nonce) + 1)
        return redeem_id

    @gl.public.write
    def mark_redeem_settled(self, redeem_id: u256) -> None:
        self._require_bridge()
        rid = u256(int(redeem_id))
        if rid not in self.redeems:
            raise gl.vm.UserError(ERR + "Unknown redeem id.")
        r = self.redeems[rid]
        r.settled = True
        self.redeems[rid] = r

    @gl.public.view
    def get_redeem(self, redeem_id: u256) -> PendingRedeem:
        rid = u256(int(redeem_id))
        if rid not in self.redeems:
            raise gl.vm.UserError(ERR + "Unknown redeem id.")
        return self.redeems[rid]

    @gl.public.view
    def get_redeem_count(self) -> u256:
        return self.redeem_nonce

    # ---- views ----
    @gl.public.view
    def get_balance(self, profile: Address) -> u256:
        return self.balances.get(self._addr(profile), u256(0))

    # ---- helpers ----
    def _active_escrow(self, room_id: str) -> Escrow:
        rid = room_id.strip().upper()
        if rid not in self.escrows:
            raise gl.vm.UserError(ERR + "No escrow for this room.")
        return self.escrows[rid]

    def _require_owner(self):
        if gl.message.sender_address != self.owner:
            raise gl.vm.UserError(ERR + "Only the owner can perform this action.")

    def _require_bridge(self):
        if gl.message.sender_address != self.bridge:
            raise gl.vm.UserError(ERR + "Only the bridge can perform this action.")

    def _require_approved_caller(self):
        if not self.approved_callers.get(gl.message.sender_address, False):
            raise gl.vm.UserError(ERR + "Caller is not an approved mode contract.")

    def _require_approved_caller_or_bridge(self):
        s = gl.message.sender_address
        if s == self.bridge:
            return
        if self.approved_callers.get(s, False):
            return
        raise gl.vm.UserError(ERR + "Only an approved mode or the bridge can finalize.")

    def _addr(self, value: typing.Any) -> Address:
        if isinstance(value, Address):
            return value
        if isinstance(value, bytes):
            return Address(value)
        if hasattr(value, "as_bytes"):
            return Address(value.as_bytes)
        return Address(value)
