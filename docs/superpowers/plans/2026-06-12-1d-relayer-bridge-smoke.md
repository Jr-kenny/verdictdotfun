# Plan 1D — Relayer Bridge + End-to-End Smoke Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire the EVM `CreditVault` (1A) to the GenLayer `CreditLedger` (1B) via the relayer: vault deposits mint credits, ledger redeem-requests release vault funds, and expired provisional rooms get finalized — then prove the whole loop (buy → wager → resolve → finalize → redeem) end-to-end on Base Sepolia + a GenLayer testnet.

**Architecture:** A pure, unit-tested bridge library (`deploy/lib/bridge.mjs`) handles credit math and idempotency keys. The existing `deploy/relayer.mjs` is extended with three loops: (1) watch `CreditPurchased` → `ledger.credit`, (2) drain ledger redeem requests → `vault.redeem` → `ledger.mark_redeem_settled`, (3) poke `finalize_room` for provisional rooms past the challenge window. An optional hardening task lets GenLayer verify the deposit on-chain via `eth_call` before crediting, reducing trust in the relayer ahead of the LayerZero work in sub-project #3.

**Tech Stack:** Node ESM, `ethers` (EVM), `genlayer-js` (GenLayer), Vitest (pure-function tests), Base Sepolia + GenLayer testnet for the smoke.

**This is a rebuild.** Treat the existing relayer's NFT-mirror logic as reference only; the credit bridge is additive and independently toggled by env.

---

## Interface contract (from 1A + 1B)

- EVM event: `CreditPurchased(address indexed user, address indexed token, bytes32 indexed profile, uint256 amount, uint256 nonce)`
- EVM call: `redeem(address user, address token, uint256 amount, uint256 redeemId)` (onlyBridge)
- Ledger writes: `credit(profile, attoAmount, depositRef)`, `mark_redeem_settled(redeemId)`
- Ledger reads: `get_redeem_count() -> u256`, `get_redeem(redeemId) -> PendingRedeem{redeem_id, profile, payout_wallet, token, atto_amount, settled}`
- Mode write: `finalize_room(roomId)` (permissionless, time-gated on-chain)

---

## File Structure

- Create: `deploy/lib/bridge.mjs` — pure credit math + idempotency helpers.
- Create: `deploy/lib/bridge.test.mjs` — Vitest unit tests.
- Modify: `deploy/relayer.mjs` — three new loops, env-gated.
- Create: `deploy/smoke-credit-loop.mjs` — end-to-end integration smoke.
- Modify: `package.json` — `smoke:credits` script.
- Modify: `.env.example` — bridge env keys.
- Modify: `vitest.config.ts` — ensure `deploy/**/*.test.mjs` is included.

---

## Task 1: Pure bridge library (TDD)

**Files:**
- Create: `deploy/lib/bridge.mjs`
- Create: `deploy/lib/bridge.test.mjs`
- Modify: `vitest.config.ts`

- [ ] **Step 1: Ensure vitest picks up deploy tests**

In `vitest.config.ts`, confirm/extend the `test.include` to include deploy libs, e.g.:
```ts
    include: ["src/**/*.{test,spec}.{ts,tsx}", "deploy/**/*.test.mjs"],
```

- [ ] **Step 2: Write the failing tests**

