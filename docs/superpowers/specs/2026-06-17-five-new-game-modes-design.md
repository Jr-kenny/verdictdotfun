# Five New Game Modes — Design Spec

Date: 2026-06-17
Status: Approved (brainstorm), pending implementation plan
Branch: feat/five-new-game-modes

## Goal

Add five new GenLayer-judged wager games to verdictdotfun, built and shipped in one
wave. Each game is its own GenLayer mode contract on the existing framework (mode
registry + room + escrow + two-phase appeal + LLM judge). The five are: Bluff,
Prompt Duel, Sketch & Guess, Persuade-the-Agent, and Oracle Forecast.

The platform differentiator is that the GenLayer contract is a subjective LLM judge
reaching validator consensus. Every game added here is one a normal chain could not
adjudicate: open-ended, subjective, multimodal, or real-world-resolved. No arcade or
pure-luck games.

## Hard constraints

- FIVE SEPARATE CONTRACTS, one file each, no shared "god file":
  `contracts/bluff_game.py`, `contracts/prompt_duel_game.py`, `contracts/sketch_game.py`,
  `contracts/persuade_game.py`, `contracts/oracle_game.py`. Each deploys at its own
  address and registers independently on core via `register_mode`. This mirrors how
  argue and riddle already live as independent contracts.
- Each contract has its own direct-test suite under `tests/direct/`, TDD RED->GREEN,
  targeting the same density as argue/riddle (~15-30 tests each).
- New code uses `gl.vm.UserError`, not bare `Exception` (rebuild stance). `genvm-lint`
  clean before merge.
- No new EVM contracts. All five are pure GenLayer modes on the existing credit rail.
- One spec, one build wave (user decision). The two hard modes use full mechanics, not
  the simplified single-shot shape (user decision).

## Shared spine (reused unchanged from argue/riddle)

- Room lifecycle: `create_room` (AI generates the round content, seeded by `category`)
  -> `join_room` (opens escrow if staked) -> submissions -> resolve.
- Value rail: `CreditLedgerIface` escrow. `open_escrow` on join,
  `set_provisional` / `finalize_winner` / `finalize_void` (and `finalize_tie` where a
  draw is possible) on settle. Winner takes pot. XP + bonus XP via
  `core.apply_match_result(profile, match_id, did_win, mode, bonus_xp)`.
- Two-phase settlement + appeal: provisional winner -> challenge window -> `file_appeal`
  (with the IPFS-CID vision-evidence path) -> `judge_appeal` -> `finalize_room`. Reused
  verbatim where it applies; Oracle repurposes the challenge window as its dispute window.
- Judging pattern: `gl.vm.run_nondet_unsafe(leader_fn, validator_fn)`.

### Consensus rule (load-bearing, applies to all five)

The AI's prose (reply, critique, character dialogue) is LEADER-ONLY flavor. The
settlement-determining value is ALWAYS a number or a discrete winner that the
`validator_fn` checks for agreement. This is what keeps argue/riddle consensus-safe and
is what makes even the multi-turn and oracle modes settle reliably. No game settles on
free-text equality.

### What is genuinely new framework code

- Multi-turn room state (per-player transcript + concession meter) for Persuade.
- Web-resolution plus its dispute path for Oracle.

Everything else is rubric + submission-shape configuration on the existing lifecycle.

## The five games

### 1. Bluff — "Convince the Judge" (lowest risk)

- Mechanic: AI generates one hard-to-defend (often false or absurd) claim, seeded by
  `category`. BOTH players argue the claim is true.
- AI judges: persuasiveness, internal consistency, rhetorical skill, EXPLICITLY ignoring
  factual truth. Returns `{winner, score, reasoning}`; validators agree on winner.
- Win: more convincing case. Two-phase settlement + appeal.
- Distinct from argue: argue is opposing sides of a debatable topic; Bluff is both
  players defending the same indefensible position. Different rubric, same lifecycle.

### 2. Prompt Duel — "Prompt Golf"

- Mechanic: AI picks a target output (poem / paragraph / JSON) seeded by `category`.
  Both players write a prompt.
- AI judges: the contract RUNS each player's prompt via `exec_prompt`, then scores which
  output is closer to the target (similarity score is the consensus number). Prompt
  brevity breaks ties (the "golf").
- Win: closest output, shorter prompt on tie. Two-phase + appeal.
- Safety: player prompts are untrusted text. We judge OUTPUT SIMILARITY only, never
  execute their intent against contract state. The generated outputs are leader-only;
  only the similarity score reaches consensus.

### 3. Sketch & Guess — vision (best reuse story)

- Mechanic: two rounds. Each player gets a secret word, draws and uploads an image
  (IPFS pin -> CID, the existing pipeline), then guesses the OTHER player's drawing.
- AI judges: the vision model (`exec_prompt(images=...)`) scores each guess against the
  secret word and the image. Consensus value = correct/incorrect per guess.
- Win: more correct guesses; AI scores guess quality on tie (`finalize_tie` fallback if
  still even).
- Reuses: the magic-byte image validation + `gl.nondet.web.get` + IPFS pin code that
  already exists for appeals (argue_game.py `_is_supported_image`, `_fetch_evidence_image`).
  Turns the vision pipeline from an appeals afterthought into a core loop.

### 4. Persuade-the-Agent — multi-turn AI opponent (full mechanics, second-highest risk)

- Mechanic: AI generates a character with a hidden resistance and a secret
  concede-condition, seeded by `category`. Both players run their own private N-turn
  conversation against the SAME character (same seed = fair). Each turn the AI replies
  in-character and updates a concession meter (0-100).
