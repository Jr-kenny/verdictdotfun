# Plan 1B — GenLayer Credit Ledger + Generic Mode Registry Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the GenLayer spine — a `CreditLedger` intelligent contract (credit balances, room escrow, settlement transitions, redeem requests) and a generic, dynamic mode registry on the core contract to replace the hardcoded argue/riddle wiring.

**Architecture:** `CreditLedger` holds atto-scale credit balances per profile, locks symmetric stakes into per-room escrows, and exposes settlement transitions (`finalize_winner`/`finalize_tie`/`finalize_void`) callable only by approved mode contracts. The core `VerdictDotFun` contract gains a generic `modes: TreeMap[str, Address]` registry. Money is `u256` atto-scale (credits × 10^18). Bare `Exception` is replaced by `gl.vm.UserError` with error-class prefixes per the GenLayer contract-writing guidance.

**Tech Stack:** GenLayer Python (pinned runner `py-genlayer:1jb45aa8ynh2a9c9xn3b7qqh8sm5q93hwfp7jqmwsfhh8jpz09h6`), `gltest` direct-mode tests (pytest), `genvm-lint`.

**This is a rebuild.** Do not assume the hackathon core registry is correct. Replace the hardcoded `debate_contract`/`riddle_contract`/`_mode_salt` machinery with the generic registry below.

---

## Conventions used across 1B/1C/1D

- **Atto-credit:** 1 credit = `10**18` atto-units, stored as `u256`. All ledger amounts are atto.
- **Escrow states:** `"open"` → `"provisional"` → `"final"` | `"void"`.
- **deposit_ref:** idempotency key string `f"{tx_hash}:{nonce}"` supplied by the relayer.
- **Auth:** ledger keeps its own `approved_callers: TreeMap[Address, bool]` (the mode contracts) and a single `bridge: Address` (the relayer). The core calls `approve_caller` when it registers a mode.
- **Errors:** prefix business errors with `"[EXPECTED] "` via `gl.vm.UserError`.

---

## File Structure

- Create: `contracts/credit_ledger.py` — the ledger intelligent contract.
- Modify: `contracts/verdictdotfun.py` — generic mode registry; wire ledger approval.
- Create: `tests/direct/test_credit_ledger.py` — ledger direct tests.
- Modify: `tests/direct/test_vdt_core.py` — registry tests (add).

---

## Task 1: CreditLedger — balances + idempotent credit

**Files:**
- Create: `contracts/credit_ledger.py`
- Create: `tests/direct/test_credit_ledger.py`

- [ ] **Step 1: Write the failing test**

`tests/direct/test_credit_ledger.py`:
```python
ZERO_ADDRESS = "0x0000000000000000000000000000000000000000"
CREDIT = 10**18

PROFILE_A = "0xa11ce00000000000000000000000000000000001"
PROFILE_B = "0xb0b0000000000000000000000000000000000002"


def _deploy(direct_deploy, owner_sender, direct_vm, bridge):
    direct_vm.sender = owner_sender
    # core address is ZERO for standalone ledger tests
    return direct_deploy("contracts/credit_ledger.py", ZERO_ADDRESS, bridge)


def test_credit_is_idempotent_on_deposit_ref(direct_vm, direct_deploy, direct_alice, direct_bob):
    bridge = direct_bob
    ledger = _deploy(direct_deploy, direct_alice, direct_vm, bridge)

    direct_vm.sender = bridge
    ledger.credit(PROFILE_A, 5 * CREDIT, "0xtx1:1")
    ledger.credit(PROFILE_A, 5 * CREDIT, "0xtx1:1")  # replay — must be a no-op

    assert ledger.get_balance(PROFILE_A) == 5 * CREDIT


def test_only_bridge_can_credit(direct_vm, direct_deploy, direct_alice, direct_bob):
    ledger = _deploy(direct_deploy, direct_alice, direct_vm, direct_bob)
    direct_vm.sender = direct_alice  # not the bridge
    try:
        ledger.credit(PROFILE_A, CREDIT, "0xtx9:1")
        assert False, "expected revert"
    except Exception as exc:
        assert "EXPECTED" in str(exc) or "bridge" in str(exc).lower()
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm exec gltest tests/direct/test_credit_ledger.py -v` (or `python -m pytest tests/direct/test_credit_ledger.py -v`)
Expected: FAIL — `contracts/credit_ledger.py` does not exist.

