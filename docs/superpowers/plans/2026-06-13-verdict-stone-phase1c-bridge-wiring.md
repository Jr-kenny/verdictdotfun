# Verdict Stone — Phase 1c: bridge wiring (GenLayer ↔ ZKsync Era hub)

**Status:** GenLayer side **done** (this commit). EVM dispatch + live relay smoke **pending** (needs user/keys).

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
2. **Deploy + smoke.** Deploy the boilerplate (BridgeForwarder/Receiver on the ZKsync Era Sepolia hub +
   BridgeSender/Receiver ICs on GenLayer), deploy `VerdictStoneHub` + `VerdictStoneBridgeReceiver` to the
   hub, wire `hub.setBridgeReceiver` / `hub.setGenlayerSource` / `receiver.setAuthorizedRelayer`, and on
   GenLayer set VerdictStone's `bridge_sender` / `bridge_receiver` / `hub_contract` / `hub_eid`, run the
   relay, prove mint → applyMint and a transfer → owner_changed → rebind end-to-end. Hub spans **ZKsync Era
   Sepolia + Base Sepolia** (decided 2026-06-13). NOTE: ZKsync Era needs the `@matterlabs/hardhat-zksync`
   (zksolc) toolchain + a network entry — hardhat.config currently has only Base Sepolia, which is
   deployable today with the existing config/key.
