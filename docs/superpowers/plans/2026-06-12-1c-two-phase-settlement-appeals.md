# Plan 1C — Two-Phase Settlement + GenLayer-Judged Appeals Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn match resolution into a two-phase flow — a verdict or forfeit sets a *provisional* winner and opens a 1-hour challenge window; the losing/disconnected player may file an appeal that the GenLayer contract itself judges (uphold → pay winner, overturn → void/refund); finalize releases the escrowed pot.

**Architecture:** The mode contracts (`argue_game.py`, then `riddle_game.py`) gain wager stakes, a provisional state, an appeal record, a GenLayer-judged appeal (LLM custom-validator), and a time-gated finalize using `gl.message.datetime`. Settlement money moves only at finalize via the `CreditLedger` (Plan 1B). All ledger/core calls are guarded so each mode is unit-testable in isolation (gltest Direct Mode does not support multi-contract wiring — that is verified in Plan 1D integration tests).

**Tech Stack:** GenLayer Python (pinned runner), `gltest` direct-mode tests, `gl.nondet.exec_prompt` + `gl.vm.run_nondet_unsafe` custom validator, `gl.message.datetime`.

**This is a rebuild.** The current `forfeit_room`/`_finalize_room` pay out immediately — that behavior is replaced by the provisional → appeal → finalize state machine below.

---

## Constants & state machine (shared with 1B)

- `CHALLENGE_WINDOW_SECONDS = 3600`
- Room `status`: `"ready_to_start"` → `"in_progress"` → **`"provisional"`** → `"resolved"` | `"void"`
- `appeal_state`: `"none"` → `"filed"` → `"judged"`
- `appeal_result`: `""` → `"upheld"` | `"overturned"`
- Appeal decision JSON from the LLM: `{"decision": "upheld" | "overturned", "reasoning": str}`
- Error prefixes (per GenLayer guidance): `ERROR_EXPECTED = "[EXPECTED] "`, `ERROR_LLM = "[LLM_ERROR] "`

---

## File Structure

- Modify: `contracts/argue_game.py` — stakes, provisional resolution, appeals, finalize.
- Modify: `contracts/riddle_game.py` — mirror the same lifecycle.
- Modify: `tests/direct/test_argue_game.py` — provisional/appeal/finalize tests.
- Modify: `tests/direct/test_riddle_game.py` — mirror.

---

## Task 1: Add ledger pointer + stake plumbing (argue)

**Files:**
- Modify: `contracts/argue_game.py`
- Modify: `tests/direct/test_argue_game.py`

- [ ] **Step 1: Write the failing test (room carries a stake)**

Append to `tests/direct/test_argue_game.py`:
```python
def test_room_records_stake_in_isolation(direct_vm, direct_deploy, direct_alice, direct_bob):
    # ledger + core both ZERO → mode runs standalone, escrow calls are skipped
    contract = direct_deploy("contracts/argue_game.py", ZERO_ADDRESS)
    direct_vm.sender = direct_alice
    contract.register_profile("Alice")
    contract.create_room("ROOMS1", "Tech", ZERO_ADDRESS, "debate", 2_000000000000000000)
    room = contract.get_room("ROOMS1")
    assert room.stake == 2_000000000000000000
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm exec gltest tests/direct/test_argue_game.py -v -k stake`
Expected: FAIL — `create_room` takes no stake arg / `room.stake` missing.

- [ ] **Step 3: Add fields + plumbing**

In `contracts/argue_game.py`:

(a) Add a contract-level storage field for the ledger (append at END of the class fields):
```python
    credit_ledger: Address
```

(b) In the `ArgueRoom` dataclass, append at END (upgrade-safe order):
```python
    stake: u256
    provisional_at: u256
    appeal_state: str
    appeal_reason: str
    appeal_result: str
```

(c) In `__init__`, after `self.core_contract = ...`, add:
```python
        self.credit_ledger = ZERO_ADDRESS
```