- [ ] **Step 3: Implement the ledger skeleton + credit**

`contracts/credit_ledger.py`:
```python
# { "Depends": "py-genlayer:1jb45aa8ynh2a9c9xn3b7qqh8sm5q93hwfp7jqmwsfhh8jpz09h6" }

import typing

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

    # ---- views ----
    @gl.public.view
    def get_balance(self, profile: Address) -> u256:
        return self.balances.get(self._addr(profile), u256(0))

    # ---- helpers ----
    def _require_owner(self):
        if gl.message.sender_address != self.owner:
            raise gl.vm.UserError(ERR + "Only the owner can perform this action.")

    def _require_bridge(self):
        if gl.message.sender_address != self.bridge:
            raise gl.vm.UserError(ERR + "Only the bridge can perform this action.")

    def _require_approved_caller(self):
        if not self.approved_callers.get(gl.message.sender_address, False):
            raise gl.vm.UserError(ERR + "Caller is not an approved mode contract.")

    def _addr(self, value: typing.Any) -> Address:
        if isinstance(value, Address):
            return value
        if isinstance(value, bytes):
            return Address(value)
        if hasattr(value, "as_bytes"):
            return Address(value.as_bytes)
        return Address(value)
```

- [ ] **Step 4: Lint, then run the test**

Run:
```bash
pnpm exec gltest tests/direct/test_credit_ledger.py -v
```
Expected: PASS (2 tests). If `genvm-lint` is available, also run `genvm-lint check contracts/credit_ledger.py` — expect no errors. If lint flags `gl.message.sender_address` vs `gl.message.sender_account`, prefer the form lint accepts and update all helpers consistently.

- [ ] **Step 5: Commit**

```bash
git add contracts/credit_ledger.py tests/direct/test_credit_ledger.py
git commit -m "feat(genlayer): CreditLedger balances with idempotent bridge credit"
```

---

## Task 2: Escrow — lock symmetric stakes

**Files:**
- Modify: `contracts/credit_ledger.py`
- Modify: `tests/direct/test_credit_ledger.py`

- [ ] **Step 1: Write the failing test**

Append to `tests/direct/test_credit_ledger.py`:
```python
def _funded_ledger(direct_vm, direct_deploy, owner, bridge, mode):
    direct_vm.sender = owner
    ledger = direct_deploy("contracts/credit_ledger.py", ZERO_ADDRESS, bridge)
    direct_vm.sender = owner
    ledger.approve_caller(mode, True)
    direct_vm.sender = bridge
    ledger.credit(PROFILE_A, 10 * CREDIT, "0xdep:a")
    ledger.credit(PROFILE_B, 10 * CREDIT, "0xdep:b")
    return ledger


def test_open_escrow_locks_both_stakes(direct_vm, direct_deploy, direct_alice, direct_bob):
    MODE = "0xd0de000000000000000000000000000000000003"
    ledger = _funded_ledger(direct_vm, direct_deploy, direct_alice, direct_bob, MODE)

    direct_vm.sender = MODE
    ledger.open_escrow("ROOM01", "argue", PROFILE_A, PROFILE_B, 3 * CREDIT)

    assert ledger.get_balance(PROFILE_A) == 7 * CREDIT
    assert ledger.get_balance(PROFILE_B) == 7 * CREDIT
    esc = ledger.get_escrow("ROOM01")
    assert esc.pot == 6 * CREDIT
    assert esc.state == "open"


def test_open_escrow_rejects_insufficient_balance(direct_vm, direct_deploy, direct_alice, direct_bob):
    MODE = "0xd0de000000000000000000000000000000000003"
    ledger = _funded_ledger(direct_vm, direct_deploy, direct_alice, direct_bob, MODE)
    direct_vm.sender = MODE
    try:
        ledger.open_escrow("ROOM02", "argue", PROFILE_A, PROFILE_B, 99 * CREDIT)
        assert False, "expected revert"
    except Exception as exc:
        assert "EXPECTED" in str(exc)


def test_open_escrow_rejects_unapproved_caller(direct_vm, direct_deploy, direct_alice, direct_bob):
    MODE = "0xd0de000000000000000000000000000000000003"
    ledger = _funded_ledger(direct_vm, direct_deploy, direct_alice, direct_bob, MODE)
    direct_vm.sender = direct_alice  # not approved
    try:
        ledger.open_escrow("ROOM03", "argue", PROFILE_A, PROFILE_B, CREDIT)
        assert False, "expected revert"
    except Exception as exc:
        assert "approved" in str(exc).lower() or "EXPECTED" in str(exc)
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm exec gltest tests/direct/test_credit_ledger.py -v`
Expected: FAIL — `open_escrow` / `get_escrow` not defined.