- AI judges: per turn returns `{reply, new_meter, reasoning}`. Validators agree on the
  METER (numeric, consensus-safe); the reply is leader flavor.
- Win: higher final meter; fewer turns breaks ties. Appeal on final judging.
- New code: per-player transcript + meter stored in room; turn cap to bound cost. More
  `exec_prompt` calls per match than any other mode.

### 5. Oracle Forecast — live web resolution (full mechanics, highest risk)

- Mechanic: AI generates a YES/NO future-event question + a resolution source + a
  resolution deadline, seeded by `category`. Players take opposite sides.
- AI judges: after the deadline, `resolve_room` fetches the source via
  `gl.nondet.web.get`, the LLM reads the outcome, validators agree. Side that matches
  wins.
- Win: correct side. The two-phase challenge window becomes the DISPUTE window: the loser
  can submit a counter-source (text or vision evidence) -> `judge_appeal` re-resolves
  (upheld / overturned).
- Risk + mitigation: outbound web-fetch consensus on studionet is the one unproven
  dependency in the codebase (the appeal-vision live test was never run). Restrict
  resolution sources to a stable allowlist and sniff content deterministically, same
  discipline as the CID SSRF guard. FALLBACK: if studionet blocks outbound fetch, Oracle
  ships with an operator-resolve path behind a flag rather than blocking the other four.

## UI surfaces

App stack: React + Vite + wagmi/Reown + react-query + framer-motion + shadcn/ui +
react-router. `src/lib/verdictArena.ts` is the contract client; `RoomLobby` is the room.

- Lobby: each mode gets a tile (icon, name, one-line rule, stake) in the create-room mode
  picker. The list is DISCOVERED DYNAMICALLY from `core.get_mode_names()`. Each mode still
  needs its own `VITE_` address env var for direct `get_room` reads, plus a small frontend
  config object (label, submission widget) to render.
- Shared room shell for the three submit->judge games (Bluff, Prompt Duel, Sketch): one
  `RoomLobby` variant driven by per-mode config: a claim/prompt banner + a submission input
  (textarea for Bluff/Prompt; image-upload->IPFS for Sketch) + the existing
  provisional/appeal/finalize banners from PR #13.
- Two bespoke surfaces:
  - Persuade: a turn-based chat panel (player message, AI character reply) with a live
    concession-meter bar; ends at the turn cap.
  - Oracle: a question card with YES/NO side-pick, a countdown to the resolution deadline,
    a Resolve button after it, and the dispute form.
- Client lib: extend `verdictArena.ts` with `submitTurn` (Persuade), `pickSide`/`resolve`
  (Oracle), `uploadDrawing` (Sketch, reusing the pin route). `ArenaRoom` type + mapper gain
  per-mode fields.

## Testing

- TDD direct tests per mode (`.venv/bin/pytest tests/direct -v`), each contract isolated
  (direct mode cannot deploy two contracts in one test, so guard `core`/`ledger` calls when
  the address is zero, per the learned constraint). Time source via
  `gl.message_raw["datetime"]`; challenge/turn/deadline windows are CONSTRUCTOR PARAMS so
  tests can deploy window=0 to exercise the "allowed" branch (warp does not propagate).
- `genvm-lint` clean; new code uses `gl.vm.UserError`.
- Integration/smoke (marked `slow`) for cross-contract wiring and the two web-fetch modes
  (Oracle resolution, Sketch vision) on studionet.

## Shipping (per mode)

- `deploy-contract.mjs` extended with the new `DEPLOY_TARGET`s -> deploy each mode to
  studionet -> `core.register_mode` + `ledger.approve_caller` (auto-wired by the deploy
  script) -> mode `set_credit_ledger` + `set_core_contract`.
- CORE ADDRESS DOES NOT CHANGE (we call `register_mode`, not redeploy core), so the
  credit-bridge Supabase function's baked `CORE_ADDR` does NOT need a redeploy. Much lighter
  migration than a core swap.
- Migration per mode: add the new `VITE_` address to Vercel prod + `.env` + README +
  `deploy/deployments/genlayer-studionet.json`.
- Build order within the wave (build risky-last so they cannot block the easy wins):
  Bluff -> Prompt Duel -> Sketch -> Persuade -> Oracle.
- Git flow: branch -> push -> `gh pr create` -> `gh pr merge --merge`, as enforced. Direct
  pushes to main are blocked.
- The live deploy line (studionet deploy + Vercel prod env) needs the user's funded keys.
  Build, test, register, and wire up to that boundary; run the live steps if keys are
  present, otherwise hand over the exact commands.

## Risk register

1. Oracle web-fetch consensus on studionet (unproven). Mitigation: source allowlist +
   deterministic content sniffing. Fallback: operator-resolve behind a flag.
2. Persuade multi-turn (most `exec_prompt` calls per match, multi-turn state). Mitigation:
   turn cap; settle on the numeric meter, not transcripts.
3. Prompt Duel runs untrusted player prompts. Mitigation: judge output similarity only,
   never against contract state.
4. Five new modes is a large `exec_prompt` surface overall. Per-rubric consensus tuning and
   the canonical error handler (`_appeal_errors_agree` style) on every nondet block.

## Out of scope

- LayerZero hardening of the value rail (sub-project #3).
- Verdict Stone / NFT changes.
- Social re-skins of argue (roast, caption) that ship as `argue_style` values rather than
  new modes; noted as cheap follow-ons, not part of this wave.