(d) Add a setter near `set_core_contract`:
```python
    @gl.public.write
    def set_credit_ledger(self, ledger: Address):
        if gl.message.sender_address != self.owner:
            raise gl.vm.UserError("[EXPECTED] Only the owner can set the ledger.")
        self.credit_ledger = self._normalize_address(ledger)
```

(e) Extend `create_room` to accept and store the stake. Update its signature to:
```python
    def create_room(
        self,
        room_id: str,
        category: str,
        owner_profile: Address = ZERO_ADDRESS,
        argue_style: str = "debate",
        stake: u256 = u256(0),
    ) -> None:
```
and where the `ArgueRoom(...)` is constructed, add the new fields:
```python
            stake=u256(int(stake)),
            provisional_at=u256(0),
            appeal_state="none",
            appeal_reason="",
            appeal_result="",
```

(f) Update the core-side interface in `contracts/verdictdotfun.py` `GameModeContract.Write.create_room`
to include the trailing `stake: u256 = u256(0)` parameter, and update both `create_room` emit
calls in core to pass the room's stake (add a `stake: u256 = u256(0)` parameter to core's
`create_room` and forward it).

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm exec gltest tests/direct/test_argue_game.py -v -k stake`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add contracts/argue_game.py contracts/verdictdotfun.py tests/direct/test_argue_game.py
git commit -m "feat(genlayer): argue rooms carry a wager stake + ledger pointer"
```

---

## Task 2: Escrow on join (guarded cross-contract call)

**Files:**
- Modify: `contracts/argue_game.py`

- [ ] **Step 1: Add a guarded escrow helper**

Add to `contracts/argue_game.py`:
```python
    def _open_escrow_if_staked(self, room: ArgueRoom):
        if self.credit_ledger == ZERO_ADDRESS:
            return
        if int(room.stake) <= 0:
            return
        ledger = gl.get_contract_at(self.credit_ledger)
        ledger.emit(on="accepted").open_escrow(
            room.id, MODE, room.owner_profile, room.opponent_profile, room.stake
        )
```

Call it at the END of `join_room`, once the opponent is set and the room has two players:
```python
        self._open_escrow_if_staked(room)
```

(Use the room's stored profile addresses. In standalone mode `credit_ledger == ZERO_ADDRESS`
so this is a no-op and existing isolation tests are unaffected. Real escrow is proven in 1D.)

- [ ] **Step 2: Run the existing argue suite (no regression)**

Run: `pnpm exec gltest tests/direct/test_argue_game.py -v`
Expected: PASS (escrow is skipped while ledger is zero).

- [ ] **Step 3: Commit**

```bash
git add contracts/argue_game.py
git commit -m "feat(genlayer): argue opens escrow on join when staked"
```

---

## Task 3: Provisional resolution (verdict + forfeit no longer pay immediately)

**Files:**
- Modify: `contracts/argue_game.py`
- Modify: `tests/direct/test_argue_game.py`

- [ ] **Step 1: Write the failing test**

