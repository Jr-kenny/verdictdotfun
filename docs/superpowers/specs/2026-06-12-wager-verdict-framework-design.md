# Wager + Verdict Framework — Design Spec

**Date:** 2026-06-12
**Sub-project:** #1 of the verdictdotfun maturation (engine-first)
**Status:** Approved for planning

---

## Context

verdictdotfun is a GenLayer-judged multiplayer game platform. It was built for a
GenLayer hackathon (game track) and is now being matured into a real product. The
long-term product is **a platform that holds many games where the GenLayer contract
acts as the judge/brain**, with real-value wagering.

The full vision decomposes into sequenced sub-projects, each its own spec → plan →
build cycle:

| # | Sub-project | Status |
|---|---|---|
| **1** | **Wager + Verdict framework** (this spec) | designing |
| 2 | New game modes on the framework | later |
| 3 | LayerZero cross-chain hardening of the value rail | later |
| 4 | UI maturation | later |

This spec covers **only sub-project #1**.

### Current architecture (what exists today)

- **Core contract** `contracts/verdictdotfun.py` (`VerdictDotFun`): owns player
  profiles, seasons, rank/XP, leaderboard, a **room registry**, an approved-games
  set, and operators.
- **Mode contracts** `contracts/argue_game.py`, `contracts/riddle_game.py`: run the
  match flow. On resolution they call back into core via
  `apply_match_result(profile, match_id, did_win, mode)` to update profile stats
  (see `argue_game.py:499`).
- **EVM side** `contracts/evm/VerdictProfileNft.sol` + hardhat + Base Sepolia deploy
  scripts; an off-chain `deploy/relayer.mjs`.

### Two structural problems this sub-project fixes

1. **The mode registry is hardcoded.** `debate_contract` / `riddle_contract`,
   `_mode_salt` (salts 1/2), and `_normalize_mode` bake in exactly two modes. A
   platform that holds many games needs a **generic, dynamic registry**.
2. **There is no value/escrow concept.** Resolution is purely win/loss → XP. All
   wagering, escrow, and settlement is net-new.

---

## Goal

Build the **engine that makes many wager-able, GenLayer-judged games cheap to add** —
not a single game. Concretely, sub-project #1 delivers:

- a generic mode registry,
- a credit-based value system backed by real ETH/USDC (testnet),
- wager escrow + a standard verdict-resolution/settlement interface every mode
  implements,
- a two-phase settlement with forfeit handling and a GenLayer-judged appeal window,
- core hardening folded in,
- test suites and an end-to-end smoke loop.

Non-goals (explicitly deferred): LayerZero, new game modes, polished UI, mainnet,
fiat on-ramp, non-zero rake economics, rematch-as-appeal-outcome.

---

## Value model: credits backed by a real-asset pool

Credits are an internal wagering unit backed 1:1-style by a real-asset pool:

```
buy credits with ETH/USDC  →  wager in credits  →  redeem credits back to ETH/USDC
```

Testnet (Base Sepolia) first, until the loop is proven. This separates the **value
rail** (real money, EVM) from the **game engine** (credits, GenLayer), so gameplay
never blocks on cross-chain plumbing.

---

## Architecture — three planes

| Plane | Where | Responsibility | New / Changed |
|---|---|---|---|
| **Value rail** | EVM, Base Sepolia | Custody of ETH/USDC; deposit ↔ redeem | New: `CreditVault.sol` |
| **Game engine** | GenLayer | Credit balances, wager escrow, mode registry, two-phase verdict settlement, appeal judging | Changed core + new credit module |
| **Bridge** | Off-chain relayer (testnet) | Mirror vault deposits → credits; mirror credit redeems → vault releases | Extend `deploy/relayer.mjs` |

### Bridge trust model for #1

Trusted relayer + GenLayer native chain reads. The relayer (owner-operated, as today)
mirrors events both ways; GenLayer can additionally verify vault state by reading the
chain directly. Trust assumption: the relayer/owner authority. This is removed in
sub-project #3 by replacing the relayer with LayerZero message passing. **No L0 in #1.**

---

## Components (each isolated, one job)

### 1. `CreditVault.sol` (EVM, new)

Custody only.

- `deposit(token, amount)` — locks ETH/USDC, emits `CreditPurchased(user, amount, nonce)`.
- `redeem(user, amount, authorization)` — releases funds when authorized by the bridge
  authority; cannot exceed the user's recorded entitlement.
- Hardening: `ReentrancyGuard`, `Pausable`, Solidity 0.8 checked math, per-deposit
  nonce (replay-safe), single rotatable bridge-authority key for redeem authorization.

### 2. GenLayer core — generic mode registry (changed)

Replace hardcoded `debate_contract` / `riddle_contract` / `_mode_salt` with:

- `modes: TreeMap[str, Address]` (mode-name → contract),
- dynamic salt derivation per mode name,
- `register_mode` / `deregister_mode` (owner-gated).

argue & riddle are re-registered as ordinary registry entries via a **back-compat
shim** so existing rooms and tests keep working.

### 3. GenLayer `CreditLedger` (new module)