`deploy/lib/bridge.test.mjs`:
```js
import { describe, it, expect } from "vitest";
import { depositRef, attoCreditsForDeposit, tokenAmountForAtto } from "./bridge.mjs";

const CREDIT = 10n ** 18n;

describe("depositRef", () => {
  it("composes a stable idempotency key from tx hash and nonce", () => {
    expect(depositRef("0xABCDEF", 7n)).toBe("0xabcdef:7");
  });
});

describe("attoCreditsForDeposit", () => {
  it("converts 1.0 USDC (6 decimals, 1:1) to 1 credit (atto)", () => {
    // 1.0 USDC raw = 1_000_000
    expect(attoCreditsForDeposit({ rawAmount: 1_000_000n, decimals: 6, creditsPerToken: 1 }))
      .toBe(CREDIT);
  });

  it("converts 0.5 ETH (18 decimals) at 2000 credits/ETH to 1000 credits", () => {
    expect(
      attoCreditsForDeposit({ rawAmount: 5n * 10n ** 17n, decimals: 18, creditsPerToken: 2000 })
    ).toBe(1000n * CREDIT);
  });
});

describe("tokenAmountForAtto", () => {
  it("is the inverse of the deposit conversion for USDC", () => {
    const atto = attoCreditsForDeposit({ rawAmount: 2_500_000n, decimals: 6, creditsPerToken: 1 });
    expect(tokenAmountForAtto({ attoAmount: atto, decimals: 6, creditsPerToken: 1 }))
      .toBe(2_500_000n);
  });

  it("is the inverse for ETH at a non-1 rate", () => {
    const atto = attoCreditsForDeposit({ rawAmount: 10n ** 18n, decimals: 18, creditsPerToken: 2000 });
    expect(tokenAmountForAtto({ attoAmount: atto, decimals: 18, creditsPerToken: 2000 }))
      .toBe(10n ** 18n);
  });
});
```

- [ ] **Step 3: Run to verify it fails**

Run: `pnpm vitest run deploy/lib/bridge.test.mjs`
Expected: FAIL — `./bridge.mjs` not found.

- [ ] **Step 4: Implement the pure library**

`deploy/lib/bridge.mjs`:
```js
// Pure helpers for the credit bridge. No network access — unit tested.

const ATTO = 10n ** 18n;

/** Stable idempotency key for a deposit event. */
export function depositRef(txHash, nonce) {
  return `${String(txHash).toLowerCase()}:${BigInt(nonce).toString()}`;
}

/**
 * Convert a raw on-chain token amount into atto-credits.
 * atto = rawAmount * 10^(18 - decimals) * creditsPerToken
 * creditsPerToken is an integer count of credits per ONE whole token.
 */
export function attoCreditsForDeposit({ rawAmount, decimals, creditsPerToken }) {
  const raw = BigInt(rawAmount);
  const scale = 18 - Number(decimals);
  const scaled = scale >= 0 ? raw * 10n ** BigInt(scale) : raw / 10n ** BigInt(-scale);
  return scaled * BigInt(creditsPerToken);
}

/** Inverse of attoCreditsForDeposit: atto-credits → raw token amount. */
export function tokenAmountForAtto({ attoAmount, decimals, creditsPerToken }) {
  const atto = BigInt(attoAmount) / BigInt(creditsPerToken);
  const scale = 18 - Number(decimals);
  return scale >= 0 ? atto / 10n ** BigInt(scale) : atto * 10n ** BigInt(-scale);
}

export const ATTO_PER_CREDIT = ATTO;
```

- [ ] **Step 5: Run to verify it passes**

Run: `pnpm vitest run deploy/lib/bridge.test.mjs`
Expected: PASS (all conversions, both directions).

- [ ] **Step 6: Commit**

```bash
git add deploy/lib/bridge.mjs deploy/lib/bridge.test.mjs vitest.config.ts
git commit -m "feat(bridge): pure credit-conversion + idempotency helpers (tested)"
```

---

## Task 2: Relayer loop — deposits → credits

**Files:**
- Modify: `deploy/relayer.mjs`
- Modify: `.env.example`

- [ ] **Step 1: Add env keys**

Append to `.env.example`:
```
# Credit bridge (1D)
CREDIT_BRIDGE_ENABLED=0
CREDIT_VAULT_CONTRACT_ADDRESS=
CREDIT_LEDGER_CONTRACT_ADDRESS=
CREDIT_TOKENS=ETH:0x0000000000000000000000000000000000000000:18:2000,USDC:0x036CbD53842c5426634e7929541eC2318f3dCF7e:6:1
CREDIT_BRIDGE_FROM_BLOCK=0
```
`CREDIT_TOKENS` is a CSV of `SYMBOL:address:decimals:creditsPerToken`.

- [ ] **Step 2: Add the deposit→credit loop**