Append to `tests/direct/test_argue_game.py`:
```python
def _now(direct_vm):
    # control the consensus clock used by gl.message.datetime
    import datetime as _dt
    base = _dt.datetime(2026, 6, 12, 12, 0, 0, tzinfo=_dt.timezone.utc)
    direct_vm._datetime = base
    return base


def test_verdict_sets_provisional_not_resolved(direct_vm, direct_deploy, direct_alice, direct_bob):
    _now(direct_vm)
    contract = direct_deploy("contracts/argue_game.py", ZERO_ADDRESS)

    direct_vm.mock_llm(r"(?s).*Generate one sharp debate motion.*PROV01.*",
                       {"prompt": "Cities should ban private cars downtown within a decade."})

    direct_vm.sender = direct_alice
    contract.register_profile("Alice")
    contract.create_room("PROV01", "Tech", ZERO_ADDRESS, "debate", 0)
    direct_vm.sender = direct_bob
    contract.register_profile("Bob")
    contract.join_room("PROV01")
    direct_vm.sender = direct_alice
    contract.start_room("PROV01")
    contract.submit_entry("PROV01", "Bans free up land and force better transit investment over time.")

    direct_vm.mock_llm(r"(?s).*This room uses the debate style.*",
                       {"winner": "owner", "owner_score": 88, "opponent_score": 80,
                        "reasoning": "Alice engaged the tradeoffs more directly."})
    direct_vm.sender = direct_bob
    contract.submit_entry("PROV01", "Bans punish workers before transit is good enough.")

    room = contract.get_room("PROV01")
    assert room.status == "provisional"
    assert str(room.winner).lower() == str(direct_alice).lower() or room.winner == direct_alice
    assert room.provisional_at > 0


def test_forfeit_sets_provisional(direct_vm, direct_deploy, direct_alice, direct_bob):
    _now(direct_vm)
    contract = direct_deploy("contracts/argue_game.py", ZERO_ADDRESS)
    direct_vm.mock_llm(r"(?s).*Generate one sharp debate motion.*FORF01.*",
                       {"prompt": "Remote work should be the legal default for office roles."})
    direct_vm.sender = direct_alice
    contract.register_profile("Alice")
    contract.create_room("FORF01", "Work", ZERO_ADDRESS, "debate", 0)
    direct_vm.sender = direct_bob
    contract.register_profile("Bob")
    contract.join_room("FORF01")
    # Bob quits → Alice provisional winner
    contract.forfeit_room("FORF01")

    room = contract.get_room("FORF01")
    assert room.status == "provisional"
    assert room.provisional_at > 0
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm exec gltest tests/direct/test_argue_game.py -v -k provisional`
Expected: FAIL — status becomes `"resolved"` today, not `"provisional"`.

- [ ] **Step 3: Replace immediate payout with provisional state**

Add a clock + provisional helper to `contracts/argue_game.py`:
```python
    CHALLENGE_WINDOW_SECONDS = 3600

    def _now_epoch(self) -> int:
        # gl.message.datetime is the consensus timestamp for this tx.
        dt = gl.message.datetime
        if hasattr(dt, "timestamp"):
            return int(dt.timestamp())
        # Fallback: ISO string form
        import datetime as _dt
        return int(_dt.datetime.fromisoformat(str(dt)).timestamp())

    def _enter_provisional(self, room: ArgueRoom, winner: Address):
        room.status = "provisional"
        room.winner = winner
        room.provisional_at = u256(self._now_epoch())
        self.rooms[room.id] = room
        if self.credit_ledger != ZERO_ADDRESS and int(room.stake) > 0:
            ledger = gl.get_contract_at(self.credit_ledger)
            ledger.emit(on="accepted").set_provisional(room.id, winner)
```

In `_finalize_room`, REPLACE the tail (from `room.status = "resolved"` through the
`self._emit_profile_result(...)` call) with:
```python
        room.owner_score = verdict["owner_score"]
        room.opponent_score = verdict["opponent_score"]
        room.verdict_reasoning = verdict["reasoning"]
        winner = room.owner if verdict["winner"] == "owner" else room.opponent
        self._enter_provisional(room, winner)
```
(Do NOT call `_emit_profile_result` here anymore — that moves to finalize.)

In `forfeit_room`, REPLACE the tail (`room.status = "resolved"` … `self._emit_profile_result(...)`) with:
```python
        room.owner_score = u16(0 if role == "owner" else 100)
        room.opponent_score = u16(100 if role == "owner" else 0)
        room.verdict_reasoning = f"{quitter_name} quit the room, so {winner_name} wins by forfeit."
        self._enter_provisional(room, winner)
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm exec gltest tests/direct/test_argue_game.py -v -k provisional`
Expected: PASS.

- [ ] **Step 5: Run full argue suite; fix older tests that asserted `status == "resolved"`**

Run: `pnpm exec gltest tests/direct/test_argue_game.py -v`
Expected: PASS after updating the two original flow tests to assert `"provisional"`
then call `finalize_room` (added in Task 5) to reach `"resolved"`. Update them now to:
```python
    # after both submit:
    room = contract.get_room("ROOM01")
    assert room.status == "provisional"
```
(The `"resolved"` assertion returns in Task 5 once finalize exists.)

