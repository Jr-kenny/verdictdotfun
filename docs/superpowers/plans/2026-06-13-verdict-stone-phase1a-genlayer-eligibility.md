# Verdict Stone — Phase 1a: GenLayer Eligibility Contract — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the GenLayer `VerdictStone` contract that owns Verdict Stone *eligibility and identity* — the escalating mint gate, the wallet↔profile binding mirror, the driving-profile rebind, and the outbound message queue the bridge relay will drain — all unit-testable in direct mode with no cross-contract or bridge dependency.

**Architecture:** A standalone GenLayer intelligent contract (`contracts/verdict_stone.py`). Account level and the wallet→profile binding are *pushed in* by a trusted operator (core / the relay), mirroring this codebase's existing sync pattern, so the contract never does a cross-contract read (direct mode can't run two contracts in one test). Mint authorizations and level-rise events are *appended to an outbox* (a `DynArray`) that the bridge relay polls; inbound facts (owner changes from the hub, effective level from the hub) are trusted operator calls. The EVM hub registry/ONFT (Phase 1b) and the actual LayerZero wiring (Phase 1c) are separate plans.

**Tech Stack:** GenLayer single-file Python contract (`from genlayer import *`), pinned runner hash, `gltest` direct mode (`.venv/bin/pytest tests/direct`), `genvm-lint`.

---

## File Structure

- **Create:** `contracts/verdict_stone.py` — the eligibility/identity contract. One responsibility: decide who may mint and at what level, track which profile drives which stone, and queue outbound bridge messages.
- **Create:** `tests/direct/test_verdict_stone.py` — direct-mode unit tests.

Conventions to follow (already used across `contracts/argue_game.py`, `riddle_game.py`, `verdictdotfun.py`):
- First line is the pinned runner header (copy exactly from `contracts/argue_game.py:1`).
- `from dataclasses import dataclass` then `try: from genlayer import * except ModuleNotFoundError: from genlayer_py import *`.
- Storage dataclasses are `@allow_storage @dataclass`. Money/ids `u256`, small counts `u16`.
- Raise `gl.vm.UserError("[EXPECTED] ...")` for business-rule failures (never bare `Exception`).
- Direct tests use the `direct_vm`, `direct_deploy`, `direct_alice`, `direct_bob`, `direct_charlie` fixtures and set `direct_vm.sender = direct_alice` (a real Address fixture, never a hex string).

---

### Task 1: Contract skeleton, storage, constructor

**Files:**
- Create: `contracts/verdict_stone.py`
- Test: `tests/direct/test_verdict_stone.py`

- [ ] **Step 1: Write the failing test**

```python
# tests/direct/test_verdict_stone.py
ZERO_ADDRESS = "0x0000000000000000000000000000000000000000"


def test_deploys_with_operator_and_empty_state(direct_vm, direct_deploy, direct_alice):
    direct_vm.sender = direct_alice
    contract = direct_deploy("contracts/verdict_stone.py", direct_alice)
    assert contract.get_outbox_len() == 0
    assert contract.get_effective_level(direct_alice) == 0
    assert contract.get_mint_gate(direct_alice) == 2  # GATE_BASE, zero mints
```

- [ ] **Step 2: Run test to verify it fails**

Run: `.venv/bin/pytest tests/direct/test_verdict_stone.py::test_deploys_with_operator_and_empty_state -v`
Expected: FAIL (file `contracts/verdict_stone.py` does not exist).

- [ ] **Step 3: Write minimal implementation**

