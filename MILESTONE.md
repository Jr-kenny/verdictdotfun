# VerdictDotFun - Milestone Update

From an on-chain game loop to a full on-chain wager platform: a cross-chain living-reputation NFT, an LLM-judged appeals court, a credit value rail with real deposits, escrowed wagers and cash-out, and five new game modes on one generic registry.

- **App:** https://verdictdotfun.vercel.app
- **Code:** https://github.com/Jr-kenny/verdictdotfun

---

## What changed since the accepted submission

The original VerdictDotFun proved a contract-driven game loop (Argue + Riddle, persistent identity, leaderboard, core-router architecture). Since then it has grown into a real-stakes platform. Six milestones, each clear new work beyond the original, all deployed live on GenLayer StudioNet + Base Sepolia.

---

## Milestone 1 - Real-value wagering with an on-chain credit rail

*(major feature + new contracts + new deployments)*

Players can now stake on matches with credits backed by a real on-chain vault.

- New CreditVault contract on Base Sepolia: deposit ETH/USDC, attributed to a profile.
- New CreditLedger contract on GenLayer: atto-scale credit balances, per-room escrow, two-phase settlement.
- `core.create_room` now threads a stake into the mode contract; the escrow opens when the opponent joins and the winner takes the pot.
- New "Buy Credits" and "Cash out / Redeem" flows in the UI, with a wager step in room creation and the stake shown on live rooms before you join.
- Wagered wins grant bonus XP scaled to the stake, so playing with credits on the line is worth more on the ladder.

---

## Milestone 2 - A hosted, cross-service value bridge

*(new integration + real infrastructure)*

The credit rail runs itself, not on a laptop.

- A Supabase Edge Function on a per-minute pg_cron schedule mirrors vault deposits into ledger credits, settles redeems back to ETH, and auto-finalizes matches past their challenge window.
- A signature-authenticated redeem endpoint lets a player cash out by signing a message (no gas), which the bridge verifies and settles on-chain.
- The per-minute job doubles as a keep-alive, so the rail never goes idle.

---

## Milestone 3 - Verdict Stone: a cross-chain living-reputation NFT

*(new contract functionality + cross-chain integration + new deployments)*

A tradeable reputation relic whose level ratchets up with its holder's deeds and never falls, so it carries its rank to its next owner.

- New GenLayer VerdictStone IC owns eligibility, profile binding, and an escalating mint gate.
- New EVM VerdictStoneHub (ERC-721) on Base Sepolia is the authoritative registry; perks read the highest stone a wallet holds.

### How the cross-chain bridge actually works

The Stone must live in two places at once: GenLayer owns WHO earned it (eligibility, profile binding, the mint gate); an EVM chain owns the TRADEABLE TOKEN (the ERC-721). Keeping them in sync is the new integration.

**Topology - hub and spoke over LayerZero V2.** Built on the GenLayer bridge boilerplate: hub-and-spoke with ZKsync Era as the central hub. GenLayer traffic routes to a BridgeForwarder/BridgeReceiver on ZKsync Era, which relays over LayerZero V2 to the target spoke (Base Sepolia), addressed by LayerZero endpoint id (Base Sepolia EID 40245, ZKsync Sepolia EID 40305). The bridge carries ARBITRARY BYTES, not assets, so there is no ONFT/OFT lock-and-mint. We move facts (mint this, raise level, owner changed) and each chain stays the authority over its own state.

**Speaking EVM from GenLayer.** The key primitive is `gl.evm.encode` / `gl.evm.decode`, which byte-match Solidity `abi.encode` exactly, so a GenLayer contract can build real EVM calldata. Fixed wire format both ways:

```text
OUT (GL -> hub): (uint8 kind, uint256 tokenId, bytes32 profile,
                  address owner, uint256 level)   kind 0=mint, 1=raise
IN  (hub -> GL): (uint8 kind, uint256 tokenId, address newOwner,
                  bytes32 profile, uint256 level) kind 0=owner_changed
```