- [ ] **Step 6: Commit**

```bash
git add contracts/argue_game.py tests/direct/test_argue_game.py
git commit -m "feat(genlayer): argue resolution/forfeit set provisional winner + window"
```

---

## Task 4: File appeal (provisional loser only, within window, once)

**Files:**
- Modify: `contracts/argue_game.py`
- Modify: `tests/direct/test_argue_game.py`

- [ ] **Step 1: Write the failing test**

Append to `tests/direct/test_argue_game.py`:
```python
def _provisional_forfeit_room(direct_vm, contract, direct_alice, direct_bob, rid="APP01"):
    direct_vm.mock_llm(r"(?s).*Generate one sharp debate motion.*" + rid + ".*",
                       {"prompt": "Schools should drop letter grades for mastery scores."})
    direct_vm.sender = direct_alice
    contract.register_profile("Alice")
    contract.create_room(rid, "Edu", ZERO_ADDRESS, "debate", 0)
    direct_vm.sender = direct_bob
    contract.register_profile("Bob")
    contract.join_room(rid)
    contract.forfeit_room(rid)  # Bob quits → Alice provisional winner; Bob is the loser


def test_loser_can_file_one_appeal(direct_vm, direct_deploy, direct_alice, direct_bob):
    _now(direct_vm)
    contract = direct_deploy("contracts/argue_game.py", ZERO_ADDRESS)
    _provisional_forfeit_room(direct_vm, contract, direct_alice, direct_bob)

    direct_vm.sender = direct_bob  # the provisional loser
    contract.file_appeal("APP01", "My wifi dropped mid-round; I did not intend to quit.")
    room = contract.get_room("APP01")
    assert room.appeal_state == "filed"

    # second appeal rejected
    with direct_vm.expect_revert("appeal"):
        contract.file_appeal("APP01", "again")


def test_winner_cannot_appeal(direct_vm, direct_deploy, direct_alice, direct_bob):
    _now(direct_vm)
    contract = direct_deploy("contracts/argue_game.py", ZERO_ADDRESS)
    _provisional_forfeit_room(direct_vm, contract, direct_alice, direct_bob)
    direct_vm.sender = direct_alice  # provisional winner
    with direct_vm.expect_revert("loser"):
        contract.file_appeal("APP01", "I should win more")
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm exec gltest tests/direct/test_argue_game.py -v -k appeal`
Expected: FAIL — `file_appeal` not defined.

- [ ] **Step 3: Implement file_appeal**

Add to `contracts/argue_game.py`:
```python
    @gl.public.write
    def file_appeal(self, room_id: str, reason: str):
        room = self._require_room(room_id)
        if room.status != "provisional":
            raise gl.vm.UserError("[EXPECTED] Only provisional rooms can be appealed.")
        if room.appeal_state != "none":
            raise gl.vm.UserError("[EXPECTED] An appeal has already been filed for this room.")

        elapsed = self._now_epoch() - int(room.provisional_at)
        if elapsed >= self.CHALLENGE_WINDOW_SECONDS:
            raise gl.vm.UserError("[EXPECTED] The challenge window has closed.")

        appellant = self._appellant_identity(room)
        loser = room.opponent if room.winner == room.owner else room.owner
        if appellant != loser:
            raise gl.vm.UserError("[EXPECTED] Only the losing player can file an appeal.")

        cleaned = reason.strip()
        if len(cleaned) < 8:
            raise gl.vm.UserError("[EXPECTED] Appeal reason must be at least 8 characters.")
        if len(cleaned) > 600:
            raise gl.vm.UserError("[EXPECTED] Appeal reason must be 600 characters or fewer.")

        room.appeal_state = "filed"
        room.appeal_reason = cleaned
        self.rooms[room.id] = room
```