In `deploy/relayer.mjs`, import the helpers near the top:
```js
import { depositRef, attoCreditsForDeposit } from "./lib/bridge.mjs";
```
Add a parser + a processing function (place beside the existing helpers; reuse the
existing `genlayer-js` client and the existing ethers `JsonRpcProvider` the relayer
already constructs). Use the SAME genlayer-js write/read call style already used in this
file for the core contract — do not invent a new client:
```js
const creditBridgeEnabled = process.env.CREDIT_BRIDGE_ENABLED === "1";
const creditVaultAddress = process.env.CREDIT_VAULT_CONTRACT_ADDRESS || "";
const creditLedgerAddress = process.env.CREDIT_LEDGER_CONTRACT_ADDRESS || "";

function parseCreditTokens(csv) {
  const map = new Map();
  for (const entry of String(csv || "").split(",").map((s) => s.trim()).filter(Boolean)) {
    const [symbol, address, decimals, creditsPerToken] = entry.split(":");
    map.set(address.toLowerCase(), {
      symbol,
      address,
      decimals: Number(decimals),
      creditsPerToken: Number(creditsPerToken),
    });
  }
  return map;
}
const creditTokens = parseCreditTokens(process.env.CREDIT_TOKENS);

const CREDIT_VAULT_ABI = [
  "event CreditPurchased(address indexed user, address indexed token, bytes32 indexed profile, uint256 amount, uint256 nonce)",
];

async function syncDeposits({ provider, glClient, state }) {
  if (!creditBridgeEnabled || !creditVaultAddress || !creditLedgerAddress) return;
  const vault = new Contract(creditVaultAddress, CREDIT_VAULT_ABI, provider);
  const fromBlock = state.creditFromBlock ?? Number(process.env.CREDIT_BRIDGE_FROM_BLOCK ?? "0");
  const toBlock = await provider.getBlockNumber();
  if (toBlock < fromBlock) return;

  const events = await vault.queryFilter(vault.filters.CreditPurchased(), fromBlock, toBlock);
  for (const ev of events) {
    const { user, token, profile, amount, nonce } = ev.args;
    const ref = depositRef(ev.transactionHash, nonce);
    if (state.processedDeposits?.[ref]) continue;

    const meta = creditTokens.get(String(token).toLowerCase());
    if (!meta) {
      console.warn(`[credit] skipping unknown token ${token} (deposit ${ref})`);
      continue;
    }
    const atto = attoCreditsForDeposit({
      rawAmount: amount,
      decimals: meta.decimals,
      creditsPerToken: meta.creditsPerToken,
    });
    const profileAddr = "0x" + String(profile).slice(-40); // bytes32 → address

    // credit() is idempotent on-chain too; ref dedup here avoids redundant txs.
    await glClient.writeContract({
      address: creditLedgerAddress,
      functionName: "credit",
      args: [profileAddr, atto.toString(), ref],
    });
    state.processedDeposits = state.processedDeposits || {};
    state.processedDeposits[ref] = true;
    console.log(`[credit] +${atto} atto → ${profileAddr} (${ref})`);
  }
  state.creditFromBlock = toBlock + 1;
}
```
Call `await syncDeposits({ provider, glClient, state })` inside the relayer's existing
poll loop (next to the NFT sync call), and ensure `state` is persisted to the existing
state file the relayer already writes.

> Match `glClient.writeContract({...})` to the actual genlayer-js call the relayer already
> uses for the core contract (the existing code constructs the client and signs with
> `GENLAYER_DEPLOYER_PRIVATE_KEY`). The bridge account here MUST be the address set as
> `CREDIT_VAULT_BRIDGE` in 1A and as the ledger `bridge` in 1B.

- [ ] **Step 3: Smoke-run the relayer once against config (no funds needed if no events)**

Run:
```bash
RELAYER_RUN_ONCE=1 CREDIT_BRIDGE_ENABLED=1 pnpm relayer
```
Expected: starts, queries `CreditPurchased`, processes 0 events cleanly, exits.

- [ ] **Step 4: Commit**

```bash
git add deploy/relayer.mjs .env.example
git commit -m "feat(bridge): relayer credits GenLayer on vault deposits"
```

---

## Task 3: Relayer loop — redeem requests → vault release

**Files:**
- Modify: `deploy/relayer.mjs`

- [ ] **Step 1: Add the redeem drain loop**

