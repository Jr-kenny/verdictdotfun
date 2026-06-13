# Verdict Stone — Phase 1b: EVM Hub Registry — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build `VerdictStoneHub`, the authoritative EVM hub contract for the living Verdict Stone — an operator-driven ERC-721 that mints stones on authorization, ratchets each stone's level up only, exposes the "highest applies" effective level per holder, and emits owner-change events for the relay to feed back to GenLayer.

**Architecture:** A single Solidity contract on the hub chain. The bridge relay (the `operator`) calls `applyMint`/`raiseLevel` from GenLayer's outbox; standard ERC-721 transfers drive trading and emit `StoneOwnerChanged` for the relay to relay to GenLayer's `on_owner_changed`. No LayerZero in this phase (no roaming yet) — it's a plain `ERC721Enumerable` + `Ownable`, ONFT base deferred to Phase 2. Level is a high-water mark; `raiseLevel` applies `max` (no-op on lower/equal) so it is idempotent and order-independent, exactly matching the GenLayer side.

**Tech Stack:** Solidity 0.8.26 (cancun), OpenZeppelin 5.6.x (`ERC721Enumerable`, `Ownable`), Hardhat 2 + ethers v6 + chai matchers. Sources in `contracts/evm`, tests in `test/evm`, run with `npm run test:evm`.

---

## File Structure

- **Create:** `contracts/evm/VerdictStoneHub.sol` — the hub registry + token. One responsibility: authoritative living-stone state and the operator/relay interface.
- **Create:** `test/evm/VerdictStoneHub.test.cjs` — hardhat tests mirroring `test/evm/CreditVault.test.cjs` conventions (chai, `ethers.getContractFactory`, `connect(signer)`, `revertedWithCustomError`, `.to.emit().withArgs()`).

Conventions (from `contracts/evm/CreditVault.sol`): custom errors (not string requires), `Ownable(msg.sender)`, explicit events.

---

### Task 1: Contract skeleton — ERC721Enumerable + Ownable, storage, operator, getStone

**Files:**
- Create: `contracts/evm/VerdictStoneHub.sol`
- Test: `test/evm/VerdictStoneHub.test.cjs`

- [ ] **Step 1: Write the failing test**

```javascript
// test/evm/VerdictStoneHub.test.cjs
const { expect } = require("chai");
const { ethers } = require("hardhat");

const PROFILE = ethers.zeroPadValue("0xabc1230000000000000000000000000000000001", 32);
const HUB_CHAIN = 300; // zksync era eid placeholder for phase 1b

async function deploy() {
  const [owner, operator, alice, bob] = await ethers.getSigners();
  const Hub = await ethers.getContractFactory("VerdictStoneHub");
  const hub = await Hub.deploy("Verdict Stone", "STONE", operator.address, HUB_CHAIN);
  await hub.waitForDeployment();
  return { owner, operator, alice, bob, hub };
}

describe("VerdictStoneHub setup", () => {
  it("deploys with name, symbol, and operator", async () => {
    const { hub, operator } = await deploy();
    expect(await hub.name()).to.equal("Verdict Stone");
    expect(await hub.symbol()).to.equal("STONE");
    expect(await hub.operator()).to.equal(operator.address);
  });

  it("lets the owner change the operator", async () => {
    const { hub, owner, alice } = await deploy();
    await expect(hub.connect(owner).setOperator(alice.address))
      .to.emit(hub, "OperatorUpdated").withArgs(alice.address);
    expect(await hub.operator()).to.equal(alice.address);
  });

  it("rejects setOperator from non-owner", async () => {
    const { hub, alice } = await deploy();
    await expect(hub.connect(alice).setOperator(alice.address))
      .to.be.revertedWithCustomError(hub, "OwnableUnauthorizedAccount");
  });
});

module.exports = { deploy, PROFILE, HUB_CHAIN };
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:evm -- --grep "VerdictStoneHub setup"`
Expected: FAIL (contract `VerdictStoneHub` not found / does not compile).

