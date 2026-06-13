# Verdict Stone NFT — Design

Date: 2026-06-13
Status: approved (brainstorm), pending plan
Supersedes: the soulbound/snapshot model in `contracts/evm/VerdictProfileNft.sol`

## Summary

The Verdict Stone is a tradeable, living reputation artifact for verdictdotfun. A
player mints one once their GenLayer account reaches a gate level. The stone
carries a level that only ever rises (a high-water mark) fed by whoever currently
holds it, and grants perks by level to its holder. A player can sell their stone
to another player, who immediately gains the stone's rank and perks; the seller
keeps their permanent account XP but is left without a stone and must clear a
steeper gate to mint a fresh one. "Immortal, rising": the stone never loses
levels and is never destroyed.

The stone is an omnichain NFT (LayerZero ONFT) that can roam across EVM chains for
trading, while its authoritative living state is held on a single hub chain and
its eligibility/identity logic lives on GenLayer.

## Core mechanic (decided)

- **Two layers.** Account XP/level lives on the GenLayer profile, is permanent,
  and is never sold. The Verdict Stone is a separate tradeable token that carries
  rank + perks. Selling the stone never touches account XP.
- **Living, ratchet-up only.** The stone's level is a high-water mark fed by the
  current holder's ongoing GenLayer XP. It only ever increases. When a stone moves
  to a holder whose own level is lower, it keeps its level (the new holder's rank
  is effectively raised); the holder's XP only matters once it would push the stone
  even higher.
- **Perks by possession, highest applies.** Holding a stone grants perks for its
  level. An account may hold more than one stone (marketplace-friendly, transfers
  never revert), but only the highest-level stone's perks apply; perks never stack.
- **Escalating mint gate.** Minting requires the account level to meet a per-account
  gate that takes a steeper jump each time the account mints, making second and
  third stones genuinely rare.
- **Tradeable, multi-chain.** Standard ONFT/ERC-721 transfers so marketplaces work;
  the stone can roam across EVM chains.

## Architecture — three tiers, single authority each

### GenLayer (the brain): identity and eligibility

Source of truth for *who may mint, at what level, and whose XP drives a stone*.
Extends the existing profile/XP system with:

- **Wallet↔profile binding.** Links the EVM wallet that holds a stone to a GenLayer
  profile. The XP feed and perks key off this link. A buyer establishes/refreshes
  it after a trade so the stone resumes rising with them.
- **Mint gate.** Per-profile mint count and an escalating threshold (steeper jump
  per mint). Default sequence reuses the existing doubling-XP level curve and gates
  on level milestones (e.g. 2 → 5 → 8 → …; tunable).
- **Mint authorization.** On a valid mint request, records starting level = current
  account level, bumps the gate, and emits a bridge message to the hub:
  `mint(profile, ownerWallet, startingLevel, mintId)`.
- **Driver rebind.** On a "stone S now owned by wallet W2" message from the hub,
  resolves W2 → profile (if bound) and sets that profile as the stone's driver.
  Unbound owner ⇒ stone stops rising (holds its level), never drops.
- **Effective level / perks.** Computes effective level per profile (max over stones
  the bound wallet holds, as reported by the hub) and consumes perks on the GenLayer
  side (tournament access, mode unlocks, wager fee tiers in the ledger).

### ZKsync Era (the hub): the living stone

`StoneRegistry` is authoritative for every stone's living state, regardless of where
the token currently sits. GenLayer's bridge boilerplate already lands on ZKsync Era,
so XP-driven level-ups arrive here first.

- Per tokenId: level high-water mark, bound profile, current location (chain id),
  current owner wallet.
- Receives `mint(...)` ⇒ mints the ONFT (born on the hub), sets high-water, binds
  profile, location = hub.
- Receives `raiseLevel(tokenId, level)` ⇒ applies `max(current, level)` (idempotent,
  order-independent), then pushes the new level to the spoke currently holding the
  stone.
- Tracks ownership/location as the stone roams; on owner change notifies GenLayer
  for driver rebind.
- Computes effective level per owner across all chains (it is the only place that
  sees every stone) and pushes "effective level for profile P = N" to GenLayer.

### Spokes (Base first, then others): market + perk surface

The ONFT token lives here for trading and display, carrying a cached level in its
ONFT payload so the local chain can show it and gate spoke-side perks without a
cross-chain read. Standard transfers; marketplaces work unmodified.

### Transport — two LayerZero directions

- **GenLayer ↔ hub** via the GenLayer bridge boilerplate
  (`genlayer-foundation/genlayer-studio-bridge-boilerplate`, LayerZero V2, hub on
  ZKsync Era, arbitrary-bytes messages, currently relay-service-backed). Carries
  mint authorizations, level-ups, effective-level pushes (in), and owner-change /
  rebind notifications (back).
- **hub ↔ spokes** via ONFT/LZ messages. The token roams carrying its level; the
  hub tracks location and pushes ratchet updates to wherever the stone sits.

