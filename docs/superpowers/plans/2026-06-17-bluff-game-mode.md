# Bluff Game Mode Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add "Bluff" (Convince the Judge) as a standalone GenLayer mode contract where both players argue the same hard-to-defend AI-generated claim is true, and the LLM judge scores persuasiveness while explicitly ignoring factual truth.

**Architecture:** A new `contracts/bluff_game.py` contract that mirrors the proven argue lifecycle (register -> create -> join -> start -> both submit -> judge -> provisional -> challenge window -> appeal -> finalize) on the existing credit-ledger escrow and two-phase settlement. It is its own contract at its own address, registered on `core` via `register_mode`. No shared mode logic with argue/riddle.

**Tech Stack:** GenLayer Python intelligent contract (runner pinned `py-genlayer:1jb45aa8ynh2a9c9xn3b7qqh8sm5q93hwfp7jqmwsfhh8jpz09h6`), direct-mode tests via `.venv/bin/pytest` + `direct_vm.mock_llm`, `genvm-lint`, deploy via `deploy/deploy-contract.mjs`, React/Vite UI client `src/lib/verdictArena.ts`.

**Reference (read before starting):** `contracts/argue_game.py` is the closest existing contract. This plan reproduces the Bluff-specific logic in full and cites exact argue line ranges for the shared boilerplate (escrow, appeal, helpers) that must be copied VERBATIM and adapted only by renaming `ArgueRoom`->`BluffRoom`, dropping `argue_style`/`house_stance`, and renaming the `prompt` field to `claim`.

**House rules carried from the rebuild stance:** new code raises `gl.vm.UserError("[EXPECTED] ...")` (NOT bare `Exception`); money is atto-scale `u256`; the consensus-determining value is always the discrete `winner` / numeric scores the validator agrees on, never free text.

---

### Task 1: Scaffold the contract (header, imports, interfaces, storage, constructor, owner/profile helpers)

**Files:**
- Create: `contracts/bluff_game.py`
- Test: `tests/direct/test_bluff_game.py`

- [ ] **Step 1: Write the failing test**

```python
# tests/direct/test_bluff_game.py
ZERO_ADDRESS = "0x0000000000000000000000000000000000000000"


def test_bluff_deploys_and_registers_local_profile(direct_vm, direct_deploy, direct_alice):
    contract = direct_deploy("contracts/bluff_game.py", ZERO_ADDRESS)
    direct_vm.sender = direct_alice
    contract.register_profile("Alice")
    # No exception means the contract loaded and storage works.
    assert contract.get_room_ids() == []
```

- [ ] **Step 2: Run test to verify it fails**

Run: `.venv/bin/pytest tests/direct/test_bluff_game.py::test_bluff_deploys_and_registers_local_profile -v`
Expected: FAIL — `contracts/bluff_game.py` does not exist.

- [ ] **Step 3: Write minimal implementation**

Create `contracts/bluff_game.py` with the runner header, imports, the two `@gl.contract_interface` blocks copied VERBATIM from `contracts/argue_game.py:42-58` (`VerdictDotFunCore` and `CreditLedgerIface` — identical, no changes), the module constants, the `BluffRoom` storage dataclass, the `BluffGame` contract storage + constructor, and the owner/profile helpers copied verbatim from argue.

```python
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
```

Then add the two interface classes (copy `argue_game.py:42-58` verbatim).

Then the storage dataclasses and contract shell:

```python
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
```

Now copy these helpers VERBATIM from argue, adapting only the room type name `ArgueRoom`->`BluffRoom`:
- `set_core_contract` (argue:115-118), `register_profile` (argue:120-127), `set_credit_ledger` (argue:129-132)
- `_normalize_address` (argue:918-930), `_require_owner` (argue:596-598), `_require_profile_owner` (argue:600-616), `_require_player_name` (argue:618-632), `_require_room` (argue:590-594), `_require_room_owner` (argue:650-659), `_participant_role` (argue:634-648), `_normalize_category` (argue:784-794), `_core` (argue:484-487), `_now_epoch` (argue:661-666)
- `get_room_ids` (argue:476-478), `get_core_contract` (argue:480-482)

(These are pure boilerplate identical to argue except the room type name.)

- [ ] **Step 4: Run test to verify it passes**