```python
# contracts/verdict_stone.py
# { "Depends": "py-genlayer:1jb45aa8ynh2a9c9xn3b7qqh8sm5q93hwfp7jqmwsfhh8jpz09h6" }

from dataclasses import dataclass
import typing

try:
    from genlayer import *
except ModuleNotFoundError:
    from genlayer_py import *


ZERO_ADDRESS = Address("0x0000000000000000000000000000000000000000")
GATE_BASE = 2  # account level required for a profile's FIRST stone


@allow_storage
@dataclass
class StoneDriver:
    token_id: u256          # the stone this profile currently drives (0 = none)
    last_emitted_level: u16  # highest level already queued for that stone


@allow_storage
@dataclass
class OutboundMessage:
    kind: str               # "mint" | "raise"
    token_id: u256
    profile: Address
    owner: Address
    level: u16
    nonce: u256


class VerdictStone(gl.Contract):
    owner: Address
    operator: Address                              # trusted caller for sync + inbound facts
    level_of_profile: TreeMap[Address, u16]        # mirrored account level (pushed in)
    profile_of_owner: TreeMap[Address, Address]    # wallet -> profile binding mirror
    effective_level_of_profile: TreeMap[Address, u16]  # perks level (pushed from hub)
    mint_count: TreeMap[Address, u16]              # stones minted per profile
    driver_of_profile: TreeMap[Address, StoneDriver]
    profile_of_token: TreeMap[str, Address]        # token_id(str) -> current driver profile
    outbox: DynArray[OutboundMessage]
    next_token_id: u256
    next_nonce: u256
    relayed_cursor: u256

    def __init__(self, operator: Address = ZERO_ADDRESS):
        self.owner = gl.message.sender_address
        self.operator = operator if operator != ZERO_ADDRESS else gl.message.sender_address
        self.next_token_id = u256(1)
        self.next_nonce = u256(1)
        self.relayed_cursor = u256(0)

    def _empty_driver(self) -> StoneDriver:
        return StoneDriver(token_id=u256(0), last_emitted_level=u16(0))

    def _gate_for(self, mint_count: int) -> int:
        # Steeper jump per mint (tunable): 2, 4, 7, 11, 16, ... (step grows by 1 each time).
        n = int(mint_count)
        return GATE_BASE + (n * (n + 3)) // 2

    @gl.public.view
    def get_mint_gate(self, profile: Address) -> int:
        return self._gate_for(int(self.mint_count.get(profile, u16(0))))

    @gl.public.view
    def get_effective_level(self, profile: Address) -> int:
        return int(self.effective_level_of_profile.get(profile, u16(0)))

    @gl.public.view
    def get_outbox_len(self) -> int:
        return len(self.outbox)
```

- [ ] **Step 4: Run test to verify it passes**

Run: `.venv/bin/pytest tests/direct/test_verdict_stone.py::test_deploys_with_operator_and_empty_state -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add contracts/verdict_stone.py tests/direct/test_verdict_stone.py
git commit -m "feat(stone): VerdictStone skeleton — storage, constructor, gate view"
```

---

### Task 2: The escalating mint gate