Add the identity helper (resolve the calling participant, honoring core-vs-standalone):
```python
    def _appellant_identity(self, room: ArgueRoom) -> Address:
        # In core mode, the caller is a profile owner acting for a profile;
        # map sender → the room profile they control.
        sender = gl.message.sender_address
        if sender == self.owner_of_profile(room.owner_profile) or sender == room.owner:
            return room.owner
        if sender == self.owner_of_profile(room.opponent_profile) or sender == room.opponent:
            return room.opponent
        raise gl.vm.UserError("[EXPECTED] Only a participant can file an appeal.")

    def owner_of_profile(self, profile: Address) -> Address:
        # Best-effort: in standalone mode profiles ARE the wallet identities.
        if self.core_contract == ZERO_ADDRESS:
            return profile
        core = gl.get_contract_at(self.core_contract)
        return core.view().get_profile_owner(profile)
```

(If `_require_room`/`_participant_role` already expose an identity for the sender, reuse that
instead of `_appellant_identity` — keep one source of truth. The intent: the appellant must be
the provisional loser.)

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm exec gltest tests/direct/test_argue_game.py -v -k appeal`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add contracts/argue_game.py tests/direct/test_argue_game.py
git commit -m "feat(genlayer): argue appeal filing (loser-only, windowed, single)"
```

---

## Task 5: GenLayer judges the appeal (the brain) + finalize

**Files:**
- Modify: `contracts/argue_game.py`
- Modify: `tests/direct/test_argue_game.py`

- [ ] **Step 1: Write the failing tests (uphold, overturn, time-gated finalize)**

Append to `tests/direct/test_argue_game.py`:
```python
def test_appeal_upheld_resolves_to_winner(direct_vm, direct_deploy, direct_alice, direct_bob):
    _now(direct_vm)
    contract = direct_deploy("contracts/argue_game.py", ZERO_ADDRESS)
    _provisional_forfeit_room(direct_vm, contract, direct_alice, direct_bob, "JUD01")
    direct_vm.sender = direct_bob
    contract.file_appeal("JUD01", "I lagged out but the verdict reasoning stands; weak grounds.")

    direct_vm.mock_llm(r"(?s).*APPEAL REVIEW.*",
                       {"decision": "upheld", "reasoning": "No evidence the result was unfair."})
    contract.judge_appeal("JUD01")

    room = contract.get_room("JUD01")
    assert room.appeal_state == "judged"
    assert room.appeal_result == "upheld"
    assert room.status == "resolved"


def test_appeal_overturned_voids_room(direct_vm, direct_deploy, direct_alice, direct_bob):
    _now(direct_vm)
    contract = direct_deploy("contracts/argue_game.py", ZERO_ADDRESS)
    _provisional_forfeit_room(direct_vm, contract, direct_alice, direct_bob, "JUD02")
    direct_vm.sender = direct_bob
    contract.file_appeal("JUD02", "Verified network outage in my region during the match window.")

    direct_vm.mock_llm(r"(?s).*APPEAL REVIEW.*",
                       {"decision": "overturned", "reasoning": "Disconnect was a genuine fault; void."})
    contract.judge_appeal("JUD02")

    room = contract.get_room("JUD02")
    assert room.appeal_result == "overturned"
    assert room.status == "void"


def test_finalize_blocked_before_window_then_allowed(direct_vm, direct_deploy, direct_alice, direct_bob):
    base = _now(direct_vm)
    contract = direct_deploy("contracts/argue_game.py", ZERO_ADDRESS)
    _provisional_forfeit_room(direct_vm, contract, direct_alice, direct_bob, "FIN01")

    # too early — no appeal, but window not elapsed
    with direct_vm.expect_revert("window"):
        contract.finalize_room("FIN01")

    # advance the consensus clock past the window
    import datetime as _dt
    direct_vm._datetime = base + _dt.timedelta(seconds=3601)
    contract.finalize_room("FIN01")
    assert contract.get_room("FIN01").status == "resolved"
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm exec gltest tests/direct/test_argue_game.py -v -k "appeal or finalize"`
Expected: FAIL — `judge_appeal` / `finalize_room` not defined.

- [ ] **Step 3: Implement judge_appeal (LLM custom-validator) + finalize**