We unit-test the encoding against a Solidity ABI coder so the bytes match.

**Send path (GenLayer -> EVM).** VerdictStone does not poll itself. On a mint or level-up it makes a cross-contract `emit()` into a deployed GenLayer BridgeSender IC: `gl.get_contract_at(bridge_sender).emit().send_message(target_eid, target_contract, payload)`. The BridgeSender stores a self-describing message (target chain, target contract, sender, ABI payload). `emit()` is asynchronous (lands in a follow-up tx), so nothing blocks the player.

**Receive path (EVM -> GenLayer).** One double-gated entrypoint: `process_bridge_message(message_id, source_chain_id, source_sender, message)`. It only accepts calls from the GenLayer BridgeReceiver IC AND only when `source_sender` matches the expected hub; otherwise it silently ignores the message. The EVM side mirrors this: `Hub.processBridgeMessage` is gated to the receiver plus the expected GenLayer source.

**The relay and the transport.** A small relay watches both queues. It runs on the authorized-relayer deliverDirect path, GenLayer's transport-agnostic mode: it polls the BridgeSender outbox, filters to messages addressed to our hub, and delivers them to the EVM receiver; and it watches the hub's StoneOwnerChanged events to push owner changes back into the GenLayer BridgeReceiver. We use this rather than the raw LayerZero leg because the LayerZero testnet committer stalls on this lane, and the bridge is designed transport-agnostic for exactly this, so it is on-pattern. The same messages flow over LayerZero V2 on mainnet unchanged.

**Safety and reuse.** Delivery is idempotent and deduplicated on-chain in both directions (EVM tracks delivery ids; GenLayer tracks processed message ids), so a relay that dies mid-transaction is harmless: the next tick's on-chain guards skip what is already done. Because the BridgeSender is a shared, self-describing queue, the relay filters by target contract, so Verdict Stone messages are inert to any other traffic on the same queue and vice versa.

```text
GENLAYER (StudioNet)                       BASE SEPOLIA (EVM spoke)
--------------------                       ------------------------
VerdictStone IC                            VerdictStoneHub (ERC-721)
eligibility / mint gate / binding          authoritative registry

OUT  mint or raise level
  VerdictStone.request_mint
     |  gl.evm.encode -> ABI bytes
     v  emit().send_message  (async)
  GL BridgeSender IC (outbox)
     |
     |   relay polls outbox, filters by target,
     |   deliverDirect (authorized, idempotent)
     +------------------------------------------>  VerdictStoneBridgeReceiver
                                                       |  decode envelope
                                                       v
                                                   Hub.processBridgeMessage
                                                   (gated: receiver + GL source)
                                                       |
                                                       v
                                                   applyMint / raiseLevel

IN   owner changed on a trade/transfer
  process_bridge_message  <---- GL BridgeReceiver <---- relay watches
  (gated: receiver + hub)        (authorized relayer)   StoneOwnerChanged on Hub
     |
     v  rebind the stone's driving profile to the new owner

Transport: hub-and-spoke through a ZKsync Era hub over LayerZero V2.
Testnet runs the transport-agnostic deliverDirect path (LZ testnet leg
stalls); the same messages flow over LayerZero V2 on mainnet.
```

Proven live, both directions on testnet: a GenLayer `request_mint` emitted a payload the relay delivered to `hub.applyMint` (stone minted on Base with the correct bound profile and level), and an EVM `safeTransferFrom` emitted StoneOwnerChanged that the relay delivered into `process_bridge_message`, rebinding the stone's driving profile on GenLayer.

---

## Milestone 4 - The Stone Market

*(new contract + new deployment)*

- New StoneMarket contract on Base Sepolia: non-custodial, approval-based listings, buy in ETH, configurable fee, stale-listing protection.
- A `/market` hub UI to browse the reliquary, see your perk level, and list/buy stones. A sale flows through the same bridge so the stone's reputation rebinds to its new owner automatically.