**Files:**
- Modify: `contracts/verdict_stone.py` (already has `_gate_for`/`get_mint_gate` from Task 1 — this task only adds tests proving the sequence and is where you'd tune the curve)
- Test: `tests/direct/test_verdict_stone.py`

- [ ] **Step 1: Write the failing test**

```python
def test_mint_gate_escalates_steeper_each_mint(direct_vm, direct_deploy, direct_alice):
    direct_vm.sender = direct_alice
    contract = direct_deploy("contracts/verdict_stone.py", direct_alice)
    # No public setter for mint_count yet; verify the pure curve via repeated request_mint
    # is covered in Task 4. Here, assert the documented sequence through the view by
    # syncing a high level and minting repeatedly.
    contract.sync_level(direct_alice, 100, direct_alice)  # bind + level high enough for many gates
    assert contract.get_mint_gate(direct_alice) == 2
    contract.request_mint()
    assert contract.get_mint_gate(direct_alice) == 4
    contract.request_mint()
    assert contract.get_mint_gate(direct_alice) == 7
    contract.request_mint()
    assert contract.get_mint_gate(direct_alice) == 11
```

- [ ] **Step 2: Run test to verify it fails**

Run: `.venv/bin/pytest tests/direct/test_verdict_stone.py::test_mint_gate_escalates_steeper_each_mint -v`
Expected: FAIL (`sync_level` / `request_mint` not defined yet). This is expected; the methods land in Tasks 3 and 4. Leave this test in place; it goes green at the end of Task 4.

- [ ] **Step 3: (no code change)** The curve is already implemented in `_gate_for` (Task 1). No new code in this task.

- [ ] **Step 4: Commit the pending test**

```bash
git add tests/direct/test_verdict_stone.py
git commit -m "test(stone): pin the escalating mint-gate sequence (2,4,7,11)"
```

---

### Task 3: sync_level — trusted push of account level + binding, with rise detection

**Files:**
- Modify: `contracts/verdict_stone.py`
- Test: `tests/direct/test_verdict_stone.py`

- [ ] **Step 1: Write the failing test**

```python
def test_sync_level_mirrors_level_and_binding(direct_vm, direct_deploy, direct_alice, direct_bob):
    direct_vm.sender = direct_alice
    contract = direct_deploy("contracts/verdict_stone.py", direct_alice)
    contract.sync_level(direct_bob, 5, direct_bob)  # profile=bob owner=bob
    assert contract.get_mint_gate(direct_bob) == 2   # still zero mints
    # syncing level when the profile drives no stone queues nothing
    assert contract.get_outbox_len() == 0


def test_sync_level_requires_operator(direct_vm, direct_deploy, direct_alice, direct_bob):
    direct_vm.sender = direct_alice
    contract = direct_deploy("contracts/verdict_stone.py", direct_alice)  # alice is operator
    direct_vm.sender = direct_bob  # not operator
    with direct_vm.expect_revert("operator"):
        contract.sync_level(direct_bob, 5, direct_bob)
```

- [ ] **Step 2: Run test to verify it fails**

Run: `.venv/bin/pytest tests/direct/test_verdict_stone.py::test_sync_level_mirrors_level_and_binding tests/direct/test_verdict_stone.py::test_sync_level_requires_operator -v`
Expected: FAIL (`sync_level` not defined).

- [ ] **Step 3: Write minimal implementation**

Add to `contracts/verdict_stone.py`:

```python
    def _require_operator(self):
        if gl.message.sender_address != self.operator and gl.message.sender_address != self.owner:
            raise gl.vm.UserError("[EXPECTED] Only the operator may call this.")

    def _enqueue(self, kind: str, token_id: u256, profile: Address, owner: Address, level: u16):
        self.outbox.append(OutboundMessage(
            kind=kind, token_id=token_id, profile=profile, owner=owner, level=level, nonce=self.next_nonce,
        ))
        self.next_nonce = self.next_nonce + u256(1)

    @gl.public.write
    def sync_level(self, profile: Address, level: u16, owner: Address = ZERO_ADDRESS):
        self._require_operator()
        self.level_of_profile[profile] = level
        if owner != ZERO_ADDRESS:
            self.profile_of_owner[owner] = profile
        driver = self.driver_of_profile.get(profile, self._empty_driver())
        if int(driver.token_id) != 0 and int(level) > int(driver.last_emitted_level):
            self._enqueue("raise", driver.token_id, profile, ZERO_ADDRESS, level)
            self.driver_of_profile[profile] = StoneDriver(token_id=driver.token_id, last_emitted_level=level)
```

- [ ] **Step 4: Run test to verify it passes**

Run: `.venv/bin/pytest tests/direct/test_verdict_stone.py::test_sync_level_mirrors_level_and_binding tests/direct/test_verdict_stone.py::test_sync_level_requires_operator -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add contracts/verdict_stone.py tests/direct/test_verdict_stone.py
git commit -m "feat(stone): sync_level — push account level + binding, detect rises"
```

---

### Task 4: request_mint — gate check, token id allocation, mint message

**Files:**
- Modify: `contracts/verdict_stone.py`
- Test: `tests/direct/test_verdict_stone.py`

- [ ] **Step 1: Write the failing test**

```python
def test_request_mint_below_gate_reverts(direct_vm, direct_deploy, direct_alice, direct_bob):
    direct_vm.sender = direct_alice
    contract = direct_deploy("contracts/verdict_stone.py", direct_alice)
    contract.sync_level(direct_bob, 1, direct_bob)  # level 1 < gate 2
    direct_vm.sender = direct_bob
    with direct_vm.expect_revert("below the mint gate"):
        contract.request_mint()


def test_request_mint_requires_linked_profile(direct_vm, direct_deploy, direct_alice, direct_bob):
    direct_vm.sender = direct_alice
    contract = direct_deploy("contracts/verdict_stone.py", direct_alice)
    direct_vm.sender = direct_bob  # bob never linked a profile
    with direct_vm.expect_revert("Link a profile"):
        contract.request_mint()


def test_request_mint_queues_mint_and_sets_driver(direct_vm, direct_deploy, direct_alice, direct_bob):
    direct_vm.sender = direct_alice
    contract = direct_deploy("contracts/verdict_stone.py", direct_alice)
    contract.sync_level(direct_bob, 3, direct_bob)
    direct_vm.sender = direct_bob
    contract.request_mint()
    assert contract.get_outbox_len() == 1
    msg = contract.get_outbox_message(0)
    assert msg["kind"] == "mint"
    assert int(msg["token_id"]) == 1
    assert int(msg["level"]) == 3
```

- [ ] **Step 2: Run test to verify it fails**

Run: `.venv/bin/pytest tests/direct/test_verdict_stone.py -k request_mint -v`
Expected: FAIL (`request_mint` / `get_outbox_message` not defined).

- [ ] **Step 3: Write minimal implementation**

Add to `contracts/verdict_stone.py`:

```python
    @gl.public.write
    def request_mint(self):
        owner = gl.message.sender_address
        profile = self.profile_of_owner.get(owner, ZERO_ADDRESS)
        if profile == ZERO_ADDRESS:
            raise gl.vm.UserError("[EXPECTED] Link a profile before minting.")
        level = int(self.level_of_profile.get(profile, u16(0)))
        gate = self._gate_for(int(self.mint_count.get(profile, u16(0))))
        if level < gate:
            raise gl.vm.UserError(f"[EXPECTED] Account level {level} is below the mint gate {gate}.")

        token_id = self.next_token_id
        self.next_token_id = self.next_token_id + u256(1)
        self.mint_count[profile] = u16(int(self.mint_count.get(profile, u16(0))) + 1)
        self.driver_of_profile[profile] = StoneDriver(token_id=token_id, last_emitted_level=u16(level))
        self.profile_of_token[str(int(token_id))] = profile
        self._enqueue("mint", token_id, profile, owner, u16(level))

    @gl.public.view
    def get_outbox_message(self, index: int) -> TreeMap[str, typing.Any]:
        m = self.outbox[index]
        out: TreeMap[str, typing.Any] = TreeMap()
        out["kind"] = m.kind
        out["token_id"] = int(m.token_id)
        out["profile"] = m.profile
        out["owner"] = m.owner
        out["level"] = int(m.level)
        out["nonce"] = int(m.nonce)
        return out
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `.venv/bin/pytest tests/direct/test_verdict_stone.py -k "request_mint or escalates" -v`
Expected: PASS (this also turns Task 2's `test_mint_gate_escalates_steeper_each_mint` green).

- [ ] **Step 5: Commit**

```bash
git add contracts/verdict_stone.py tests/direct/test_verdict_stone.py
git commit -m "feat(stone): request_mint — gate check, token-id, queued mint message"
```

---

### Task 5: on_owner_changed — driver rebind on trade

**Files:**
- Modify: `contracts/verdict_stone.py`
- Test: `tests/direct/test_verdict_stone.py`

- [ ] **Step 1: Write the failing test**

```python
def test_owner_change_rebinds_driver_to_bound_buyer(direct_vm, direct_deploy, direct_alice, direct_bob, direct_charlie):
    direct_vm.sender = direct_alice
    contract = direct_deploy("contracts/verdict_stone.py", direct_alice)
    contract.sync_level(direct_bob, 3, direct_bob)
    direct_vm.sender = direct_bob
    contract.request_mint()           # token 1, driven by bob
    # charlie links a profile, then buys the stone
    direct_vm.sender = direct_alice
    contract.sync_level(direct_charlie, 1, direct_charlie)  # charlie bound, low level
    contract.on_owner_changed(1, direct_charlie)
    # a rise for charlie now queues a raise for token 1 (the stone he drives)
    base_len = contract.get_outbox_len()
    contract.sync_level(direct_charlie, 9, direct_charlie)
    assert contract.get_outbox_len() == base_len + 1
    last = contract.get_outbox_message(contract.get_outbox_len() - 1)
    assert last["kind"] == "raise"
    assert int(last["token_id"]) == 1


def test_owner_change_to_unbound_wallet_leaves_stone_driverless(direct_vm, direct_deploy, direct_alice, direct_bob, direct_charlie):
    direct_vm.sender = direct_alice
    contract = direct_deploy("contracts/verdict_stone.py", direct_alice)
    contract.sync_level(direct_bob, 3, direct_bob)
    direct_vm.sender = direct_bob
    contract.request_mint()           # token 1, driven by bob
    direct_vm.sender = direct_alice
    contract.on_owner_changed(1, direct_charlie)  # charlie has no linked profile
    # bob no longer drives token 1: a rise for bob queues nothing
    base_len = contract.get_outbox_len()
    contract.sync_level(direct_bob, 50, direct_bob)
    assert contract.get_outbox_len() == base_len
```

- [ ] **Step 2: Run test to verify it fails**

Run: `.venv/bin/pytest tests/direct/test_verdict_stone.py -k owner_change -v`
Expected: FAIL (`on_owner_changed` not defined).

- [ ] **Step 3: Write minimal implementation**

Add to `contracts/verdict_stone.py`:

```python
    @gl.public.write
    def on_owner_changed(self, token_id: u256, new_owner: Address):
        self._require_operator()
        tid = str(int(token_id))
        old_profile = self.profile_of_token.get(tid, ZERO_ADDRESS)
        if old_profile != ZERO_ADDRESS:
            old_driver = self.driver_of_profile.get(old_profile, self._empty_driver())
            if int(old_driver.token_id) == int(token_id):
                self.driver_of_profile[old_profile] = self._empty_driver()

        new_profile = self.profile_of_owner.get(new_owner, ZERO_ADDRESS)
        self.profile_of_token[tid] = new_profile
        if new_profile != ZERO_ADDRESS:
            seed = u16(int(self.level_of_profile.get(new_profile, u16(0))))
            self.driver_of_profile[new_profile] = StoneDriver(token_id=token_id, last_emitted_level=seed)
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `.venv/bin/pytest tests/direct/test_verdict_stone.py -k owner_change -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add contracts/verdict_stone.py tests/direct/test_verdict_stone.py
git commit -m "feat(stone): on_owner_changed — rebind driver to bound buyer, else driverless"
```

---

### Task 6: Effective level intake + relay outbox cursor

**Files:**
- Modify: `contracts/verdict_stone.py`
- Test: `tests/direct/test_verdict_stone.py`

- [ ] **Step 1: Write the failing test**

```python
def test_receive_effective_level_and_read(direct_vm, direct_deploy, direct_alice, direct_bob):
    direct_vm.sender = direct_alice
    contract = direct_deploy("contracts/verdict_stone.py", direct_alice)
    contract.receive_effective_level(direct_bob, 7)
    assert contract.get_effective_level(direct_bob) == 7
    direct_vm.sender = direct_bob
    with direct_vm.expect_revert("operator"):
        contract.receive_effective_level(direct_bob, 99)


def test_relay_cursor_advances(direct_vm, direct_deploy, direct_alice, direct_bob):
    direct_vm.sender = direct_alice
    contract = direct_deploy("contracts/verdict_stone.py", direct_alice)
    contract.sync_level(direct_bob, 3, direct_bob)
    direct_vm.sender = direct_bob
    contract.request_mint()
    direct_vm.sender = direct_alice
    assert contract.get_relayed_cursor() == 0
    contract.mark_relayed(1)
    assert contract.get_relayed_cursor() == 1
```

- [ ] **Step 2: Run test to verify it fails**

Run: `.venv/bin/pytest tests/direct/test_verdict_stone.py -k "effective_level or relay_cursor" -v`
Expected: FAIL (`receive_effective_level` / `mark_relayed` / `get_relayed_cursor` not defined).

- [ ] **Step 3: Write minimal implementation**

Add to `contracts/verdict_stone.py`:

```python
    @gl.public.write
    def receive_effective_level(self, profile: Address, level: u16):
        self._require_operator()
        self.effective_level_of_profile[profile] = level

    @gl.public.write
    def mark_relayed(self, upto_index: u256):
        self._require_operator()
        self.relayed_cursor = upto_index

    @gl.public.view
    def get_relayed_cursor(self) -> int:
        return int(self.relayed_cursor)
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `.venv/bin/pytest tests/direct/test_verdict_stone.py -k "effective_level or relay_cursor" -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add contracts/verdict_stone.py tests/direct/test_verdict_stone.py
git commit -m "feat(stone): effective-level intake + relay outbox cursor"
```

---

### Task 7: Lint and full direct suite

**Files:** none (verification only)

- [ ] **Step 1: Lint the contract**

Run: `.venv/bin/genvm-lint check contracts/verdict_stone.py`
Expected: `✓ Validation passed` with no bare-`Exception` warnings for `verdict_stone.py` (all raises use `gl.vm.UserError`).

- [ ] **Step 2: Run the whole direct suite (no regressions)**

Run: `.venv/bin/pytest tests/direct -q`
Expected: all prior tests still pass plus the new `test_verdict_stone.py` cases; `1 xfailed` (the pre-existing c2c xfail) unchanged.

- [ ] **Step 3: Commit (only if lint required a fix; otherwise skip)**

```bash
git add contracts/verdict_stone.py
git commit -m "chore(stone): lint clean"
```

---

## Self-Review

**Spec coverage (against `2026-06-13-verdict-stone-nft-design.md`, GenLayer tier + Phase 1):**
- Wallet↔profile binding → `sync_level(..., owner)` mirror + used by `request_mint`/`on_owner_changed`. ✓
- Escalating mint gate (steeper jump) → `_gate_for` (2,4,7,11,…), bumped in `request_mint`, Task 2/4 tests. ✓
- Mint authorization (starting level, gate bump, message out) → `request_mint` → `_enqueue("mint", …)`. ✓
- Driver rebind on trade → `on_owner_changed` (bound buyer drives; unbound ⇒ driverless, holds). ✓
- Level-rise emission (ratchet) → `sync_level` queues `"raise"` only when level exceeds `last_emitted_level`; hub applies `max` (Phase 1b), so a too-low emit is a safe no-op. ✓
- Effective level receipt + perks read → `receive_effective_level` / `get_effective_level`. ✓
- Outbox for the relay → `outbox`, `get_outbox_len`, `get_outbox_message`, `mark_relayed`, `get_relayed_cursor`. ✓
- Out of scope here (separate plans): actual bridge send/receive wiring (Phase 1c), the EVM hub `StoneRegistry`/ONFT that consumes `"mint"`/`"raise"` and emits owner-changes (Phase 1b), spoke roaming (Phase 2).

**Placeholder scan:** No TBD/TODO; every code step is complete. Task 2 deliberately has no code (the curve ships in Task 1) and its test goes green in Task 4 — called out explicitly.

**Type consistency:** `StoneDriver{token_id:u256,last_emitted_level:u16}` and `OutboundMessage{kind,token_id,profile,owner,level,nonce}` are used identically across `_enqueue`, `sync_level`, `request_mint`, `on_owner_changed`. `_gate_for`/`get_mint_gate`/`get_outbox_message`/`get_relayed_cursor` signatures match their call sites in tests.

**Note on `get_outbox_message` return:** returns a `TreeMap[str, Any]`; tests read it with `msg["kind"]`. If direct-mode decoding surfaces it as attributes instead of keys, adjust the test accessor (the wager-framework `get_room` tests read via attributes — confirm on first run and match whichever the harness returns).