- [ ] **Step 3: Write minimal implementation**

```solidity
// contracts/evm/VerdictStoneHub.sol
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {ERC721} from "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import {ERC721Enumerable} from "@openzeppelin/contracts/token/ERC721/extensions/ERC721Enumerable.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

/// @notice Authoritative hub registry for the living Verdict Stone (Phase 1b: single chain, no roaming).
contract VerdictStoneHub is ERC721Enumerable, Ownable {
    struct Stone {
        uint256 level;     // high-water mark, only ever rises
        bytes32 profile;   // bound GenLayer profile
        uint64 location;   // chain id currently holding the stone (hub for now)
    }

    address public operator;     // the bridge relay
    uint64 public hubChainId;
    mapping(uint256 => Stone) private _stones;

    event OperatorUpdated(address indexed operator);
    event StoneMinted(uint256 indexed tokenId, bytes32 indexed profile, address indexed to, uint256 level);
    event StoneLeveled(uint256 indexed tokenId, uint256 level);
    event StoneOwnerChanged(uint256 indexed tokenId, address indexed newOwner);

    error NotOperator();
    error StoneExists();
    error UnknownStone();
    error ZeroProfile();
    error ZeroRecipient();

    modifier onlyOperator() {
        if (msg.sender != operator && msg.sender != owner()) revert NotOperator();
        _;
    }

    constructor(string memory name_, string memory symbol_, address operator_, uint64 hubChainId_)
        ERC721(name_, symbol_)
        Ownable(msg.sender)
    {
        operator = operator_ == address(0) ? msg.sender : operator_;
        hubChainId = hubChainId_;
    }

    function setOperator(address newOperator) external onlyOwner {
        operator = newOperator;
        emit OperatorUpdated(newOperator);
    }

    function getStone(uint256 tokenId) external view returns (Stone memory) {
        if (_ownerOf(tokenId) == address(0)) revert UnknownStone();
        return _stones[tokenId];
    }

    function levelOf(uint256 tokenId) external view returns (uint256) {
        if (_ownerOf(tokenId) == address(0)) revert UnknownStone();
        return _stones[tokenId].level;
    }

    // Required override for ERC721Enumerable (OZ 5.x).
    function _update(address to, uint256 tokenId, address auth)
        internal
        override(ERC721Enumerable)
        returns (address)
    {
        address from = _ownerOf(tokenId);
        address result = super._update(to, tokenId, auth);
        if (from != address(0) && to != address(0)) {
            emit StoneOwnerChanged(tokenId, to);
        }
        return result;
    }

    function _increaseBalance(address account, uint128 value) internal override(ERC721Enumerable) {
        super._increaseBalance(account, value);
    }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test:evm -- --grep "VerdictStoneHub setup"`
Expected: PASS (3 passing)

- [ ] **Step 5: Commit**

```bash
git add contracts/evm/VerdictStoneHub.sol test/evm/VerdictStoneHub.test.cjs
git commit -m "feat(stone-hub): VerdictStoneHub skeleton — ERC721 registry, operator, getStone"
```

---

### Task 2: applyMint — operator-gated mint with dedup

**Files:**
- Modify: `contracts/evm/VerdictStoneHub.sol`
- Test: `test/evm/VerdictStoneHub.test.cjs`

- [ ] **Step 1: Write the failing test**