Add to `contracts/argue_game.py`:
```python
    @gl.public.write
    def judge_appeal(self, room_id: str):
        room = self._require_room(room_id)
        if room.status != "provisional":
            raise gl.vm.UserError("[EXPECTED] Room is not awaiting a verdict.")
        if room.appeal_state != "filed":
            raise gl.vm.UserError("[EXPECTED] No appeal is pending for this room.")

        prompt = self._build_appeal_prompt(room)

        def leader_fn():
            response = gl.nondet.exec_prompt(prompt, response_format="json")
            return self._normalize_appeal(response)

        def validator_fn(leaders_res: gl.vm.Result) -> bool:
            if not isinstance(leaders_res, gl.vm.Return):
                return False
            try:
                validator = leader_fn()
            except Exception:
                return False
            # Validators must agree on the binding field: the decision.
            return validator["decision"] == leaders_res.calldata["decision"]

        decision = gl.vm.run_nondet_unsafe(leader_fn, validator_fn)

        room.appeal_state = "judged"
        room.appeal_result = decision["decision"]
        room.verdict_reasoning = (
            room.verdict_reasoning + " | Appeal: " + decision["reasoning"]
        )

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
        if elapsed < self.CHALLENGE_WINDOW_SECONDS:
            raise gl.vm.UserError("[EXPECTED] Challenge window is still open.")
        self._settle_winner(room)

    def _settle_winner(self, room: ArgueRoom):
        room.status = "resolved"
        self.rooms[room.id] = room
        loser = room.opponent if room.winner == room.owner else room.owner
        if self.credit_ledger != ZERO_ADDRESS and int(room.stake) > 0:
            gl.get_contract_at(self.credit_ledger).emit(on="accepted").finalize_winner(room.id, room.winner)
        self._emit_profile_result(room.id, room.winner, loser)

    def _settle_void(self, room: ArgueRoom):
        if self.credit_ledger != ZERO_ADDRESS and int(room.stake) > 0:
            gl.get_contract_at(self.credit_ledger).emit(on="accepted").finalize_void(room.id)
        # No profile W/L is recorded for a voided room.

    def _build_appeal_prompt(self, room: ArgueRoom) -> str:
        return f"""APPEAL REVIEW — you are the impartial judge for a wager match.

A provisional result was reached. The losing player has appealed. Decide whether the
provisional result should stand ("upheld") or be voided and stakes refunded ("overturned").

Overturn ONLY when the appeal shows the result was unfair due to a genuine technical
fault (e.g., a verified disconnect that prevented play), NOT mere disagreement with the
verdict or a desire to replay.

Match prompt: {room.prompt}
Provisional verdict reasoning: {room.verdict_reasoning}
Owner score: {int(room.owner_score)}  Opponent score: {int(room.opponent_score)}
Appeal reason from the losing player: {room.appeal_reason}

Return JSON: {{"decision": "upheld" | "overturned", "reasoning": "<one or two sentences>"}}"""

    def _normalize_appeal(self, response: typing.Any) -> typing.Dict[str, str]:
        if not isinstance(response, dict):
            raise gl.vm.UserError("[LLM_ERROR] Appeal response was not a JSON object.")
        raw = str(response.get("decision", "")).strip().lower()
        if raw not in ["upheld", "overturned"]:
            # tolerate common synonyms
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
```

Ensure `import typing` is present at the top of `argue_game.py` (add if missing).

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm exec gltest tests/direct/test_argue_game.py -v -k "appeal or finalize"`
Expected: PASS (uphold→resolved, overturn→void, finalize time-gated).

> If clock control via `direct_vm._datetime` is not honored by your gltest version,
> set the timestamp through whatever the fixture exposes (check `tests/conftest.py`
> `message_data["datetime"]`). The contract logic under test does not change.

- [ ] **Step 5: Restore the two original flow tests to reach `"resolved"`**

In the two original argue flow tests, after asserting `"provisional"`, advance the clock and finalize:
```python
    import datetime as _dt
    direct_vm._datetime = direct_vm._datetime + _dt.timedelta(seconds=3601)
    contract.finalize_room("ROOM01")
    room = contract.get_room("ROOM01")
    assert room.status == "resolved"
    assert room.owner_score == 90