Run: `.venv/bin/pytest tests/direct/test_bluff_game.py::test_bluff_deploys_and_registers_local_profile -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add contracts/bluff_game.py tests/direct/test_bluff_game.py
git commit -m "feat(bluff): scaffold contract, storage, profile helpers"
```

---

### Task 2: create_room + join_room + escrow

**Files:**
- Modify: `contracts/bluff_game.py`
- Test: `tests/direct/test_bluff_game.py`

- [ ] **Step 1: Write the failing test**

```python
def test_bluff_create_and_join_room(direct_vm, direct_deploy, direct_alice, direct_bob):
    contract = direct_deploy("contracts/bluff_game.py", ZERO_ADDRESS)

    direct_vm.sender = direct_alice
    contract.register_profile("Alice")
    contract.create_room("ROOM01", "Tech", ZERO_ADDRESS, 0)

    direct_vm.sender = direct_bob
    contract.register_profile("Bob")
    contract.join_room("ROOM01")

    room = contract.get_room("ROOM01")
    assert room.mode == "bluff"
    assert room.owner_name == "Alice"
    assert room.opponent_name == "Bob"
    assert room.status == "ready_to_start"
```

- [ ] **Step 2: Run test to verify it fails**

Run: `.venv/bin/pytest tests/direct/test_bluff_game.py::test_bluff_create_and_join_room -v`
Expected: FAIL — `create_room` not defined / `get_room` not defined.

- [ ] **Step 3: Write minimal implementation**

Add `create_room` (no `argue_style`; `prompt`->`claim`, no `house_stance`), `join_room` + `_open_escrow_if_staked`, and `get_room`:

```python
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
```

`join_room`: copy argue:180-196 verbatim (it has no argue-specific fields). `_open_escrow_if_staked`: copy argue:676-683 verbatim (uses `MODE`). `get_room`: copy argue:444-474 but construct a `BluffRoom` default (drop `argue_style`/`house_stance`, `prompt`->`claim`).

- [ ] **Step 4: Run test to verify it passes**

Run: `.venv/bin/pytest tests/direct/test_bluff_game.py::test_bluff_create_and_join_room -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add contracts/bluff_game.py tests/direct/test_bluff_game.py
git commit -m "feat(bluff): create/join rooms + staked escrow"
```

---

### Task 3: start_room generates the hard claim

**Files:**
- Modify: `contracts/bluff_game.py`
- Test: `tests/direct/test_bluff_game.py`

- [ ] **Step 1: Write the failing test**

```python
def test_bluff_start_generates_claim(direct_vm, direct_deploy, direct_alice, direct_bob):
    contract = direct_deploy("contracts/bluff_game.py", ZERO_ADDRESS)

    direct_vm.mock_llm(
        r"(?s).*Generate one hard-to-defend claim.*Category: Tech.*ROOM01.*",
        {"claim": "Dial-up internet was strictly better than modern broadband for human focus."},
    )

    direct_vm.sender = direct_alice
    contract.register_profile("Alice")
    contract.create_room("ROOM01", "Tech", ZERO_ADDRESS, 0)
    direct_vm.sender = direct_bob
    contract.register_profile("Bob")
    contract.join_room("ROOM01")

    direct_vm.sender = direct_alice
    contract.start_room("ROOM01")

    room = contract.get_room("ROOM01")
    assert room.status == "active"
    assert "Dial-up" in room.claim
```

- [ ] **Step 2: Run test to verify it fails**

Run: `.venv/bin/pytest tests/direct/test_bluff_game.py::test_bluff_start_generates_claim -v`
Expected: FAIL — `start_room` not defined.

- [ ] **Step 3: Write minimal implementation**