```javascript
const { deploy, PROFILE } = require("./VerdictStoneHub.test.cjs"); // same file; see note
// (Tests below live in the same file, appended under a new describe block.)

describe("VerdictStoneHub applyMint", () => {
  it("mints a stone to the owner and records its state", async () => {
    const { hub, operator, alice } = await deploy();
    await expect(hub.connect(operator).applyMint(1, PROFILE, alice.address, 3))
      .to.emit(hub, "StoneMinted").withArgs(1, PROFILE, alice.address, 3);
    expect(await hub.ownerOf(1)).to.equal(alice.address);
    const s = await hub.getStone(1);
    expect(s.level).to.equal(3);
    expect(s.profile).to.equal(PROFILE);
  });

  it("rejects applyMint from a non-operator", async () => {
    const { hub, alice } = await deploy();
    await expect(hub.connect(alice).applyMint(1, PROFILE, alice.address, 3))
      .to.be.revertedWithCustomError(hub, "NotOperator");
  });

  it("rejects a duplicate tokenId (mint dedup)", async () => {
    const { hub, operator, alice, bob } = await deploy();
    await hub.connect(operator).applyMint(1, PROFILE, alice.address, 3);
    await expect(hub.connect(operator).applyMint(1, PROFILE, bob.address, 9))
      .to.be.revertedWithCustomError(hub, "StoneExists");
  });

  it("rejects zero recipient and zero profile", async () => {
    const { hub, operator, alice } = await deploy();
    await expect(hub.connect(operator).applyMint(1, PROFILE, ethers.ZeroAddress, 3))
      .to.be.revertedWithCustomError(hub, "ZeroRecipient");
    await expect(hub.connect(operator).applyMint(1, ethers.ZeroHash, alice.address, 3))
      .to.be.revertedWithCustomError(hub, "ZeroProfile");
  });
});
```

Note: keep a single test file. The `module.exports = { deploy, ... }` in Task 1 plus `require("./VerdictStoneHub.test.cjs")` self-require is redundant; instead define `deploy` once at the top of the file and reference it directly in every `describe`. When appending Task 2's block, drop the `const { deploy, PROFILE } = require(...)` line and the `ethers` is already in scope from the top of the file.

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:evm -- --grep "VerdictStoneHub applyMint"`
Expected: FAIL (`applyMint` is not a function).

- [ ] **Step 3: Write minimal implementation**

Add to `contracts/evm/VerdictStoneHub.sol` (inside the contract, after `setOperator`):

```solidity
    function applyMint(uint256 tokenId, bytes32 profile, address to, uint256 level) external onlyOperator {
        if (to == address(0)) revert ZeroRecipient();
        if (profile == bytes32(0)) revert ZeroProfile();
        if (_ownerOf(tokenId) != address(0)) revert StoneExists();
        _stones[tokenId] = Stone({level: level, profile: profile, location: hubChainId});
        _safeMint(to, tokenId);
        emit StoneMinted(tokenId, profile, to, level);
    }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test:evm -- --grep "VerdictStoneHub applyMint"`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add contracts/evm/VerdictStoneHub.sol test/evm/VerdictStoneHub.test.cjs
git commit -m "feat(stone-hub): applyMint — operator-gated, dedup, records stone state"
```

---

### Task 3: raiseLevel — ratchet up, no-op on lower/equal

**Files:**
- Modify: `contracts/evm/VerdictStoneHub.sol`
- Test: `test/evm/VerdictStoneHub.test.cjs`

- [ ] **Step 1: Write the failing test**

```javascript
describe("VerdictStoneHub raiseLevel", () => {
  it("raises the level and emits when higher", async () => {
    const { hub, operator, alice } = await deploy();
    await hub.connect(operator).applyMint(1, PROFILE, alice.address, 3);
    await expect(hub.connect(operator).raiseLevel(1, 7))
      .to.emit(hub, "StoneLeveled").withArgs(1, 7);
    expect(await hub.levelOf(1)).to.equal(7);
  });

  it("is a no-op on a lower or equal level (idempotent, order-independent)", async () => {
    const { hub, operator, alice } = await deploy();
    await hub.connect(operator).applyMint(1, PROFILE, alice.address, 5);
    await expect(hub.connect(operator).raiseLevel(1, 5)).to.not.emit(hub, "StoneLeveled");
    await expect(hub.connect(operator).raiseLevel(1, 2)).to.not.emit(hub, "StoneLeveled");
    expect(await hub.levelOf(1)).to.equal(5);
  });

  it("rejects raiseLevel on an unknown stone and from a non-operator", async () => {
    const { hub, operator, alice } = await deploy();
    await expect(hub.connect(operator).raiseLevel(99, 7))
      .to.be.revertedWithCustomError(hub, "UnknownStone");
    await hub.connect(operator).applyMint(1, PROFILE, alice.address, 3);
    await expect(hub.connect(alice).raiseLevel(1, 7))
      .to.be.revertedWithCustomError(hub, "NotOperator");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:evm -- --grep "VerdictStoneHub raiseLevel"`