- `balances: TreeMap[profile, u256]`.
- `credit(profile, amount, deposit_ref)` — bridge-authorized; **idempotent on
  `deposit_ref`** (a replayed deposit can't double-mint).
- `request_redeem(profile, amount)` — escrows the credits and emits a burn record the
  relayer settles on the EVM vault; cannot touch credits locked in an active wager.

### 4. Wager escrow + settlement interface

- `create_room` gains a `stake` argument. Joining a room escrows each player's credits
  into a **pot**.
- Every mode implements a standard verdict result: `winner | tie | void`.
- Settlement hangs off the existing `apply_match_result` seam — the mode already
  computes a winner; we attach pot release at the same moment.
- **Conservation invariant:** credits in == credits out for every settlement.

---

## Settlement — two-phase (provisional → final)

Resolution never pays immediately. A verdict **or** a forfeit sets a *provisional*
winner and opens a **1-hour challenge window**; the pot stays escrowed throughout.

```
            ┌────────────── room in progress ──────────────┐
            │                                                │
   normal verdict resolves                          a player quits/disconnects
            │                                                │
            └──────────────┬─────────────────────────────────┘
                           ▼
              PROVISIONAL WINNER set
              pot stays escrowed · 1h challenge window opens
                           │
        ┌──────────────────┼─────────────────────────────┐
        ▼                  ▼                               ▼
  window expires      loser files appeal            (no appeal)
  no appeal           within 1h, w/ reason                 │
        │                  ▼                               │
        │          GenLayer JUDGES appeal                  │
        │        (the brain — LLM consensus)               │
        │           ┌────────┴────────┐                    │
        │        UPHELD            OVERTURNED               │
        │     winner stands       void → refund both       │
        ▼           ▼                  ▼                    ▼
   ──────────────  FINALIZE  ──────────────────────────────
       pot released per final outcome · settlement idempotent
```

### Rules

- **Forfeit on quit.** `forfeit` / `quit_room` (or relayer-detected disconnect) makes
  the opponent the **provisional** winner — *not* an instant payout. The same 1h window
  applies, so a network-dropped player can still appeal.
- **Appeal.** Only the non-winning participant, only within the window, **one appeal
  per room**. Submits a free-text reason (+ optional evidence reference). Filing pauses
  auto-finalize and routes the case to GenLayer.
- **GenLayer judges the appeal** (the brain). Appeal verdict is:
  - **UPHELD** → provisional winner is paid, or
  - **OVERTURNED → void**, both stakes refunded.
  - (Rematch-as-outcome is deferred to a later cycle to keep #1 bounded.)
- **Finalize.** After the window with no appeal, or once an appeal is judged,
  `finalize(room_id)` releases the pot. **Permissionless after the deadline** (the
  relayer or anyone can poke it). **Idempotent per `match_id`** (reuse the existing
  `processed_results` dedup pattern) so a replayed verdict cannot double-pay.

### Outcome → pot table

| Final outcome | Pot handling |
|---|---|
| Decisive winner (verdict or forfeit, unappealed/UPHELD) | Winner takes full pot |
| Tie (argue/riddle already model ties) | Refund both stakes, no rake |
| Void / abandoned / appeal OVERTURNED | Refund all escrowed stakes |
| Optional house rake | Configurable `rake_bps`, **default 0 in #1**, skimmed to a treasury profile before payout |

---

## Hardening (folded into #1)

- **EVM vault:** reentrancy guard, pausable, checked math, per-deposit nonce, redeem
  gated to one rotatable bridge authority, withdrawal ≤ recorded entitlement.
- **GenLayer ledger:** escrow ≤ balance; settlement conserves credits; `credit()`
  idempotent on `deposit_ref`; redeem cannot drain credits locked in an active wager or
  in an unfinalized challenge window.
- **Authorization:** only registered + approved modes can trigger settlement; only the
  bridge authority can mint/redeem; the existing owner/operator split is preserved.
- **Mode registry migration:** argue & riddle re-registered through the new generic
  registry behind a back-compat shim; existing rooms/tests unaffected.

---

## Testing

- **GenLayer (`gltest` / pytest direct):** ledger accounting, escrow conservation,
  tie/void refunds, **two-phase settlement** (provisional → finalize), **forfeit**,
  **appeal filed / UPHELD / OVERTURNED**, finalize idempotency, registry add/remove.
- **EVM (hardhat):** deposit / redeem, reentrancy, pause, authority gating, nonce
  replay.
- **End-to-end smoke (extend `deploy/smoke-*.mjs`):** buy → wager → resolve →
  (optional appeal) → finalize → redeem on Base Sepolia.

---

## Scope boundary

**In #1:** `CreditVault.sol`; generic mode registry; `CreditLedger`; wager escrow +
two-phase settlement (forfeit + appeal window) on argue/riddle; trusted relayer sync;
the test suites above; minimal frontend wiring to *exercise* the loop (not polished UX).

**Out (own later cycles):** LayerZero (#3); new game modes (#2); full UI maturation
(#4); mainnet; fiat on-ramp; non-zero rake economics; rematch-as-appeal-outcome.

---

## Open implementation questions (resolve in the plan, not here)

1. **Trusted time source on GenLayer** for the 1-hour window — block timestamp vs.
   relayer-supplied time vs. block-height proxy. Affects mechanism only, not design.
2. **Credit ledger placement** — extend the core `VerdictDotFun` contract vs. a
   separate `CreditLedger` contract that core/modes call. Lean: separate module for
   isolation, pending a check on cross-contract call cost/patterns already in use.
3. **Disconnect detection** — relayer-reported vs. explicit `quit_room` only, for the
   forfeit trigger in #1.