```python
    @gl.public.write
    def start_room(self, room_id: str):
        room = self._require_room(room_id)
        if room.status == "resolved":
            raise gl.vm.UserError("[EXPECTED] Room already has a verdict.")
        if room.opponent == ZERO_ADDRESS:
            raise gl.vm.UserError("[EXPECTED] A bluff room needs two players.")
        if room.claim:
            raise gl.vm.UserError("[EXPECTED] Room already started.")
        self._require_room_owner(room)
        room.claim = self._generate_claim(room.id, room.category)
        room.status = "active"
        self.rooms[room.id] = room

    def _generate_claim(self, room_id: str, category: str) -> str:
        generation_prompt = f"""
Generate one hard-to-defend claim for a two-player persuasion game called Bluff.
Both players will argue this same claim is TRUE; the judge scores who argues more
convincingly, ignoring whether the claim is actually true.
Return valid JSON only with this key:
- "claim": one provocative, counterintuitive, or absurd-but-arguable claim, 24-200 characters

Rules:
- Category: {category}
- The claim should be fun to defend and hard to prove, not hateful or about real living people.
- Do not output lists, numbering, or explanation.
- Use the room seed "{room_id}" to vary the result.
        """.strip()

        def leader_fn():
            response = gl.nondet.exec_prompt(generation_prompt, response_format="json")
            return self._normalize_generated_claim(response)

        def validator_fn(leader_result):
            if not isinstance(leader_result, gl.vm.Return):
                return False
            return self._is_valid_generated_claim(leader_result.calldata)

        return gl.vm.run_nondet_unsafe(leader_fn, validator_fn)

    def _normalize_generated_claim(self, response: typing.Any) -> str:
        if isinstance(response, dict):
            return str(response.get("claim", "")).strip()
        return str(response).strip()

    def _is_valid_generated_claim(self, claim: typing.Any) -> bool:
        return isinstance(claim, str) and 24 <= len(claim.strip()) <= 200
```

- [ ] **Step 4: Run test to verify it passes**

Run: `.venv/bin/pytest tests/direct/test_bluff_game.py::test_bluff_start_generates_claim -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add contracts/bluff_game.py tests/direct/test_bluff_game.py
git commit -m "feat(bluff): start_room generates the hard claim"
```

---

### Task 4: submit_entry (both players defend the same claim)

**Files:**
- Modify: `contracts/bluff_game.py`
- Test: `tests/direct/test_bluff_game.py`

- [ ] **Step 1: Write the failing test** — assert the first submission stores and status stays `active`, and that submitting before `start_room` is rejected.

```python
def test_bluff_submit_requires_start_and_stores(direct_vm, direct_deploy, direct_alice, direct_bob):
    contract = direct_deploy("contracts/bluff_game.py", ZERO_ADDRESS)
    direct_vm.mock_llm(r"(?s).*Generate one hard-to-defend claim.*",
                       {"claim": "Pineapple belongs on pizza and improves digestion measurably."})
    direct_vm.sender = direct_alice
    contract.register_profile("Alice")
    contract.create_room("ROOM01", "Food", ZERO_ADDRESS, 0)
    direct_vm.sender = direct_bob
    contract.register_profile("Bob")
    contract.join_room("ROOM01")

    direct_vm.sender = direct_alice
    contract.start_room("ROOM01")
    contract.submit_entry("ROOM01", "Pineapple's bromelain genuinely aids digestion, and the sweet-savory contrast is the point of the dish.")

    room = contract.get_room("ROOM01")
    assert room.owner_submission != ""
    assert room.status == "active"
```

- [ ] **Step 2: Run** `.venv/bin/pytest tests/direct/test_bluff_game.py::test_bluff_submit_requires_start_and_stores -v` — Expected: FAIL (`submit_entry` not defined).

- [ ] **Step 3: Write minimal implementation** — copy argue `submit_entry` (argue:198-228) verbatim with these edits: error strings use `gl.vm.UserError("[EXPECTED] ...")`; the "needs two players" / "Start the room" messages say "bluff"; the `not room.prompt` check becomes `not room.claim`; keep the `if room.owner_submission and room.opponent_submission: self._finalize_room(room)` tail. Min length 40 chars (same).