Expected: FAIL (`raiseLevel` is not a function).

- [ ] **Step 3: Write minimal implementation**

Add to `contracts/evm/VerdictStoneHub.sol` (after `applyMint`):

```solidity
    function raiseLevel(uint256 tokenId, uint256 level) external onlyOperator {
        if (_ownerOf(tokenId) == address(0)) revert UnknownStone();
        if (level > _stones[tokenId].level) {
            _stones[tokenId].level = level;
            emit StoneLeveled(tokenId, level);
        }
    }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test:evm -- --grep "VerdictStoneHub raiseLevel"`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add contracts/evm/VerdictStoneHub.sol test/evm/VerdictStoneHub.test.cjs
git commit -m "feat(stone-hub): raiseLevel — ratchet up, no-op on lower/equal"
```

---

### Task 4: Owner-change event on transfer

**Files:**
- (Logic already in the `_update` override from Task 1.) This task adds the proving tests.
- Test: `test/evm/VerdictStoneHub.test.cjs`

- [ ] **Step 1: Write the failing test**

```javascript
describe("VerdictStoneHub owner-change signalling", () => {
  it("emits StoneOwnerChanged on transfer but not on mint", async () => {
    const { hub, operator, alice, bob } = await deploy();
    // mint should NOT emit StoneOwnerChanged (from == 0)
    await expect(hub.connect(operator).applyMint(1, PROFILE, alice.address, 3))
      .to.not.emit(hub, "StoneOwnerChanged");
    // a real transfer SHOULD emit it so the relay can rebind on GenLayer
    await expect(hub.connect(alice).transferFrom(alice.address, bob.address, 1))
      .to.emit(hub, "StoneOwnerChanged").withArgs(1, bob.address);
    expect(await hub.ownerOf(1)).to.equal(bob.address);
  });
});
```

- [ ] **Step 2: Run test to verify it passes immediately**

Run: `npm run test:evm -- --grep "owner-change signalling"`
Expected: PASS (the `_update` override from Task 1 already implements this). If it fails, the override is wrong — fix it before continuing.

- [ ] **Step 3: Commit**

```bash
git add test/evm/VerdictStoneHub.test.cjs
git commit -m "test(stone-hub): prove StoneOwnerChanged fires on transfer, not mint"
```

---

### Task 5: effectiveLevelOf — highest applies across an owner's stones

**Files:**
- Modify: `contracts/evm/VerdictStoneHub.sol`
- Test: `test/evm/VerdictStoneHub.test.cjs`

- [ ] **Step 1: Write the failing test**

```javascript
describe("VerdictStoneHub effectiveLevelOf", () => {
  it("returns 0 for a holder with no stones", async () => {
    const { hub, alice } = await deploy();
    expect(await hub.effectiveLevelOf(alice.address)).to.equal(0);
  });

  it("returns the max level among the holder's stones (highest applies, no stacking)", async () => {
    const { hub, operator, alice } = await deploy();
    await hub.connect(operator).applyMint(1, PROFILE, alice.address, 4);
    await hub.connect(operator).applyMint(2, PROFILE, alice.address, 9);
    await hub.connect(operator).applyMint(3, PROFILE, alice.address, 2);
    expect(await hub.effectiveLevelOf(alice.address)).to.equal(9);
  });

  it("recomputes after a transfer moves the top stone away", async () => {
    const { hub, operator, alice, bob } = await deploy();
    await hub.connect(operator).applyMint(1, PROFILE, alice.address, 4);
    await hub.connect(operator).applyMint(2, PROFILE, alice.address, 9);
    await hub.connect(alice).transferFrom(alice.address, bob.address, 2);
    expect(await hub.effectiveLevelOf(alice.address)).to.equal(4);
    expect(await hub.effectiveLevelOf(bob.address)).to.equal(9);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:evm -- --grep "effectiveLevelOf"`
Expected: FAIL (`effectiveLevelOf` is not a function).

- [ ] **Step 3: Write minimal implementation**

Add to `contracts/evm/VerdictStoneHub.sol` (after `levelOf`):

```solidity
    /// @notice Highest level among the holder's stones. Perks read this; holding many never stacks.
    function effectiveLevelOf(address holder) external view returns (uint256 maxLevel) {
        uint256 n = balanceOf(holder);
        for (uint256 i = 0; i < n; i++) {
            uint256 tokenId = tokenOfOwnerByIndex(holder, i);
            uint256 lvl = _stones[tokenId].level;
            if (lvl > maxLevel) {
                maxLevel = lvl;
            }
        }
    }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test:evm -- --grep "effectiveLevelOf"`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add contracts/evm/VerdictStoneHub.sol test/evm/VerdictStoneHub.test.cjs
git commit -m "feat(stone-hub): effectiveLevelOf — highest applies across a holder's stones"
```

---

### Task 6: Compile + full EVM suite

**Files:** none (verification only)

- [ ] **Step 1: Compile**

Run: `npm run compile:evm`
Expected: compiles clean (no warnings that fail the build) on solc 0.8.26.

- [ ] **Step 2: Run the whole EVM suite (no regressions)**

Run: `npm run test:evm`
Expected: all `CreditVault` tests still pass plus the new `VerdictStoneHub` blocks.

---

## Self-Review

**Spec coverage (design doc, ZKsync hub tier + Phase 1, no-roaming subset):**
- Authoritative per-stone living state (level high-water, bound profile, location) → `Stone` struct + `_stones`. ✓
- Mint on authorization, born on hub, dedup → `applyMint` (operator-gated, `StoneExists`, `location = hubChainId`). ✓
- Ratchet-up-only level, idempotent/order-independent → `raiseLevel` applies `max`, no-op (no event) on lower/equal. Matches GenLayer's "queue raise only when higher; hub applies max." ✓
- Owner-change signalling for GenLayer rebind → `StoneOwnerChanged` from the `_update` hook on transfer (not mint). Feeds Plan A's `on_owner_changed`. ✓
- "Highest applies" perks across all of a holder's stones → `effectiveLevelOf`. Feeds Plan A's `receive_effective_level` (relay reads here, maps owner→profile, pushes to GenLayer). ✓
- Multiple stones per holder, marketplace-friendly transfers → plain ERC-721, no transfer restrictions. ✓
- Out of scope here (later phases): LayerZero ONFT base + roaming + location updates (Phase 2); the actual relay/bridge wiring that calls `applyMint`/`raiseLevel` and consumes `StoneOwnerChanged`/`effectiveLevelOf` (Phase 1c).

**Placeholder scan:** No TBD/TODO. Every code step is complete. Task 4 is test-only because its logic shipped in Task 1's `_update` override — called out explicitly.

**Type consistency:** `Stone{level:uint256, profile:bytes32, location:uint64}` used identically in `applyMint`, `raiseLevel`, `getStone`, `effectiveLevelOf`. `applyMint(uint256,bytes32,address,uint256)` / `raiseLevel(uint256,uint256)` / `effectiveLevelOf(address)` signatures match every test call site. Custom errors (`NotOperator`, `StoneExists`, `UnknownStone`, `ZeroProfile`, `ZeroRecipient`) all declared and used. `OwnableUnauthorizedAccount` is OZ 5.x's built-in error (used in the setOperator non-owner test).

**Test-file note:** Define `deploy`, `PROFILE`, `HUB_CHAIN`, and use `ethers` once at the top of `test/evm/VerdictStoneHub.test.cjs`; every `describe` block references them directly (no self-`require`). The `module.exports` line shown in Task 1 is only there to make the snippet self-contained — drop it in the real single-file version.
