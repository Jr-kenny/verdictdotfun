# Prompt Duel Game Mode Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Add "Prompt Duel" (Prompt Golf): the AI generates a target output, both players submit a PROMPT, and the LLM judge scores how closely each prompt would reproduce the target. Prompt brevity breaks ties (the "golf").

**Architecture:** A new `contracts/prompt_duel_game.py` that is a copy of the finished, lint-clean `contracts/bluff_game.py` with the identifiers renamed and FOUR methods diverged (target generation, submission validation, the verdict prompt, and a deterministic brevity tiebreak in finalize). It is its own contract at its own address, mode name `"prompt_duel"`, registered on `core`. Same room/escrow/two-phase-appeal spine as bluff/argue.

**Tech Stack:** GenLayer Python (runner `py-genlayer:1jb45aa8ynh2a9c9xn3b7qqh8sm5q93hwfp7jqmwsfhh8jpz09h6`), direct-mode tests via `.venv/bin/pytest` + `direct_vm.mock_llm`, `.venv/bin/genvm-lint`, deploy via `deploy/deploy-contract.mjs`, UI via `src/lib/gameModes.ts` + friends.

**Template:** `contracts/bluff_game.py` is the canonical template (already lint-clean, zero bare `Exception`). Copy it wholesale, then change ONLY what this plan specifies. The room field `claim` becomes `target`. Consensus rule holds: the LLM's produced outputs are leader-only flavor; the settlement value is the discrete `winner` + numeric scores the validator agrees on.

---

### Task 1: Copy + rename the contract, diverge target generation and the verdict

**Files:**
- Create: `contracts/prompt_duel_game.py`
- Test: `tests/direct/test_prompt_duel_game.py`

- [ ] **Step 1: Write the failing test** (full happy path: start generates a target, both submit prompts, judging makes the room provisional).

```python
ZERO_ADDRESS = "0x0000000000000000000000000000000000000000"


def test_prompt_duel_full_resolution_flow(direct_vm, direct_deploy, direct_alice, direct_bob):
    contract = direct_deploy("contracts/prompt_duel_game.py", ZERO_ADDRESS)

    direct_vm.mock_llm(
        r"(?s).*Generate one target OUTPUT.*Category: Poetry.*ROOM01.*",
        {"target": "A short four-line poem about the sea at dawn, gentle and hopeful, with an ABAB rhyme."},
    )

    direct_vm.sender = direct_alice
    contract.register_profile("Alice")
    contract.create_room("ROOM01", "Poetry", ZERO_ADDRESS, 0)
    direct_vm.sender = direct_bob
    contract.register_profile("Bob")
    contract.join_room("ROOM01")
    direct_vm.sender = direct_alice
    contract.start_room("ROOM01")
    contract.submit_entry("ROOM01", "Write a four-line ABAB poem about the sea at dawn, gentle and hopeful.")

    direct_vm.mock_llm(
        r"(?s).*You are judging a PROMPT DUEL.*A short four-line poem about the sea at dawn.*",
        {"winner": "owner", "owner_score": 92, "opponent_score": 64,
         "reasoning": "Alice's prompt specifies form, subject, and tone, so its output lands closest to the target."},
    )
    direct_vm.sender = direct_bob
    contract.submit_entry("ROOM01", "write a poem about the ocean")

    room = contract.get_room("ROOM01")
    assert room.status == "provisional"
    assert room.target != ""
    assert room.owner_score == 92
    assert room.winner != ZERO_ADDRESS
```

- [ ] **Step 2: Run** `.venv/bin/pytest tests/direct/test_prompt_duel_game.py::test_prompt_duel_full_resolution_flow -v` — Expected: FAIL (contract does not exist).

- [ ] **Step 3: Implement.**