- [ ] **Step 4: Run** the test — Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add contracts/bluff_game.py tests/direct/test_bluff_game.py
git commit -m "feat(bluff): submit_entry stores both players' cases"
```

---

### Task 5: _finalize_room judges persuasiveness, enters provisional

**Files:**
- Modify: `contracts/bluff_game.py`
- Test: `tests/direct/test_bluff_game.py`

- [ ] **Step 1: Write the failing test** — full flow: both submit, the second submission triggers judging via a mocked verdict, room becomes `provisional` with scores.

```python
def test_bluff_full_resolution_flow(direct_vm, direct_deploy, direct_alice, direct_bob):
    contract = direct_deploy("contracts/bluff_game.py", ZERO_ADDRESS)
    direct_vm.mock_llm(r"(?s).*Generate one hard-to-defend claim.*",
                       {"claim": "Cold showers are the single most underrated productivity tool."})
    direct_vm.sender = direct_alice
    contract.register_profile("Alice")
    contract.create_room("ROOM01", "Health", ZERO_ADDRESS, 0)
    direct_vm.sender = direct_bob
    contract.register_profile("Bob")
    contract.join_room("ROOM01")
    direct_vm.sender = direct_alice
    contract.start_room("ROOM01")
    contract.submit_entry("ROOM01", "Cold exposure spikes norepinephrine, which sharpens focus for hours; the discomfort is exactly the training stimulus.")

    direct_vm.mock_llm(
        r"(?s).*You are judging a BLUFF match.*Cold showers are the single most underrated.*",
        {"winner": "owner", "owner_score": 88, "opponent_score": 71,
         "reasoning": "Alice grounded the claim in a concrete mechanism and stayed on the persuasive task."},
    )
    direct_vm.sender = direct_bob
    contract.submit_entry("ROOM01", "Anyone can call a habit underrated; the bar is whether it beats sleep and caffeine, and cold showers plausibly do for many.")

    room = contract.get_room("ROOM01")
    assert room.status == "provisional"
    assert room.owner_score == 88
    assert room.winner != ZERO_ADDRESS
```

- [ ] **Step 2: Run** the test — Expected: FAIL (`_finalize_room` / verdict helpers not defined).

- [ ] **Step 3: Write minimal implementation** — add `resolve_room` (copy argue:248-261 verbatim, `prompt`->`claim` wording, UserError), `_finalize_room` (copy argue:263-284 verbatim — it already calls `_build_verdict_prompt`, `_normalize_verdict`, `_is_valid_verdict`, `_enter_provisional`), `_enter_provisional` (copy argue:668-674 verbatim), and the Bluff-specific verdict prompt + validators:

```python
    def _build_verdict_prompt(self, room: BluffRoom) -> str:
        return f"""You are judging a BLUFF match — a persuasion duel.

Both players were given the SAME claim and BOTH argued it is TRUE. Your job is to decide
who argued more convincingly. IMPORTANT: judge persuasive skill ONLY — rhetorical force,
internal consistency, use of concrete reasoning and vivid framing. DO NOT reward or punish
based on whether the claim is actually true; the claim may well be false. The better bluffer
wins.

CLAIM (both defend this as true):
{room.claim}

{room.owner_name} (owner) argued:
{room.owner_submission}

{room.opponent_name} (opponent) argued:
{room.opponent_submission}

Return valid JSON only with these keys:
- "winner": "owner" or "opponent"
- "owner_score": integer 0-100
- "opponent_score": integer 0-100
- "reasoning": one or two sentences on who bluffed more convincingly
The winner MUST be the player with the higher score.""".strip()

    def _normalize_verdict(self, response: typing.Any) -> TreeMap[str, typing.Any]:
        data = response if isinstance(response, dict) else {}
        winner = str(data.get("winner", "")).strip().lower()
        try:
            owner_score = int(data.get("owner_score", 0))
            opponent_score = int(data.get("opponent_score", 0))
        except (TypeError, ValueError):
            owner_score, opponent_score = 0, 0
        owner_score = max(0, min(100, owner_score))
        opponent_score = max(0, min(100, opponent_score))
        if winner not in ("owner", "opponent"):
            winner = "owner" if owner_score >= opponent_score else "opponent"
        return {
            "winner": winner,
            "owner_score": u16(owner_score),
            "opponent_score": u16(opponent_score),
            "reasoning": str(data.get("reasoning", "")).strip()[:600],
        }

    def _is_valid_verdict(self, verdict: typing.Any) -> bool:
        if not isinstance(verdict, dict):
            return False
        if verdict.get("winner") not in ("owner", "opponent"):
            return False
        return 0 <= int(verdict.get("owner_score", -1)) <= 100 and 0 <= int(verdict.get("opponent_score", -1)) <= 100