In `deploy/relayer.mjs`, add (importing `tokenAmountForAtto` from the bridge lib):
```js
import { tokenAmountForAtto } from "./lib/bridge.mjs";

const CREDIT_VAULT_REDEEM_ABI = [
  "function redeem(address user, address token, uint256 amount, uint256 redeemId) external",
];

function tokenMetaBySymbol(symbol) {
  for (const meta of creditTokens.values()) {
    if (meta.symbol.toUpperCase() === String(symbol).toUpperCase()) return meta;
  }
  return null;
}

async function syncRedeems({ wallet, glClient }) {
  if (!creditBridgeEnabled || !creditVaultAddress || !creditLedgerAddress) return;
  const count = BigInt(await glClient.readContract({
    address: creditLedgerAddress, functionName: "get_redeem_count", args: [],
  }));
  const vault = new Contract(creditVaultAddress, CREDIT_VAULT_REDEEM_ABI, wallet);

  for (let id = 0n; id < count; id++) {
    const r = await glClient.readContract({
      address: creditLedgerAddress, functionName: "get_redeem", args: [id.toString()],
    });
    if (r.settled) continue;

    const meta = tokenMetaBySymbol(r.token);
    if (!meta) { console.warn(`[redeem] unknown token ${r.token} (id ${id})`); continue; }

    const amount = tokenAmountForAtto({
      attoAmount: BigInt(r.atto_amount), decimals: meta.decimals, creditsPerToken: meta.creditsPerToken,
    });
    const tx = await vault.redeem(r.payout_wallet, meta.address, amount.toString(), id.toString());
    await tx.wait();

    await glClient.writeContract({
      address: creditLedgerAddress, functionName: "mark_redeem_settled", args: [id.toString()],
    });
    console.log(`[redeem] released ${amount} ${meta.symbol} → ${r.payout_wallet} (id ${id})`);
  }
}
```
The `wallet` is the existing ethers `Wallet` the relayer constructs from
`VERDICT_NFT_RELAYER_PRIVATE_KEY`/`BASE_SEPOLIA_PRIVATE_KEY`; it MUST be the vault `bridge`.
Call `await syncRedeems({ wallet, glClient })` in the poll loop after `syncDeposits`.

- [ ] **Step 2: Smoke-run once (0 redeems)**

Run: `RELAYER_RUN_ONCE=1 CREDIT_BRIDGE_ENABLED=1 pnpm relayer`
Expected: reads `get_redeem_count` = 0, processes nothing, exits clean.

- [ ] **Step 3: Commit**

```bash
git add deploy/relayer.mjs
git commit -m "feat(bridge): relayer releases vault funds on ledger redeem requests"
```

---

## Task 4: Relayer loop — finalize expired provisional rooms

**Files:**
- Modify: `deploy/relayer.mjs`

- [ ] **Step 1: Add the finalize sweep**

`finalize_room` is permissionless and time-gated on-chain, so the relayer only needs to
poke provisional rooms whose window has elapsed and that have no pending appeal. Reuse the
relayer's existing room enumeration over the core registry; for each provisional room call
the mode contract's `finalize_room`:
```js
async function syncFinalize({ glClient, roomIds, modeContractFor }) {
  if (!creditBridgeEnabled) return;
  for (const roomId of roomIds) {
    const mode = modeContractFor(roomId); // existing relayer helper that maps room → mode contract
    if (!mode) continue;
    try {
      const room = await glClient.readContract({ address: mode, functionName: "get_room", args: [roomId] });
      if (room.status !== "provisional") continue;
      if (room.appeal_state === "filed") continue; // appeal must be judged first
      await glClient.writeContract({ address: mode, functionName: "finalize_room", args: [roomId] });
      console.log(`[finalize] poked ${roomId}`);
    } catch (e) {
      // On-chain window guard will revert if still open — that's expected; log at debug.
      if (!String(e?.message || "").includes("window")) console.warn(`[finalize] ${roomId}: ${e?.message}`);
    }
  }
}
```
Call it in the poll loop after `syncRedeems`, passing the relayer's existing room-id list
and mode-resolution helper.

- [ ] **Step 2: Smoke-run once**

Run: `RELAYER_RUN_ONCE=1 CREDIT_BRIDGE_ENABLED=1 pnpm relayer`
Expected: enumerates rooms, finalizes none (or only those past window), exits clean.