(a) Copy `contracts/bluff_game.py` to `contracts/prompt_duel_game.py`. Then do these exact renames across the whole file: `BluffGame`->`PromptDuelGame`, `BluffRoom`->`PromptDuelRoom`, `MODE = "bluff"`->`MODE = "prompt_duel"`, the storage/default-room field `claim`->`target`, and any message text mentioning "bluff" -> "prompt duel". The `BluffRoom(...)` constructor calls (in `create_room` and the `get_room` default) become `PromptDuelRoom(...)` with `target=""` instead of `claim=""`.

(b) Replace `_generate_claim`/`_normalize_generated_claim`/`_is_valid_generated_claim` with target generation:

```python
    def _generate_target(self, room_id: str, category: str) -> str:
        generation_prompt = f"""
Generate one target OUTPUT for a two-player Prompt Duel game. Players will each write a
prompt that tries to make a language model reproduce this target as closely as possible.
Return valid JSON only with this key:
- "target": a concrete, self-contained target output, 60-400 characters (e.g. a short poem
  spec, a precise paragraph, a small JSON object described in words, a tagline). It must be
  specific enough that prompt quality clearly matters.

Rules:
- Category: {category}
- Make it reproducible-but-not-trivial: rewards a precise prompt over a lazy one.
- Do not output lists, numbering, or meta commentary.
- Use the room seed "{room_id}" to vary the result.
        """.strip()

        def leader_fn():
            response = gl.nondet.exec_prompt(generation_prompt, response_format="json")
            return self._normalize_generated_target(response)

        def validator_fn(leader_result):
            if not isinstance(leader_result, gl.vm.Return):
                return False
            return self._is_valid_generated_target(leader_result.calldata)

        return gl.vm.run_nondet_unsafe(leader_fn, validator_fn)

    def _normalize_generated_target(self, response: typing.Any) -> str:
        if isinstance(response, dict):
            return str(response.get("target", "")).strip()
        return str(response).strip()

    def _is_valid_generated_target(self, target: typing.Any) -> bool:
        return isinstance(target, str) and 60 <= len(target.strip()) <= 400
```

In `start_room`, change `room.claim = self._generate_claim(...)` to `room.target = self._generate_target(room.id, room.category)`, and the `if room.claim:` guard to `if room.target:`.

(c) Replace `_build_verdict_prompt` with the Prompt Duel rubric (single consensus-checked call that reasons about what each prompt would produce):

```python
    def _build_verdict_prompt(self, room: PromptDuelRoom) -> str:
        return f"""You are judging a PROMPT DUEL.

There is a TARGET output below. Each player wrote a PROMPT. For each prompt, imagine the
output a capable language model would produce from it, then score how closely that output
would reproduce the TARGET (0-100: 100 = essentially identical in content, form, and tone).
Judge the PROMPTS by the outputs they would yield — not by how the prompt is worded.

TARGET:
{room.target}

{room.owner_name} (owner) prompt:
{room.owner_submission}

{room.opponent_name} (opponent) prompt:
{room.opponent_submission}

Return valid JSON only with these keys:
- "winner": "owner" or "opponent"
- "owner_score": integer 0-100
- "opponent_score": integer 0-100
- "reasoning": one or two sentences on which prompt better reproduces the target
The winner MUST be the player with the higher score.""".strip()
```

(d) `_normalize_verdict` and `_is_valid_verdict`: keep bluff's versions verbatim (they are generic).

(e) Add the brevity tiebreak in `_finalize_room`. After computing `verdict`, replace the winner line with:

```python
        owner_score = int(verdict["owner_score"])
        opponent_score = int(verdict["opponent_score"])
        if owner_score == opponent_score:
            # Golf: on a tie, the shorter prompt wins; if equal length, the judge's call stands.
            owner_len = len(room.owner_submission.strip())
            opponent_len = len(room.opponent_submission.strip())
            if owner_len != opponent_len:
                winner_role = "owner" if owner_len < opponent_len else "opponent"
            else:
                winner_role = verdict["winner"]
        else:
            winner_role = verdict["winner"]
        room.owner_score = verdict["owner_score"]
        room.opponent_score = verdict["opponent_score"]
        room.verdict_reasoning = verdict["reasoning"]
        winner = room.owner if winner_role == "owner" else room.opponent
        self._enter_provisional(room, winner)
```