- [ ] **Step 3: Implement escrow open + view**

Add to `contracts/credit_ledger.py` (inside the class, after `credit`):
```python
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
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm exec gltest tests/direct/test_credit_ledger.py -v`
Expected: PASS (all escrow tests).

- [ ] **Step 5: Commit**

```bash
git add contracts/credit_ledger.py tests/direct/test_credit_ledger.py
git commit -m "feat(genlayer): CreditLedger room escrow with stake locking"
```

---

## Task 3: Settlement transitions — provisional, winner, tie, void

**Files:**
- Modify: `contracts/credit_ledger.py`
- Modify: `tests/direct/test_credit_ledger.py`

- [ ] **Step 1: Write the failing tests (conservation + idempotency)**

Append to `tests/direct/test_credit_ledger.py`:
```python
def _escrowed(direct_vm, direct_deploy, owner, bridge, mode, room="ROOM01", stake=3):
    ledger = _funded_ledger(direct_vm, direct_deploy, owner, bridge, mode)
    direct_vm.sender = mode
    ledger.open_escrow(room, "argue", PROFILE_A, PROFILE_B, stake * CREDIT)
    return ledger


def test_finalize_winner_pays_full_pot_and_conserves(direct_vm, direct_deploy, direct_alice, direct_bob):
    MODE = "0xd0de000000000000000000000000000000000003"
    ledger = _escrowed(direct_vm, direct_deploy, direct_alice, direct_bob, MODE)
    direct_vm.sender = MODE
    ledger.set_provisional("ROOM01", PROFILE_A)
    ledger.finalize_winner("ROOM01", PROFILE_A)

    assert ledger.get_balance(PROFILE_A) == 13 * CREDIT  # 7 left + 6 pot
    assert ledger.get_balance(PROFILE_B) == 7 * CREDIT
    assert ledger.get_escrow("ROOM01").state == "final"
    # total credits conserved: 13 + 7 == 20 (original 10 + 10)


def test_finalize_is_idempotent(direct_vm, direct_deploy, direct_alice, direct_bob):
    MODE = "0xd0de000000000000000000000000000000000003"
    ledger = _escrowed(direct_vm, direct_deploy, direct_alice, direct_bob, MODE)
    direct_vm.sender = MODE
    ledger.set_provisional("ROOM01", PROFILE_A)
    ledger.finalize_winner("ROOM01", PROFILE_A)
    try:
        ledger.finalize_winner("ROOM01", PROFILE_A)
        assert False, "expected revert on re-finalize"
    except Exception as exc:
        assert "EXPECTED" in str(exc)


def test_finalize_void_refunds_both(direct_vm, direct_deploy, direct_alice, direct_bob):
    MODE = "0xd0de000000000000000000000000000000000003"
    ledger = _escrowed(direct_vm, direct_deploy, direct_alice, direct_bob, MODE)
    direct_vm.sender = MODE
    ledger.set_provisional("ROOM01", PROFILE_A)
    ledger.finalize_void("ROOM01")
    assert ledger.get_balance(PROFILE_A) == 10 * CREDIT
    assert ledger.get_balance(PROFILE_B) == 10 * CREDIT
    assert ledger.get_escrow("ROOM01").state == "void"


def test_finalize_tie_refunds_both(direct_vm, direct_deploy, direct_alice, direct_bob):
    MODE = "0xd0de000000000000000000000000000000000003"
    ledger = _escrowed(direct_vm, direct_deploy, direct_alice, direct_bob, MODE)
    direct_vm.sender = MODE
    ledger.finalize_tie("ROOM01")
    assert ledger.get_balance(PROFILE_A) == 10 * CREDIT
    assert ledger.get_balance(PROFILE_B) == 10 * CREDIT
    assert ledger.get_escrow("ROOM01").state == "final"
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm exec gltest tests/direct/test_credit_ledger.py -v`
Expected: FAIL — settlement methods not defined.