- [ ] **Step 3: Commit**

```bash
git add deploy/relayer.mjs
git commit -m "feat(bridge): relayer finalizes expired provisional rooms"
```

---

## Task 5 (hardening, optional): GenLayer-verified deposits via eth_call

**Files:**
- Modify: `contracts/credit_ledger.py`
- Modify: `tests/direct/test_credit_ledger.py`

Reduces trust in the relayer: instead of (or in addition to) the bridge asserting a deposit,
the ledger verifies the deposit nonce against the vault on Base via `eth_call` before crediting.

- [ ] **Step 1: Write an integration-tagged test (skipped in direct mode)**

Add to `tests/direct/test_credit_ledger.py`:
```python
import pytest

@pytest.mark.skip(reason="requires a live Base Sepolia RPC; run as integration in Plan 1D smoke")
def test_verify_deposit_against_vault():
    pass
```

- [ ] **Step 2: Add a verified-credit method using the strict_eq RPC pattern**

Add to `contracts/credit_ledger.py` (uses the cross-chain RPC verification pattern from the
GenLayer contract-writing guidance):
```python
    rpc_url: str
    vault_address: str

    @gl.public.write
    def set_vault_source(self, rpc_url: str, vault_address: str) -> None:
        self._require_owner()
        self.rpc_url = rpc_url.strip()
        self.vault_address = vault_address.strip().lower()

    @gl.public.write
    def credit_verified(self, profile: Address, atto_amount: u256, deposit_ref: str, nonce: u256) -> None:
        self._require_bridge()
        if not self.rpc_url or not self.vault_address:
            raise gl.vm.UserError("[EXPECTED] Vault source not configured.")
        import json
        # processedRedeem is on the vault; here we read the public mapping
        # `processedDeposits`? Vault does not store deposits, so verify via the
        # CreditPurchased event is not eth_call-able. Instead verify depositNonce >= nonce.
        selector = "0x" + "depositNonce()"  # replace with the real 4-byte selector at impl time
        payload = {
            "jsonrpc": "2.0", "id": 1, "method": "eth_call",
            "params": [{"to": self.vault_address, "data": selector}, "latest"],
        }

        def fetch():
            res = gl.nondet.web.post(self.rpc_url, body=json.dumps(payload).encode(),
                                     headers={"Content-Type": "application/json"})
            if res.status != 200:
                raise gl.vm.UserError(f"[TRANSIENT] RPC status {res.status}")
            data = json.loads(res.body.decode("utf-8"))
            if "error" in data:
                raise gl.vm.UserError(f"[EXTERNAL] RPC error: {data['error']}")
            return int(data.get("result", "0x0"), 16)

        current_nonce = gl.eq_principle.strict_eq(fetch)
        if current_nonce < int(nonce):
            raise gl.vm.UserError("[EXPECTED] Deposit nonce not yet observed on the vault.")
        # delegate to the idempotent credit path
        self.credit(profile, atto_amount, deposit_ref)
```
> NOTE for the implementer: compute the real `depositNonce()` 4-byte selector
> (`keccak256("depositNonce()")[:4]`) and inline it; the string above is a placeholder
> *marker for a constant to compute*, not runtime logic. Lint and an integration call must
> confirm the selector and the ABI-encoded return decode before enabling `credit_verified`.
> This task is OPTIONAL for #1; the trusted-relayer `credit` path is the default.

- [ ] **Step 3: Lint**

Run: `genvm-lint check contracts/credit_ledger.py`
Expected: no errors. Keep `credit_verified` disabled in the relayer (still call `credit`)
until the selector is confirmed in the smoke run.

- [ ] **Step 4: Commit**

```bash
git add contracts/credit_ledger.py tests/direct/test_credit_ledger.py
git commit -m "feat(bridge): optional GenLayer eth_call deposit verification (gated)"
```

---

## Task 6: End-to-end smoke on testnet

**Files:**
- Create: `deploy/smoke-credit-loop.mjs`
- Modify: `package.json`

- [ ] **Step 1: Write the smoke orchestrator**