```

Also copy `_resolved_loser` (argue — find via `grep -n "_resolved_loser" contracts/argue_game.py`), `_settle_winner` (argue:685-691), `_wager_bonus_xp` (argue:693-696), `_settle_void` (argue:698-700), `_emit_profile_result` (grep argue), and `finalize_room` (argue:412-422) verbatim adapting the room type name only.

- [ ] **Step 4: Run** the test — Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add contracts/bluff_game.py tests/direct/test_bluff_game.py
git commit -m "feat(bluff): judge persuasiveness and enter provisional"
```

---

### Task 6: forfeit + two-phase finalize window + appeal (vision-evidence path)

**Files:**
- Modify: `contracts/bluff_game.py`
- Test: `tests/direct/test_bluff_game.py`

- [ ] **Step 1: Write the failing tests** — (a) a `challenge_window_seconds=0` deploy lets `finalize_room` settle to `resolved`; (b) `forfeit_room` makes the other player provisional winner; (c) `file_appeal` by the loser sets `appeal_state="filed"` and `judge_appeal` with a mocked `{"decision":"upheld"}` sets `appeal_result`.

```python
def test_bluff_finalize_after_zero_window(direct_vm, direct_deploy, direct_alice, direct_bob):
    contract = direct_deploy("contracts/bluff_game.py", ZERO_ADDRESS, False, 0)
    direct_vm.mock_llm(r"(?s).*Generate one hard-to-defend claim.*", {"claim": "Mondays are objectively the best day of the week for deep work."})
    direct_vm.sender = direct_alice
    contract.register_profile("Alice"); contract.create_room("R1", "Life", ZERO_ADDRESS, 0)
    direct_vm.sender = direct_bob
    contract.register_profile("Bob"); contract.join_room("R1")
    direct_vm.sender = direct_alice; contract.start_room("R1")
    contract.submit_entry("R1", "A fresh week means peak willpower and an empty calendar; Monday is when deep work compounds best of all.")
    direct_vm.mock_llm(r"(?s).*You are judging a BLUFF match.*",
                       {"winner": "owner", "owner_score": 80, "opponent_score": 70, "reasoning": "Owner was sharper."})
    direct_vm.sender = direct_bob
    contract.submit_entry("R1", "Monday carries the weekend's inertia; calling it best for focus ignores how most people actually feel and perform.")
    direct_vm.sender = direct_alice
    contract.finalize_room("R1")
    assert contract.get_room("R1").status == "resolved"
```