- [ ] **Step 3: Implement settlement transitions**

Add to `contracts/credit_ledger.py` (after `get_escrow`):
```python
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

    def _active_escrow(self, room_id: str) -> Escrow:
        rid = room_id.strip().upper()
        if rid not in self.escrows:
            raise gl.vm.UserError(ERR + "No escrow for this room.")
        return self.escrows[rid]

    def _require_approved_caller_or_bridge(self):
        s = gl.message.sender_address
        if s == self.bridge:
            return
        if self.approved_callers.get(s, False):
            return
        raise gl.vm.UserError(ERR + "Only an approved mode or the bridge can finalize.")
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm exec gltest tests/direct/test_credit_ledger.py -v`
Expected: PASS (all settlement tests; conservation holds).

- [ ] **Step 5: Commit**

```bash
git add contracts/credit_ledger.py tests/direct/test_credit_ledger.py
git commit -m "feat(genlayer): CreditLedger settlement (winner/tie/void) with conservation"
```

---

## Task 4: Redeem requests (bridge-driven, balance-checked)

**Files:**
- Modify: `contracts/credit_ledger.py`
- Modify: `tests/direct/test_credit_ledger.py`

- [ ] **Step 1: Write the failing test**

Append to `tests/direct/test_credit_ledger.py`:
```python
WALLET_A = "0xfee1dead00000000000000000000000000000099"


def test_request_redeem_debits_and_records(direct_vm, direct_deploy, direct_alice, direct_bob):
    ledger = _funded_ledger(direct_vm, direct_deploy, direct_alice, direct_bob,
                            "0xd0de000000000000000000000000000000000003")
    direct_vm.sender = direct_bob  # bridge
    ledger.request_redeem(PROFILE_A, 4 * CREDIT, WALLET_A, "USDC")
    assert ledger.get_balance(PROFILE_A) == 6 * CREDIT
    r = ledger.get_redeem(0)
    assert r.profile == Address(PROFILE_A) or str(r.profile).lower() == PROFILE_A
    assert r.atto_amount == 4 * CREDIT
    assert r.settled is False


def test_request_redeem_rejects_overdraw(direct_vm, direct_deploy, direct_alice, direct_bob):
    ledger = _funded_ledger(direct_vm, direct_deploy, direct_alice, direct_bob,
                            "0xd0de000000000000000000000000000000000003")
    direct_vm.sender = direct_bob
    try:
        ledger.request_redeem(PROFILE_A, 999 * CREDIT, WALLET_A, "USDC")
        assert False, "expected revert"
    except Exception as exc:
        assert "EXPECTED" in str(exc)


def test_mark_redeem_settled(direct_vm, direct_deploy, direct_alice, direct_bob):
    ledger = _funded_ledger(direct_vm, direct_deploy, direct_alice, direct_bob,
                            "0xd0de000000000000000000000000000000000003")
    direct_vm.sender = direct_bob
    ledger.request_redeem(PROFILE_A, CREDIT, WALLET_A, "USDC")
    ledger.mark_redeem_settled(0)
    assert ledger.get_redeem(0).settled is True
```

Note: `Address(...)` is available because the test file imports nothing GenLayer-specific; if the harness does not expose `Address`, the string-compare branch in the assertion covers it.

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm exec gltest tests/direct/test_credit_ledger.py -v`
Expected: FAIL — `request_redeem` not defined.

- [ ] **Step 3: Implement redeem request + settle**

Add to `contracts/credit_ledger.py`:
```python
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
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm exec gltest tests/direct/test_credit_ledger.py -v`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add contracts/credit_ledger.py tests/direct/test_credit_ledger.py
git commit -m "feat(genlayer): CreditLedger redeem requests for the bridge"
```