- [ ] **Step 4: Run** the test — Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add contracts/prompt_duel_game.py tests/direct/test_prompt_duel_game.py
git commit -m "feat(prompt-duel): contract, target generation, similarity verdict + brevity tiebreak"
```

---

### Task 2: Submission validation for prompts + a brevity-tiebreak test + appeal/forfeit tests + lint

**Files:**
- Modify: `contracts/prompt_duel_game.py`
- Modify: `tests/direct/test_prompt_duel_game.py`

- [ ] **Step 1: Write failing tests:**
  (a) a prompt shorter than 3 chars is rejected; a prompt over 500 chars is rejected.
  (b) a tie on scores resolves to the shorter prompt's author.
  (c) forfeit makes the other player provisional winner (mirror the bluff forfeit test).
  (d) `file_appeal` by the loser + `judge_appeal` with mocked `{"decision":"upheld"}` sets `appeal_result` (mirror the bluff appeal test; the appeal prompt regex is the same as bluff's `_build_appeal_prompt`).

```python
def test_prompt_duel_rejects_bad_prompt_length(direct_vm, direct_deploy, direct_alice, direct_bob):
    contract = direct_deploy("contracts/prompt_duel_game.py", ZERO_ADDRESS)
    direct_vm.mock_llm(r"(?s).*Generate one target OUTPUT.*", {"target": "A precise two-sentence product blurb for a reusable steel water bottle, friendly and concrete."})
    direct_vm.sender = direct_alice
    contract.register_profile("Alice"); contract.create_room("R1", "Marketing", ZERO_ADDRESS, 0)
    direct_vm.sender = direct_bob
    contract.register_profile("Bob"); contract.join_room("R1")
    direct_vm.sender = direct_alice; contract.start_room("R1")
    import pytest
    with pytest.raises(Exception):
        contract.submit_entry("R1", "x")  # too short


def test_prompt_duel_tie_breaks_on_brevity(direct_vm, direct_deploy, direct_alice, direct_bob):
    contract = direct_deploy("contracts/prompt_duel_game.py", ZERO_ADDRESS)
    direct_vm.mock_llm(r"(?s).*Generate one target OUTPUT.*", {"target": "A precise two-sentence product blurb for a reusable steel water bottle, friendly and concrete."})
    direct_vm.sender = direct_alice
    contract.register_profile("Alice"); contract.create_room("R2", "Marketing", ZERO_ADDRESS, 0)
    direct_vm.sender = direct_bob
    contract.register_profile("Bob"); contract.join_room("R2")
    direct_vm.sender = direct_alice; contract.start_room("R2")
    contract.submit_entry("R2", "Two friendly concrete sentences for a reusable steel water bottle product blurb.")
    direct_vm.mock_llm(r"(?s).*You are judging a PROMPT DUEL.*",
                       {"winner": "owner", "owner_score": 80, "opponent_score": 80, "reasoning": "Equally close."})
    direct_vm.sender = direct_bob
    contract.submit_entry("R2", "Blurb: reusable steel water bottle, two sentences, friendly, concrete.")  # shorter
    room = contract.get_room("R2")
    # Bob's prompt is shorter -> opponent wins the tie.
    assert room.status == "provisional"
    assert room.winner == room.opponent