---

## Milestone 5 - A GenLayer-judged appeals court

*(new contract functionality + the AI-as-engine thesis, deepened)*

The most GenLayer-native milestone: the contract's LLM consensus is the judge.

- Settlement is now two-phase: a verdict sets a provisional winner and opens a challenge window with the pot escrowed.
- The losing player can file an appeal with a written reason and optional image evidence (IPFS).
- The GenLayer contract itself judges the appeal via LLM consensus over the evidence and returns uphold (winner stands) or overturn (void and refund both stakes). Deterministic bad evidence is dismissed rather than reverting, so a junk CID can never wedge a room.
- The full provisional -> window -> appeal -> judge -> finalize flow is now in the room UI.

```text
room in progress
     |
verdict resolves  OR  a player quits/disconnects
     |
     v
PROVISIONAL WINNER set, pot escrowed, 1h challenge window opens
     |
     +--- window expires, no appeal --------------------+
     +--- loser files appeal (reason + optional image)  |
              |                                          |
              v                                          |
         GenLayer JUDGES the appeal (LLM consensus)      |
              |                                          |
         UPHELD (winner stands)  /  OVERTURNED (void, refund both)
              |                                          |
              +----------------- FINALIZE <--------------+
              pot released per final outcome, settlement idempotent
```

---

## Milestone 6 - Five new game modes on one generic registry

*(major feature + five new contracts + new deployments)*

The architecture rebuild's payoff: five new modes shipped in one wave, each its own contract, each plugged into the same core registry, credit-wager escrow, and two-phase appeal court with NO core redeploy. The game went from two modes to seven (argue, riddle, bluff, prompt_duel, sketch, persuade, oracle), and each new mode is a DIFFERENT GenLayer-native use of the model, not the same judge with a new prompt.

- **Bluff** - both players are handed the SAME hard, dubious AI-generated claim and argue it is true; the LLM scores persuasion ONLY and explicitly ignores whether the claim is actually real.
- **Prompt Duel (Prompt Golf)** - the contract generates a hidden target output, then RUNS each player's submitted prompt through the model and scores how closely the result reproduces the target; the shorter prompt breaks ties. The model is the execution engine here, not just the referee.
- **Sketch & Guess** - a vision mode: each player draws to a theme and guesses what their opponent drew, and a multimodal model judges each guess against the actual image. A deterministic fallback resolves unreadable drawings, so a bad upload can never wedge the room.
- **Persuade-the-Agent** - a full multi-turn mode: a stubborn, stateful AI character with a 0-100 concession meter. Each player runs their own short conversation trying to move it; the higher meter wins. The NUMERIC meter is the consensus-safe settlement value; the model's prose is leader-only flavor.
- **Oracle Forecast** - live web resolution: a YES/NO question about a real event with a public source. After the deadline the contract fetches the source over the open web and the LLM reads the real-world outcome to settle the wager; an operator fallback covers an unreachable source, and the dispute window reuses the appeal court.

Each ships with its own GenLayer direct test suite (LLM and web calls mocked), inherits stake-scaled bonus XP and the appeal flow for free, and is registered and wired to the credit ledger by the deploy path with no change to the core contract.

---

## Architecture and security hardening

*(architecture / security improvement)*

- Rebuilt the original hackathon contracts: bare `Exception` (which becomes an unrecoverable VM error) replaced with `gl.vm.UserError`; a generic dynamic mode registry replaced the hardcoded two-mode setup; money is atto-scale u256.
- Cross-chain messages are double-gated (only the bridge receiver, and only the expected source) and deduplicated on-chain in both directions, so reused bridge infrastructure cannot misdeliver or replay.
- Appeal evidence uses an alnum-only CID guard (SSRF-safe against a fixed IPFS gateway) and validates images by magic bytes, not content-type. Sketch drawings use the same image-validation path against an allowlisted file host.

---

## Live deployments (proof of what changed)