---

## Task 5: Generic mode registry on the core contract

**Files:**
- Modify: `contracts/verdictdotfun.py`
- Modify: `tests/direct/test_vdt_core.py`

This replaces the hardcoded `debate_contract`/`riddle_contract`/`convince_contract` storage,
`_mode_salt`, and the `argue`/`riddle`-only `_normalize_mode` with a generic registry.

- [ ] **Step 1: Write the failing registry test**

Append to `tests/direct/test_vdt_core.py`:
```python
ZERO_ADDRESS = "0x0000000000000000000000000000000000000000"
MODE_X = "0x1111110000000000000000000000000000000011"
MODE_Y = "0x2222220000000000000000000000000000000022"


def test_register_and_lookup_modes(direct_vm, direct_deploy, direct_alice):
    direct_vm.sender = direct_alice
    core = direct_deploy("contracts/verdictdotfun.py")
    core.register_mode("argue", MODE_X)
    core.register_mode("riddle", MODE_Y)

    assert str(core.get_mode_contract("argue")).lower() == MODE_X
    assert str(core.get_mode_contract("riddle")).lower() == MODE_Y
    assert core.is_mode("argue") is True
    assert core.is_mode("nope") is False
    names = list(core.get_mode_names())
    assert "argue" in names and "riddle" in names


def test_deregister_mode_revokes(direct_vm, direct_deploy, direct_alice):
    direct_vm.sender = direct_alice
    core = direct_deploy("contracts/verdictdotfun.py")
    core.register_mode("argue", MODE_X)
    core.deregister_mode("argue")
    assert core.is_mode("argue") is False
    assert core.is_game_contract(MODE_X) is False


def test_register_mode_owner_only(direct_vm, direct_deploy, direct_alice, direct_bob):
    direct_vm.sender = direct_alice
    core = direct_deploy("contracts/verdictdotfun.py")
    direct_vm.sender = direct_bob
    try:
        core.register_mode("argue", MODE_X)
        assert False, "expected revert"
    except Exception as exc:
        assert "owner" in str(exc).lower() or "EXPECTED" in str(exc)
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm exec gltest tests/direct/test_vdt_core.py -v -k mode`
Expected: FAIL — `register_mode` not defined.

- [ ] **Step 3: Add the generic registry to core**

In `contracts/verdictdotfun.py`, add these storage fields to the `VerdictDotFun` class
(append at END of the existing field block to preserve upgrade layout):
```python
    modes: TreeMap[str, Address]
    mode_names: DynArray[str]
    credit_ledger: Address
```

Add these methods to the class:
```python
    @gl.public.write
    def register_mode(self, name: str, contract_address: Address) -> None:
        self._require_owner()
        normalized = name.strip().lower()
        if not normalized:
            raise gl.vm.UserError("[EXPECTED] Mode name is required.")
        address = self._normalize_address(contract_address)
        if normalized not in self.modes:
            self.mode_names.append(normalized)
        previous = self.modes.get(normalized, ZERO_ADDRESS)
        if previous != ZERO_ADDRESS and previous != address:
            self.approved_games[previous] = False
        self.modes[normalized] = address
        if address != ZERO_ADDRESS:
            self.approved_games[address] = True
            self._approve_in_ledger(address, True)

    @gl.public.write
    def deregister_mode(self, name: str) -> None:
        self._require_owner()
        normalized = name.strip().lower()
        address = self.modes.get(normalized, ZERO_ADDRESS)
        if address != ZERO_ADDRESS:
            self.approved_games[address] = False
            self._approve_in_ledger(address, False)
        self.modes[normalized] = ZERO_ADDRESS

    @gl.public.write
    def set_credit_ledger(self, ledger: Address) -> None:
        self._require_owner()
        self.credit_ledger = self._normalize_address(ledger)

    @gl.public.view
    def is_mode(self, name: str) -> bool:
        return self.modes.get(name.strip().lower(), ZERO_ADDRESS) != ZERO_ADDRESS

    @gl.public.view
    def get_mode_names(self) -> DynArray[str]:
        return self.mode_names

    def _approve_in_ledger(self, mode_address: Address, allowed: bool) -> None:
        if self.credit_ledger == ZERO_ADDRESS:
            return
        ledger = gl.get_contract_at(self.credit_ledger)
        ledger.emit(on="accepted").approve_caller(mode_address, allowed)
```