```

- [ ] **Step 2: Run** the new tests — Expected: FAIL for (a) until validation is tightened; (b) should already pass from Task 1's tiebreak; (c)/(d) FAIL until you confirm the copied methods work with the mocks.

- [ ] **Step 3: Implement** — in the copied `submit_entry`, change the bluff length rule (`< 40` chars) to a prompt rule: reject `len(text) < 3` ("[EXPECTED] Your prompt must be at least 3 characters.") and `len(text) > 500` ("[EXPECTED] Prompts must be 500 characters or fewer."). Keep everything else (role, already-submitted guard, the `if both submitted: self._finalize_room`) identical.

- [ ] **Step 4: Run** the whole file — `.venv/bin/pytest tests/direct/test_prompt_duel_game.py -v` — Expected: all PASS.

- [ ] **Step 5:** Lint + full suite. Run `.venv/bin/genvm-lint contracts/prompt_duel_game.py` (expect 0 warnings — the template was clean) and confirm `grep -n "raise Exception" contracts/prompt_duel_game.py` is empty. Run `.venv/bin/pytest tests/direct -q` (expect no regressions).

- [ ] **Step 6: Commit**

```bash
git add contracts/prompt_duel_game.py tests/direct/test_prompt_duel_game.py
git commit -m "feat(prompt-duel): prompt-length validation, tiebreak + appeal tests, lint clean"
```

---

### Task 3: Deploy wiring + UI

**Files:**
- Modify: `deploy/deploy-contract.mjs`, `.env.example`, `README.md`, `deploy/deployments/genlayer-studionet.json`
- Modify: `src/types/arena.ts`, `src/lib/gameModes.ts`, `src/lib/env.ts`, `src/context/ArenaContext.tsx`, `src/pages/Lobby.tsx`, `src/pages/RoomLobby.tsx`

- [ ] **Step 1:** Mirror exactly how `bluff` was added in the prior commits. In `deploy-contract.mjs` add a `prompt_duel` entry to `contractPaths` (`contracts/prompt_duel_game.py`) and the matching deploy + `set_mode_contract(coreAddress, "prompt_duel", addr)` + ledger `set_credit_ledger`/`approve_caller` calls. Add `VITE_VERDICTDOTFUN_PROMPT_DUEL_CONTRACT_ADDRESS` (+ `VERDICTDOTFUN_PROMPT_DUEL_CONTRACT_ADDRESS` deploy-side) to `.env.example`, README, and a `prompt_duel` slot to the deployments JSON.

- [ ] **Step 2:** UI: add `"prompt_duel"` to the `ArenaMode` union (`src/types/arena.ts`), to `ARENA_MODES` + a `GAME_MODE_META` entry in `src/lib/gameModes.ts` (title "Prompt Duel", summary "Write the prompt that best recreates a hidden target — shortest wins ties.", textarea submission, min length 3), to `contractAddresses` in `src/lib/env.ts` (read `VITE_VERDICTDOTFUN_PROMPT_DUEL_CONTRACT_ADDRESS`), to `buildInitialGameContracts` in `ArenaContext.tsx`, a tile in `Lobby.tsx` MODES, and extend the `RoomLobby.tsx` `canStart`/`canResolve`/prompt-hint gates that currently read `mode === "argue" || mode === "bluff"` to also include `"prompt_duel"` (it has the same start/resolve lifecycle). The `verdictArena.ts` `parseRoom` `claim` fallback already covers `target`? NO — `target` is a different field name; add a fallback so `parseRoom` also reads `record.target` for the displayed prompt (next to the existing `record.claim` fallback).

- [ ] **Step 3:** Build: `pnpm build` and `pnpm typecheck` — Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add deploy/ .env.example README.md src/
git commit -m "build/feat(prompt-duel): deploy wiring + lobby tile + mode config"
```

---

## Self-review notes
- Spec coverage: Prompt Duel section (target output, players write prompts, judge scores reproduction similarity, brevity breaks ties, untrusted prompts judged on output only) -> Task 1 (target gen + verdict + tiebreak), Task 2 (prompt validation + tiebreak test). Safety: the verdict prompt judges reproduction, never executes player intent against state.
- Divergence from bluff is exactly four methods (`_generate_target` family, `submit_entry` length rule, `_build_verdict_prompt`, the `_finalize_room` tiebreak) plus identifier renames; everything else (escrow, two-phase, appeal, forfeit, views) is verbatim and already proven by the bluff suite.
- `target` field name needs a `parseRoom` fallback in the UI, mirroring the `claim` fallback added for bluff.