The ratchet rule (level only increases) is the linchpin: a spoke may lag the hub,
but since updates only raise the level, a stale spoke is never wrong-high, only
behind.

## Data flows

### Mint
1. Player calls mint on their GenLayer profile.
2. GenLayer checks account level ≥ personal gate; if ok, bumps the gate, records
   starting level L, emits `mint(profile, wallet, L, mintId)` to the hub.
3. Hub mints the ONFT (on the hub), high-water = L, binds profile, location = hub,
   owner = wallet. `mintId` dedups replays.
4. Player may bridge the stone to a spoke (Base) to trade.

### Rise (living)
1. Game results raise account XP on GenLayer (existing behavior).
2. When the driving profile's level would exceed the stone's high-water mark,
   GenLayer emits `raiseLevel(stone, L)` to the hub.
3. Hub applies `max`, pushes the new level to the spoke holding the stone; the
   spoke updates its cached level and perks.

### Trade-rebind
1. Stone sells on a spoke as a normal ONFT/ERC-721 transfer.
2. Hub learns the new owner W2, updates owner, and sends "stone S now owned by W2"
   to GenLayer.
3. GenLayer resolves W2 → profile. If bound, that profile becomes the driver;
   future XP raises the stone. If unbound, the stone holds its level until W2 links.
4. Seller keeps permanent account XP, no longer holds the stone, faces the higher
   gate to mint again.

### Perks
- Effective level for a player = max level among stones they hold (across chains),
  computed at the hub.
- v1 consumes perks on GenLayer (tournament access, mode unlocks, wager fee tiers);
  the hub pushes effective level per profile to GenLayer.
- Spoke-side perks enforced on a spoke (e.g. Base vault fee discount) are phase 3,
  needing the effective level mirrored onto that chain.

## Phasing

Each phase is its own plan + build with tests. The spec captures the whole vision;
plans are written phase by phase.

- **Phase 1 — eligibility + hub, single chain, no roaming.** GenLayer: binding,
  escalating gate, starting-level, effective-level, message in/out handlers. Hub:
  `StoneRegistry` + ONFT721 (mint on authorize, ratchet, rebind on transfer).
  Proves the full economy (mint → rise → trade → rebind → perks) on the hub chain
  alone, validating the living mechanic and the GenLayer↔hub bridge round-trips
  before any roaming.
- **Phase 2 — first spoke (Base).** ONFT mesh hub↔Base, location tracking, level
  push to spoke, trade-on-Base → rebind through the hub, marketplace on Base,
  GenLayer-side perks consumed.
- **Phase 3 — more spokes + spoke-side perks, metadata/art per level, polish.**

## Resilience and consensus

- All cross-chain messages are async via the relay service and retried.
- Ratchet-only/`max` makes level messages idempotent and order-independent (handles
  replays, out-of-order delivery, and XP-rise/trade races: worst case a brief feed
  to the prior driver, which can only raise the level).
- Mints dedup on `mintId`. Owner changes are ordered through the hub.
- A stone in flight between chains (burned on source, not yet minted on dest) queues
  its level pushes at the hub; they apply on landing.
- GenLayer errors use `gl.vm.UserError` with `[EXPECTED]`/`[EXTERNAL]`/`[TRANSIENT]`
  prefixes (consistent with the wager framework); bridge/relayer failures are
  transient and retried.

## Testing

- **GenLayer:** direct-mode unit tests (gate escalation, binding, effective-level,
  guarded message emission on zero address) plus integration tests for bridge
  round-trips, same shape as the wager framework.
- **EVM (hub + spokes):** hardhat tests for `StoneRegistry`/ONFT — mint, ratchet,
  location, transfer-rebind hooks, permissions, reentrancy.
- **End to end:** a smoke script (like `smoke-credit-loop`) doing
  mint → rise → trade → rebind on testnet.

## Rebuild vs reuse

- Supersedes `VerdictProfileNft`'s soulbound/snapshot model. Reuse the level curve
  (`_levelForPermanentXp`) and handle cleaning; re-derive the rest.
- New contracts: GenLayer eligibility additions (binding, gate, driver, effective
  level), hub `StoneRegistry` (ONFT721-based), spoke ONFT.
- Keep the existing deploy-script patterns.

## Tunable defaults (set in plans, not blockers)

- **Gate milestones:** reuse the doubling-XP level curve; gate on level milestones
  (default 2 → 5 → 8 → …).
- **Perk tiers (placeholders, product to tune):** reduced wager fee at a mid level,
  tournament access higher, exclusive modes at the top.
- **Metadata/art:** served off-chain and level-aware, extending the existing
  `tokenURI` (baseURI + tokenId) approach.

## Open dependencies / risks

- The GenLayer bridge boilerplate is **beta** and still relay-service-backed
  (pre-mainnet). Phase 1 should confirm the GenLayer↔hub message API and the
  ZKsync Era hub contracts against the boilerplate before building on top.
- Whether GenLayer (Studio/testnet) permits the bridge round-trips at the needed
  rate is unverified; validate early in Phase 1.