Then replace the body of `get_mode_contract` and `_contract_for_mode` to read the registry:
```python
    @gl.public.view
    def get_mode_contract(self, mode: str) -> Address:
        return self.modes.get(mode.strip().lower(), ZERO_ADDRESS)

    def _contract_for_mode(self, mode: str) -> Address:
        return self.modes.get(mode.strip().lower(), ZERO_ADDRESS)
```

And relax `_normalize_mode` so it no longer hardcodes only argue/riddle:
```python
    def _normalize_mode(self, mode: str) -> str:
        normalized = mode.strip().lower()
        if normalized in ["debate", "convince"]:
            return "argue"
        if not normalized:
            raise gl.vm.UserError("[EXPECTED] Unsupported game mode.")
        return normalized
```

- [ ] **Step 4: Run the registry tests**

Run: `pnpm exec gltest tests/direct/test_vdt_core.py -v -k mode`
Expected: PASS.

- [ ] **Step 5: Run the FULL existing core suite to catch regressions**

Run: `pnpm exec gltest tests/direct/test_vdt_core.py -v`
Expected: PASS. If older tests referenced `set_mode_contract`/`initialize_mode_contract`,
update them to use `register_mode`, or keep thin shims that forward to `register_mode`.
Document any test changes in the commit.

- [ ] **Step 6: Commit**

```bash
git add contracts/verdictdotfun.py tests/direct/test_vdt_core.py
git commit -m "feat(genlayer): generic dynamic mode registry on core"
```

---

## Task 6: Wire ledger ↔ core and lint the whole contract set

**Files:**
- Modify: `contracts/verdictdotfun.py` (no new code; verify `__init__` sets `credit_ledger = ZERO_ADDRESS`)

- [ ] **Step 1: Ensure `credit_ledger` initialized**

In `VerdictDotFun.__init__`, add:
```python
        self.credit_ledger = ZERO_ADDRESS
```

- [ ] **Step 2: Lint all changed contracts**

Run:
```bash
genvm-lint check contracts/credit_ledger.py
genvm-lint check contracts/verdictdotfun.py
```
Expected: no errors. Fix any `sender_address`/`sender_account` or `UserError` import issues the linter reports.

- [ ] **Step 3: Run full GenLayer direct suite**

Run: `pnpm exec gltest tests/direct -v`
Expected: PASS (ledger + core + existing mode tests).

- [ ] **Step 4: Commit**

```bash
git add contracts/verdictdotfun.py
git commit -m "chore(genlayer): initialize credit_ledger pointer on core"
```

---

## Self-Review (1B)

- **Spec coverage:** generic mode registry ✓ (Task 5); `CreditLedger` balances ✓; idempotent `credit` on `deposit_ref` ✓; escrow ≤ balance ✓; settlement conserves credits ✓ (Task 3 assertions); tie/void refunds ✓; redeem cannot exceed balance ✓; bare `Exception` → `gl.vm.UserError` with `[EXPECTED]` prefix ✓; atto-scale money ✓.
- **Auth model:** `approved_callers` (modes) + single `bridge` (relayer). Core approves modes in the ledger on `register_mode` via `emit(on="accepted")`.
- **Type consistency:** `Escrow.state` strings `"open"/"provisional"/"final"/"void"` are reused verbatim in Plan 1C. `finalize_winner/finalize_tie/finalize_void/set_provisional/open_escrow/request_redeem/mark_redeem_settled` signatures are referenced by 1C (mode calls) and 1D (relayer calls).
- **Open item carried to 1C:** the 1h challenge window uses `gl.message.datetime` (confirmed present in the consensus message), enforced in the mode contract — not the ledger.
- **No placeholders:** all steps contain full code/commands.