(Write the forfeit and appeal tests in the same style; mirror `tests/direct/test_argue_game.py`'s appeal tests for exact mock regexes against `_build_appeal_prompt`.)

- [ ] **Step 2: Run** the new tests — Expected: FAIL (methods not defined).

- [ ] **Step 3: Write minimal implementation** — copy VERBATIM from argue, adapting only `ArgueRoom`->`BluffRoom`: `forfeit_room` (argue:286-304), `file_appeal` (argue:306-333), `_normalize_evidence_cid` (argue:335-345), `_fetch_evidence_image` (argue:347-360), `judge_appeal` (argue:362-411), `_build_appeal_prompt` (argue:702-...; grep for its end), `_normalize_appeal` + `_appeal_errors_agree` + `_resolved_loser` (grep argue for each), `sync_profile_results` (argue:424-434), `upgrade` (argue:436-442). None of these reference `argue_style`/`house_stance`/`prompt` except `_build_appeal_prompt`, which references no claim text — confirm with a read.

- [ ] **Step 4: Run** the full file — `.venv/bin/pytest tests/direct/test_bluff_game.py -v` — Expected: PASS (all)

- [ ] **Step 5: Commit**

```bash
git add contracts/bluff_game.py tests/direct/test_bluff_game.py
git commit -m "feat(bluff): forfeit, challenge-window finalize, appeal flow"
```

---

### Task 7: Lint + full direct suite

- [ ] **Step 1:** Run the GenVM linter.

Run: `.venv/bin/genvm-lint contracts/bluff_game.py` (or per `genlayer-dev:genvm-lint` skill).
Expected: no errors (pre-existing bare-Exception WARNs are acceptable only if you introduced none — this file should have zero bare `Exception`).

- [ ] **Step 2:** Run the entire direct suite to prove no regression.

Run: `.venv/bin/pytest tests/direct -v`
Expected: all prior tests still pass + the new bluff tests.

- [ ] **Step 3: Commit** (if lint required any change)

```bash
git add contracts/bluff_game.py
git commit -m "chore(bluff): lint clean"
```

---

### Task 8: Register in the deploy pipeline

**Files:**
- Modify: `deploy/deploy-contract.mjs` (read it first to match the existing argue/riddle target wiring and the `register_mode`/`approve_caller` auto-wire)
- Modify: `deploy/deployments/genlayer-studionet.json` (add a `bluff` address slot, written by the deploy script)
- Modify: `.env.example` and `README.md` (add `VITE_BLUFF_CONTRACT_ADDRESS`)

- [ ] **Step 1:** Read `deploy/deploy-contract.mjs` and locate where `argue` and `riddle` are declared as deploy targets and registered (`core.register_mode("argue", addr)`, `ledger.approve_caller`, `mode.set_credit_ledger`, `mode.set_core_contract`).

- [ ] **Step 2:** Add a `bluff` entry to that target list pointing at `contracts/bluff_game.py`, mode name `"bluff"`, mirroring argue exactly. Add `VITE_BLUFF_CONTRACT_ADDRESS` to `.env.example` and the README address table.

- [ ] **Step 3:** Do NOT deploy yet (needs funded keys). Commit the wiring.

```bash
git add deploy/deploy-contract.mjs .env.example README.md
git commit -m "build(bluff): add bluff as a deploy target + register_mode wiring"
```

---

### Task 9: UI surface (mode config + client + lobby tile)

**Files:**
- Modify: `src/lib/verdictArena.ts` (read first; bluff reuses `createRoom`/`joinRoom`/`startRoom`/`submitEntry`/`fileAppeal`/`finalizeRoom` unchanged — verify the `mode` string threads through)
- Modify: the lobby/create-room mode picker component (find via `grep -rl "get_mode_names\|argue\|riddle" src/`)
- Modify: `.env` / Vercel env handling for `VITE_BLUFF_CONTRACT_ADDRESS`

- [ ] **Step 1:** Read `src/lib/verdictArena.ts` and the create-room component. Confirm modes are read from `core.get_mode_names()` and rendered from a per-mode config map.

- [ ] **Step 2:** Add a `bluff` entry to the per-mode UI config: label "Bluff", one-line rule "Both defend the same wild claim — out-bluff your rival.", submission widget = textarea (identical to argue). Point its room reads at `VITE_BLUFF_CONTRACT_ADDRESS`.

- [ ] **Step 3:** Run the app build to confirm no type errors.

Run: `npm run build`
Expected: build succeeds; bluff tile renders in the mode picker (verify with the `run`/`verify` skill or a screenshot once deployed).

- [ ] **Step 4: Commit**

```bash
git add src/ .env.example
git commit -m "feat(bluff): lobby tile + mode config wiring"
```

---

### Task 10: PR

- [ ] **Step 1:** Push the branch and open a PR (git flow is enforced; direct main pushes are blocked).

```bash
git push -u origin feat/five-new-game-modes
gh pr create --title 'feat: Bluff game mode' --body 'Adds the Bluff (Convince the Judge) GenLayer mode contract, direct tests, deploy wiring, and lobby tile. Live studionet deploy pending funded keys.'
```

(Use single quotes in `--body` — backticks in double quotes run as shell commands.)

- [ ] **Step 2:** Live deploy (REQUIRES funded keys — hand to user or run if `GENLAYER_DEPLOYER_PRIVATE_KEY` is set): `pnpm deploy:contract` with the bluff target, then update the 6+ Vercel prod env vars + `.env` + README + deployments json with the new address. Core address is unchanged, so the credit-bridge function does NOT need redeploy.

---

## Self-review notes

- Spec coverage: Bluff section of the spec (rubric ignores truth, both defend same claim, two-phase + appeal, lowest risk) is covered by Tasks 3 (claim gen), 5 (rubric), 6 (appeal). UI/ship covered by 8-10.
- The plan reuses argue's proven escrow/appeal/settlement verbatim, which is the correct DRY move given Bluff shares that lifecycle exactly; the ONLY net-new logic is the claim generator (Task 3) and the truth-ignoring verdict prompt (Task 5).
- Remaining four modes (Prompt Duel, Sketch, Persuade, Oracle) get their own plans written just-in-time before each build, since they diverge more and benefit from API learnings gathered while building Bluff.