`deploy/smoke-credit-loop.mjs` drives the full loop and asserts each transition. It assumes
`CreditVault` (1A) and `CreditLedger` + core + modes (1B/1C) are already deployed and that
the relayer is running with `CREDIT_BRIDGE_ENABLED=1`.
```js
import "dotenv/config";
import { Contract, JsonRpcProvider, Wallet, parseUnits } from "ethers";
// reuse the project's genlayer-js client construction exactly as relayer.mjs does
import { createClient, createAccount } from "genlayer-js";

const assert = (cond, msg) => { if (!cond) { throw new Error("SMOKE FAIL: " + msg); } };

async function main() {
  // 1) Buy credits: deposit USDC to the vault, attributed to PROFILE
  // 2) Poll ledger.get_balance(PROFILE) until credits appear (relayer crediting)
  // 3) Create + join a staked room on a mode; assert ledger escrow locked both stakes
  // 4) Play to a verdict → assert room.status == "provisional"
  // 5) Wait past CHALLENGE_WINDOW (or use a short test window build) → relayer finalizes
  //    → assert room.status == "resolved" and winner balance increased by the pot
  // 6) request_redeem via the bridge → relayer calls vault.redeem → assert wallet balance up
  // Each step logs and asserts; exit non-zero on any failed assertion.
  console.log("credit-loop smoke: see inline steps; fill addresses from env.");
  assert(process.env.CREDIT_VAULT_CONTRACT_ADDRESS, "set CREDIT_VAULT_CONTRACT_ADDRESS");
  assert(process.env.CREDIT_LEDGER_CONTRACT_ADDRESS, "set CREDIT_LEDGER_CONTRACT_ADDRESS");
  // ... concrete ethers + genlayer-js calls mirroring relayer.mjs ...
}

main().catch((e) => { console.error(e); process.exit(1); });
```

> Implement each numbered step using the exact ethers calls from 1A's tests and the exact
> genlayer-js calls the relayer uses. For a fast smoke, deploy the mode with a build-time
> `CHALLENGE_WINDOW_SECONDS = 60` override (env or a smoke deploy) so the window elapses
> quickly; production keeps 3600.

- [ ] **Step 2: Add the script**

In `package.json` `scripts`:
```json
    "smoke:credits": "node ./deploy/smoke-credit-loop.mjs",
```

- [ ] **Step 3: Run the smoke (requires funded testnet keys + running relayer)**

Run (in one terminal): `CREDIT_BRIDGE_ENABLED=1 pnpm relayer`
Run (in another): `pnpm smoke:credits`
Expected: prints each transition (`credited`, `escrowed`, `provisional`, `resolved`, `redeemed`)
and exits 0. Any failed assertion exits non-zero with the failing step.

- [ ] **Step 4: Commit**

```bash
git add deploy/smoke-credit-loop.mjs package.json
git commit -m "test(bridge): end-to-end credit-loop smoke (buy→wager→finalize→redeem)"
```

---

## Self-Review (1D)

- **Spec coverage:** relayer mirrors deposits → credits ✓; redeem requests → vault release ✓; expired provisional rooms finalized ✓; end-to-end smoke for buy→wager→resolve→finalize→redeem ✓; optional GenLayer-native deposit verification via `eth_call` ✓ (gated, optional).
- **Idempotency:** `depositRef` dedup in relayer state + idempotent `credit` on-chain; `mark_redeem_settled` + vault `redeemId` dedup; `finalize_room` idempotent via on-chain status guard.
- **Type consistency:** event/method names match 1A (`CreditPurchased`, `redeem`) and 1B (`credit`, `get_redeem_count`, `get_redeem`, `mark_redeem_settled`) and 1C (`finalize_room`, room `status`/`appeal_state`).
- **Trust note:** bridge account = vault `bridge` = ledger `bridge` (one key). Trust is removed in sub-project #3 (LayerZero); Task 5 is the optional first step toward that.
- **Placeholder honesty:** Task 5's selector string and Task 6's numbered-step body are explicitly flagged as constants/calls to fill from 1A/1B during implementation — they are integration glue that must be run against live contracts, not unit-testable pure logic. The unit-testable bridge math (Task 1) is fully concrete and TDD'd.