- **App:** https://verdictdotfun.vercel.app
- **Code:** https://github.com/Jr-kenny/verdictdotfun

**Game engine (GenLayer StudioNet):**

| Contract | Address |
| --- | --- |
| core | [0x2490fb764c6e1f9Fb1937c186A57B1BBb2062b53](https://studio.genlayer.com/contracts?import-contract=0x2490fb764c6e1f9Fb1937c186A57B1BBb2062b53) |
| argue | [0xace8CFCd2A0a42BFB46FD5Fdf0d87c306d2E76Eb](https://studio.genlayer.com/contracts?import-contract=0xace8CFCd2A0a42BFB46FD5Fdf0d87c306d2E76Eb) |
| riddle | [0xf5FddBAECd66C934a0Db1a337fFAE2a9bd9f23B6](https://studio.genlayer.com/contracts?import-contract=0xf5FddBAECd66C934a0Db1a337fFAE2a9bd9f23B6) |
| bluff | [0xd1B89325B4dc02355Cb106d3830162F99768a076](https://studio.genlayer.com/contracts?import-contract=0xd1B89325B4dc02355Cb106d3830162F99768a076) |
| prompt_duel | [0x4958Aa2C6C1ACEE81342Fd4E0BA5F18beF8070Ec](https://studio.genlayer.com/contracts?import-contract=0x4958Aa2C6C1ACEE81342Fd4E0BA5F18beF8070Ec) |
| sketch | [0x32A720ae1C02319989306b037Ebce252Ec78BD7C](https://studio.genlayer.com/contracts?import-contract=0x32A720ae1C02319989306b037Ebce252Ec78BD7C) |
| persuade | [0x25789e3d6f078a60Db5e520D1756d569D2721cE9](https://studio.genlayer.com/contracts?import-contract=0x25789e3d6f078a60Db5e520D1756d569D2721cE9) |
| oracle | [0x827059e0866c465d8D79E7f624988CC7A9D651e4](https://studio.genlayer.com/contracts?import-contract=0x827059e0866c465d8D79E7f624988CC7A9D651e4) |

**Verdict Stone:**

- GenLayer IC: `0x0F603A6BBf535F173804491141fd2b67e8C2C94E`
- EVM hub: `0x6D612207Eea47Ccbd2Bab0D99bAaa54fFb189609` (Base Sepolia)

**Credit rail:**

- CreditVault: `0x604bb7eb4dBCD4D1bd2A11166367284a5aFD1a9a` (Base Sepolia)
- CreditLedger: `0xeb70F3bbC2706c9cC2A83BEf27B2D07fa1b07De5` (GenLayer)

**Stone Market:** `0x186F2c624520313AFDaB650F90EedC57713CC27E` (Base Sepolia)

---

## Verification

GenLayer direct test suite and EVM (Hardhat) suite both green, covering the credit escrow + two-phase settlement, the appeal judge with image evidence, the stake-scaled bonus XP, the marketplace, the cross-chain wire format (byte-checked against Solidity ABI encoding), and each of the five new game modes. The cross-chain Stone loop is verified live on testnet in both directions.

---

## What is next

- A full live wager match played end to end through real credits, and a live appeal vision round-trip with pinned evidence.
- ZKsync Era as the canonical bridge hub (Base Sepolia is the current proving deployment).
- Per-level Stone art and season systems, with the generic registry left open for still more modes on top of the seven now live.

---

## Why this is a milestone, not a resubmission

The original was a game loop. This update adds money (a deposit-backed credit rail and escrowed wagers), a cross-chain asset (a living NFT that roams and trades over a LayerZero V2 bridge), an AI court (LLM-judged appeals that move real stakes), the infrastructure to run it hands-off, and five new game modes that take the game from two to seven, each a distinct GenLayer-native use of the model. Every one is a new contract, a new deployment, or a new integration that did not exist in the accepted version, and each is verifiable at the addresses above.
