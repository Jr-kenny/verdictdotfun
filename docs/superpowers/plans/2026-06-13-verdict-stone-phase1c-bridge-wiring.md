# Verdict Stone — Phase 1c: bridge wiring (GenLayer ↔ ZKsync Era hub)

**Status:** **COMPLETE — full loop proven live (2026-06-16).** GenLayer side, EVM dispatch, the
standalone stone relay, and both smoke directions are all done and verified on testnet.

Phase 1a built the GenLayer eligibility contract with a self-polled **outbox**; Phase 1b built the EVM
hub registry (`VerdictStoneHub`). Reading the GenLayer bridge boilerplate's own example contracts — and,
decisively, the user's **own live product Tokenpost** (`Jr-kenny/tokenpost`, `contracts-genlayer/
ClaimVerifier.py`) which runs this exact loop on our **identical** runner hash
(`py-genlayer:1jb45aa8…`) — showed the outbox model is not how this bridge works. 1c replaces it.

## The corrected model (proven by Tokenpost)

- **Send is not a self-polled outbox.** The IC emits a cross-contract call into a deployed GL
  **BridgeSender**; the relay polls *that*, not our contract:
  `gl.get_contract_at(bridge_sender).emit().send_message(target_eid, target_hex, payload)`, where
  `payload = gl.evm.encode(tuple[gl.evm.InplaceTuple, …types], values)`. `gl.evm.encode/decode`
  byte-match Solidity `abi.encode` exactly. `emit()` is **asynchronous** (lands in a follow-up tx).
- **Receive is one entrypoint** `process_bridge_message(message_id, source_chain_id, source_sender,
  message)`, double-gated to `sender == bridge_receiver` **and** `source_sender == hub_contract`,
  decoding with `gl.evm.decode`, then dispatching to internal handlers (no reply on this path).

## Cross-chain ABI contract (authoritative)

```
OUTBOUND (GL → hub):  (uint8 kind, uint256 tokenId, bytes32 profile, address owner, uint256 level)
    kind 0 (mint)  → hub.applyMint(tokenId, profile, owner, level)
    kind 1 (raise) → hub.raiseLevel(tokenId, level)          # profile/owner unused

INBOUND (hub → GL):   (uint8 kind, uint256 tokenId, address newOwner, bytes32 profile, uint256 level)
    kind 0 (owner_changed)   → rebind the stone's driving profile to newOwner's profile
    kind 1 (effective_level) → store the hub-computed perks level for profile