```

- [ ] **Step 6: Run full argue suite + lint**

Run:
```bash
pnpm exec gltest tests/direct/test_argue_game.py -v
genvm-lint check contracts/argue_game.py
```
Expected: PASS, no lint errors.

- [ ] **Step 7: Commit**

```bash
git add contracts/argue_game.py tests/direct/test_argue_game.py
git commit -m "feat(genlayer): GenLayer-judged appeals + time-gated finalize (argue)"
```

---

## Task 6: Mirror the lifecycle into riddle_game

**Files:**
- Modify: `contracts/riddle_game.py`
- Modify: `tests/direct/test_riddle_game.py`

- [ ] **Step 1: Write the failing riddle provisional/appeal tests**

Mirror Tasks 3–5's tests in `tests/direct/test_riddle_game.py`, adapted to riddle's flow
(three rounds; the higher score after three riddles wins; ties already exist). Concretely add:
`test_riddle_resolution_sets_provisional`, `test_riddle_forfeit_sets_provisional`,
`test_riddle_appeal_upheld_resolves`, `test_riddle_appeal_overturned_voids`,
`test_riddle_finalize_time_gated`. Use the same `_now`/clock-advance helpers and
`direct_vm.mock_llm` for any riddle generation/judging prompts the contract issues.

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm exec gltest tests/direct/test_riddle_game.py -v -k "provisional or appeal or finalize"`
Expected: FAIL.

- [ ] **Step 3: Apply the same changes to `riddle_game.py`**

Port verbatim (adjusting field/dataclass names to riddle's room type):
- `credit_ledger` field + `set_credit_ledger` + `stake` plumbing in `create_room`,
- `_open_escrow_if_staked` on join,
- `CHALLENGE_WINDOW_SECONDS`, `_now_epoch`, `_enter_provisional`,
- convert riddle's resolution + forfeit to call `_enter_provisional`,
- `file_appeal`, `judge_appeal`, `finalize_room`, `_settle_winner`, `_settle_void`,
- `_build_appeal_prompt` (reuse the same text; swap "Match prompt" context for the riddle set),
- `_normalize_appeal` (identical).

Replace any bare `raise Exception(...)` you touch with `gl.vm.UserError("[EXPECTED] ...")`.

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm exec gltest tests/direct/test_riddle_game.py -v`
Expected: PASS.

- [ ] **Step 5: Lint + full GenLayer suite**

Run:
```bash
genvm-lint check contracts/riddle_game.py
pnpm exec gltest tests/direct -v
```
Expected: PASS, no lint errors.

- [ ] **Step 6: Commit**

```bash
git add contracts/riddle_game.py tests/direct/test_riddle_game.py
git commit -m "feat(genlayer): two-phase settlement + appeals for riddle mode"
```

---

## Self-Review (1C)

- **Spec coverage:** provisional state ✓; forfeit-on-quit → provisional opponent win ✓; appeal loser-only/windowed/single ✓; GenLayer judges appeal (LLM custom validator with error classification) ✓; uphold→pay / overturn→void-refund ✓; time-gated finalize via `gl.message.datetime` ✓; settlement money moves only at finalize ✓; ledger/core calls guarded for isolated unit testing ✓; cross-contract settlement deferred to 1D integration (Direct Mode multi-contract limitation) ✓.
- **Type consistency:** mode calls `open_escrow`, `set_provisional`, `finalize_winner`, `finalize_void` exactly as defined in Plan 1B; statuses `"provisional"/"resolved"/"void"` and `appeal_state "none"/"filed"/"judged"` are consistent across tasks.
- **Carried assumption:** appeal decision is binding on the `decision` field for validator agreement; reasoning is non-binding (varies between validators) — matches GenLayer guidance on comparing stable fields only.
- **No placeholders:** all steps contain full code/commands. Task 6 intentionally reuses Task 3–5 code verbatim against the riddle room type rather than restating it.