```

`profile` crosses as `bytes32` (the bound GenLayer profile address, left-padded 12 zero bytes) to feed
the hub's `bytes32 profile` storage directly. `level` crosses as `uint256` to match the hub.
`sync_level` is **not** a bridge message — account level is pushed in from the GenLayer core engine, so
it stays operator-gated.

## Done — GenLayer side (`contracts/verdict_stone.py`)

- Removed the outbox entirely: `outbox`, `OutboundMessage`, `next_nonce`, `relayed_cursor`, `_enqueue`,
  `get_outbox_len`, `get_outbox_message`, `get_relayed_cursor`, `mark_relayed`.
- Added `bridge_sender`, `bridge_receiver`, `hub_contract`, `hub_eid` config (constructor args).
- Outbound `mint`/`raise` now build the abi payload and go through guarded `_send` — a **no-op when
  `bridge_sender == ZERO`** so direct unit tests run the full encode + state path without a live bridge;
  the live `emit` is the single integration/xfail line. `request_mint` / `sync_level` **return** their
  emitted payload bytes for testability.
- Former operator methods `on_owner_changed` / `receive_effective_level` are now **internal**, fronted by
  the double-gated `process_bridge_message`. Inbound handlers never reply, so their full success path is
  exercised in direct mode.
- `decode_outbound` / `decode_inbound` public views for the cross-chain boundary + tests.
- **Verification:** 14 direct tests (payloads cross-checked against `eth_abi` to prove Solidity
  byte-equivalence), full direct suite **80 passed / 1 xfailed**, `genvm-lint check` + validation pass.

## Done — EVM GL→hub dispatch, option (b) (this commit)

Chose **(b)**, reusing Tokenpost's target-agnostic `VerdictReceiver` verbatim:

- `contracts/evm/VerdictStoneBridgeReceiver.sol` — ported as-is (dispatch-on-receive: `authorizedRelayers`
  + dedup + `deliverDirect`, plus the LZ `lzReceive` path), decodes the envelope
  `(uint32 srcChainId, address srcSender, address target, bytes message)` and calls
  `IGenLayerBridgeReceiver(target).processBridgeMessage(...)`.
- `contracts/evm/interfaces/IGenLayerBridgeReceiver.sol` — the callback interface.
- `VerdictStoneHub` now `is IGenLayerBridgeReceiver`: added `bridgeReceiver` + `genlayerSource` (owner
  setters), refactored `applyMint`/`raiseLevel` into internal helpers with the operator wrappers kept as
  an admin/escape-hatch path, and added `processBridgeMessage` (gated to the receiver + expected GL
  source; decodes the wire format and dispatches; unexpected sources and unknown kinds are ignored,
  never revert). The relay stays dumb (forwards opaque bytes), so the wire format is enforced on-chain at
  both ends.
- **Verification:** full Hardhat suite **35 passing** (7 new hub bridge-dispatch tests + 4 receiver
  tests). The hub decode (`abi.decode`) and the GL encode (`gl.evm.encode`, cross-checked vs `eth_abi`)
  reference the identical `(uint8,uint256,bytes32,address,uint256)` layout, profile left-padded both ends.

## Remaining — hub→GL inbound + live (needs the user: keys, network, relay)

1. **hub → GL inbound.** Hub emits `owner_changed` (from its existing `StoneOwnerChanged`) and
   `effective_level` (from `effectiveLevelOf`) via the EVM BridgeForwarder; relay delivers to the GL
   BridgeReceiver → `process_bridge_message`. Prefer **authorized-relayer `deliverDirect`**
   (transport-agnostic) since the LZ testnet reverse leg stalls (GENLAYER-FEEDBACK #8).
2. **Bridge reuse — no boilerplate redeploy.** The GenLayer bridge boilerplate is already deployed by
   Tokenpost (vendored at `Tokenpost/spikes/genlayer-bridge/`). Reuse is safe: the GL BridgeSender is a
   shared self-describing queue and Tokenpost's relay already does `if (target !== claimLauncher) continue`,
   so stone messages are inert to the live claim loop. VerdictStone points its `bridge_sender`/
   `bridge_receiver` at the same GL ICs.

3. **Hub deployed to Base Sepolia (2026-06-13)** — proving deployment for the GL→hub deliverDirect path
   (chain-agnostic; ZKsync Era Sepolia remains the canonical hub, pending the `@matterlabs/hardhat-zksync`
   zksolc toolchain). `deploy/deploy-stone-hub.cjs` (`pnpm deploy:stone:hub`), recorded in
   `deploy/deployments/stone-base-sepolia.json`:
   - `VerdictStoneBridgeReceiver`: `0x4Caad3aA8Fe34616479fFB9E8810367eED64c55c`
   - `VerdictStoneHub`: `0x6D612207Eea47Ccbd2Bab0D99bAaa54fFb189609` (bridgeReceiver wired; genlayerSource pending)

4. **DONE — live loop wired + proven (2026-06-16).** The stone relay lives **in this repo** (not in
   Tokenpost's Supabase function) so it is self-contained and reviewable. New artifacts:
   - `deploy/stone-relay.mjs` — bidirectional, transport-agnostic authorized-relayer relay. GL→hub:
     poll the shared GL BridgeSender outbox, keep only `target_contract == hub`, `deliverDirect` to the
     EVM receiver. hub→GL: watch `StoneOwnerChanged`, build the inbound abi payload, call the GL
     BridgeReceiver's `receive_message`. Dedup on-chain both ways → inert to Tokenpost's claim loop.
     (`pnpm relay:stone`, `STONE_RELAY_ONCE=1` for a single pass.)
   - `deploy/deploy-stone.mjs` (`pnpm deploy:stone`) — deploys VerdictStone wired to the reused GL bridge.
   - `deploy/wire-stone-hub.cjs` (`pnpm wire:stone:hub`) — attaches to the existing hub/receiver (no
     redeploy) and sets `genlayerSource` + `authorizedRelayer` (idempotent).
   - `deploy/smoke-stone.mjs` / `deploy/smoke-stone-inbound.mjs` — OUT and IN smokes.

   **Live deployment (studionet + Base Sepolia, deployer/relay `0xa64f1832…`):**
   - `VerdictStone` (GenLayer studionet): **`0x0F603A6BBf535F173804491141fd2b67e8C2C94E`**
     (`bridge_sender`/`bridge_receiver` = Tokenpost's GL ICs; `hub_contract` = the Base hub; `hub_eid` 40245).
   - `hub.genlayerSource` = the VerdictStone IC; `receiver.authorizedRelayer[0xa64f…]` = true. The GL
     BridgeReceiver already had `0xa64f…` authorized (same wallet as Tokenpost's relay) so the IN leg
     needed no extra setup.

   **Proven end-to-end:**
   - **OUT:** GL `request_mint` → BridgeSender outbox → relay `deliverDirect` → `hub.applyMint` —
     Stone token 1 minted on Base, profile `0x…a64f…`, level 2 (`hub.getStone(1)` asserted).
   - **IN:** hub `safeTransferFrom` → `StoneOwnerChanged` → relay → GL `receive_message` →
     `process_bridge_message` (owner_changed). GL BridgeReceiver `is_message_processed` = true for the
     delivery (transport proven; the rebind handler runs in the async follow-up tx and is covered by the
     VerdictStone direct suite).

   **Follow-ups (not blockers):** ZKsync Era Sepolia remains the spec's canonical hub (pending the
   `@matterlabs/hardhat-zksync` zksolc toolchain — Base Sepolia is the proving deployment); the hub→GL
   `effective_level` push (perks sync) is built into the wire format but not yet emitted by a relay
   trigger (only `owner_changed` is wired); for production the stone relay should run on a scheduler
   (cron/pg_cron) like Tokenpost's.
