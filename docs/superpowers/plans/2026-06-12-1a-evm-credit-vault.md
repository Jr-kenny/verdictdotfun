# Plan 1A — EVM CreditVault Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a hardened EVM custody vault on Base Sepolia where a user deposits ETH/USDC attributed to a GenLayer profile, and an authorized bridge releases funds on redeem.

**Architecture:** A single non-upgradeable `CreditVault.sol` holds real funds. Deposits emit `CreditPurchased` carrying the target GenLayer profile id; the off-chain relayer (Plan 1D) mints matching credits on GenLayer. Redeems are gated to a single rotatable `bridge` authority, deduplicated by `redeemId`, reentrancy-guarded and pausable. The vault is the source of *custody*; the GenLayer `CreditLedger` (Plan 1B) is the source of *entitlement truth*.

**Tech Stack:** Solidity 0.8.26 (cancun), OpenZeppelin Contracts 5.x (`SafeERC20`, `ReentrancyGuard`, `Pausable`, `Ownable`), Hardhat + `@nomicfoundation/hardhat-ethers`, Mocha/Chai.

**This is a rebuild, not a patch.** Do not assume any existing EVM code is correct. `CreditVault.sol` is net-new.

---

## File Structure

- Create: `contracts/evm/CreditVault.sol` — custody + deposit/redeem, hardened.
- Create: `test/evm/CreditVault.test.cjs` — hardhat unit tests.
- Create: `test/evm/helpers/MockERC20.sol` — 6-decimal mock USDC for tests.
- Modify: `hardhat.config.cjs` — add `paths.tests = "./test/evm"`.
- Modify: `package.json` — add `test:evm` script + dev deps.
- Create: `deploy/deploy-credit-vault.cjs` — deploy script for Base Sepolia.

---

## Task 1: Hardhat test harness for EVM

**Files:**
- Modify: `hardhat.config.cjs`
- Modify: `package.json`

- [ ] **Step 1: Add test deps**

Run:
```bash
pnpm add -D @nomicfoundation/hardhat-chai-matchers @nomicfoundation/hardhat-network-helpers chai@4 mocha
```
Expected: packages added to devDependencies.

- [ ] **Step 2: Wire the matchers and test path into hardhat config**

In `hardhat.config.cjs`, add at the top with the other `require`s:
```js
require("@nomicfoundation/hardhat-chai-matchers");
```
And inside `module.exports`, extend the existing `paths` block to:
```js
  paths: {
    sources: "./contracts/evm",
    tests: "./test/evm",
    cache: "./hardhat-cache",
    artifacts: "./hardhat-artifacts",
  },
```

- [ ] **Step 3: Add the test script**

In `package.json` `scripts`, add:
```json
    "test:evm": "hardhat test --config hardhat.config.cjs",
```

- [ ] **Step 4: Verify hardhat runs with zero tests**

Run: `pnpm test:evm`
Expected: `0 passing` (no error). Confirms config + paths resolve.

- [ ] **Step 5: Commit**

```bash
git add hardhat.config.cjs package.json pnpm-lock.yaml
git commit -m "chore(evm): add hardhat test harness for CreditVault"
```

---

## Task 2: MockERC20 test token (6-decimal USDC stand-in)

**Files:**
- Create: `test/evm/helpers/MockERC20.sol`

- [ ] **Step 1: Write the mock**

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

contract MockERC20 is ERC20 {
    uint8 private immutable _decimals;

    constructor(string memory name_, string memory symbol_, uint8 decimals_)
        ERC20(name_, symbol_)
    {
        _decimals = decimals_;
    }

    function decimals() public view override returns (uint8) {
        return _decimals;
    }

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}
```

- [ ] **Step 2: Compile**

Run: `pnpm exec hardhat compile --config hardhat.config.cjs`
Expected: compiles (MockERC20 + existing contracts).

- [ ] **Step 3: Commit**

```bash
git add test/evm/helpers/MockERC20.sol
git commit -m "test(evm): add MockERC20 6-decimal token for vault tests"
```

---

## Task 3: CreditVault — deposit paths (ETH + ERC20) with profile attribution

**Files:**
- Create: `contracts/evm/CreditVault.sol`
- Create: `test/evm/CreditVault.test.cjs`

- [ ] **Step 1: Write the failing deposit tests**

`test/evm/CreditVault.test.cjs`:
```js
const { expect } = require("chai");
const { ethers } = require("hardhat");

const ETH = "0x0000000000000000000000000000000000000000";
const PROFILE = ethers.zeroPadValue("0xabc1230000000000000000000000000000000001", 32);

async function deploy() {
  const [owner, bridge, user] = await ethers.getSigners();
  const Vault = await ethers.getContractFactory("CreditVault");
  const vault = await Vault.deploy(owner.address, bridge.address);
  await vault.waitForDeployment();

  const Token = await ethers.getContractFactory("MockERC20");
  const usdc = await Token.deploy("USD Coin", "USDC", 6);
  await usdc.waitForDeployment();
  await usdc.mint(user.address, 1_000_000n); // 1.0 USDC (6 decimals)

  await vault.connect(owner).setTokenAllowed(await usdc.getAddress(), true);
  return { owner, bridge, user, vault, usdc };
}

describe("CreditVault deposits", () => {
  it("accepts ETH deposits and emits CreditPurchased with a rising nonce", async () => {
    const { user, vault } = await deploy();
    await expect(vault.connect(user).depositEth(PROFILE, { value: ethers.parseEther("0.5") }))
      .to.emit(vault, "CreditPurchased")
      .withArgs(user.address, ETH, PROFILE, ethers.parseEther("0.5"), 1n);
    expect(await ethers.provider.getBalance(await vault.getAddress())).to.equal(ethers.parseEther("0.5"));
  });

  it("accepts allowed ERC20 deposits via transferFrom", async () => {
    const { user, vault, usdc } = await deploy();
    const addr = await usdc.getAddress();
    await usdc.connect(user).approve(await vault.getAddress(), 1_000_000n);
    await expect(vault.connect(user).depositToken(addr, 1_000_000n, PROFILE))
      .to.emit(vault, "CreditPurchased")
      .withArgs(user.address, addr, PROFILE, 1_000_000n, 1n);
    expect(await usdc.balanceOf(await vault.getAddress())).to.equal(1_000_000n);
  });

  it("rejects deposits of non-allowed tokens", async () => {
    const { user, vault } = await deploy();
    const Token = await ethers.getContractFactory("MockERC20");
    const rogue = await Token.deploy("Rogue", "RG", 18);
    await rogue.waitForDeployment();
    await rogue.mint(user.address, 10n);
    await rogue.connect(user).approve(await vault.getAddress(), 10n);
    await expect(vault.connect(user).depositToken(await rogue.getAddress(), 10n, PROFILE))
      .to.be.revertedWithCustomError(vault, "TokenNotAllowed");
  });

  it("rejects ETH deposits with zero value and a zero profile", async () => {
    const { user, vault } = await deploy();
    await expect(vault.connect(user).depositEth(PROFILE, { value: 0n }))
      .to.be.revertedWithCustomError(vault, "ZeroAmount");
    await expect(vault.connect(user).depositEth(ethers.ZeroHash, { value: 1n }))
      .to.be.revertedWithCustomError(vault, "ZeroProfile");
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm test:evm`
Expected: FAIL — `CreditVault` artifact not found / cannot deploy.

- [ ] **Step 3: Implement the deposit half of the vault**

`contracts/evm/CreditVault.sol`:
```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

/// @title CreditVault
/// @notice Custody of ETH/USDC backing GenLayer credits. Deposits are attributed
///         to a GenLayer profile id (bytes32). Redeems are gated to the bridge.
contract CreditVault is ReentrancyGuard, Pausable, Ownable {
    using SafeERC20 for IERC20;

    address public constant ETH = address(0);

    address public bridge;
    uint256 public depositNonce;
    mapping(address => bool) public tokenAllowed;
    mapping(uint256 => bool) public processedRedeem;

    event CreditPurchased(
        address indexed user,
        address indexed token,
        bytes32 indexed profile,
        uint256 amount,
        uint256 nonce
    );
    event CreditRedeemed(
        address indexed user,
        address indexed token,
        uint256 amount,
        uint256 redeemId
    );
    event BridgeUpdated(address indexed previousBridge, address indexed newBridge);
    event TokenAllowedUpdated(address indexed token, bool allowed);

    error ZeroAmount();
    error ZeroProfile();
    error ZeroAddress();
    error TokenNotAllowed();
    error NotBridge();
    error RedeemAlreadyProcessed();
    error EthTransferFailed();
    error InsufficientVaultBalance();

    modifier onlyBridge() {
        if (msg.sender != bridge) revert NotBridge();
        _;
    }

    constructor(address initialOwner, address initialBridge) Ownable(initialOwner) {
        if (initialBridge == address(0)) revert ZeroAddress();
        bridge = initialBridge;
        emit BridgeUpdated(address(0), initialBridge);
    }

    function depositEth(bytes32 profile) external payable whenNotPaused nonReentrant {
        if (msg.value == 0) revert ZeroAmount();
        if (profile == bytes32(0)) revert ZeroProfile();
        uint256 nonce = ++depositNonce;
        emit CreditPurchased(msg.sender, ETH, profile, msg.value, nonce);
    }

    function depositToken(address token, uint256 amount, bytes32 profile)
        external
        whenNotPaused
        nonReentrant
    {
        if (amount == 0) revert ZeroAmount();
        if (profile == bytes32(0)) revert ZeroProfile();
        if (!tokenAllowed[token]) revert TokenNotAllowed();
        uint256 nonce = ++depositNonce;
        IERC20(token).safeTransferFrom(msg.sender, address(this), amount);
        emit CreditPurchased(msg.sender, token, profile, amount, nonce);
    }

    function setTokenAllowed(address token, bool allowed) external onlyOwner {
        if (token == address(0)) revert ZeroAddress();
        tokenAllowed[token] = allowed;
        emit TokenAllowedUpdated(token, allowed);
    }

    function setBridge(address newBridge) external onlyOwner {
        if (newBridge == address(0)) revert ZeroAddress();
        emit BridgeUpdated(bridge, newBridge);
        bridge = newBridge;
    }

    function pause() external onlyOwner {
        _pause();
    }

    function unpause() external onlyOwner {
        _unpause();
    }
}
```

- [ ] **Step 4: Run to verify deposit tests pass**

Run: `pnpm test:evm`
Expected: PASS (4 deposit tests).

- [ ] **Step 5: Commit**

```bash
git add contracts/evm/CreditVault.sol test/evm/CreditVault.test.cjs
git commit -m "feat(evm): CreditVault deposit paths with profile attribution"
```

---

## Task 4: CreditVault — redeem path (bridge-gated, dedup, pausable)

**Files:**
- Modify: `contracts/evm/CreditVault.sol`
- Modify: `test/evm/CreditVault.test.cjs`

- [ ] **Step 1: Write the failing redeem tests**

Append to `test/evm/CreditVault.test.cjs`:
```js
describe("CreditVault redeem", () => {
  it("lets the bridge release ETH and dedups by redeemId", async () => {
    const { owner, bridge, user, vault } = await deploy();
    await vault.connect(user).depositEth(PROFILE, { value: ethers.parseEther("1") });

    await expect(
      vault.connect(bridge).redeem(user.address, ETH, ethers.parseEther("0.4"), 7n)
    )
      .to.emit(vault, "CreditRedeemed")
      .withArgs(user.address, ETH, ethers.parseEther("0.4"), 7n);

    // replay of same redeemId reverts
    await expect(
      vault.connect(bridge).redeem(user.address, ETH, ethers.parseEther("0.4"), 7n)
    ).to.be.revertedWithCustomError(vault, "RedeemAlreadyProcessed");
  });

  it("releases ERC20 to the user", async () => {
    const { bridge, user, vault, usdc } = await deploy();
    const addr = await usdc.getAddress();
    await usdc.connect(user).approve(await vault.getAddress(), 1_000_000n);
    await vault.connect(user).depositToken(addr, 1_000_000n, PROFILE);

    await vault.connect(bridge).redeem(user.address, addr, 600_000n, 1n);
    expect(await usdc.balanceOf(user.address)).to.equal(600_000n);
  });

  it("rejects redeem from non-bridge", async () => {
    const { user, vault } = await deploy();
    await vault.connect(user).depositEth(PROFILE, { value: ethers.parseEther("1") });
    await expect(
      vault.connect(user).redeem(user.address, ETH, 1n, 1n)
    ).to.be.revertedWithCustomError(vault, "NotBridge");
  });

  it("reverts redeem when paused", async () => {
    const { owner, bridge, user, vault } = await deploy();
    await vault.connect(user).depositEth(PROFILE, { value: ethers.parseEther("1") });
    await vault.connect(owner).pause();
    await expect(
      vault.connect(bridge).redeem(user.address, ETH, 1n, 1n)
    ).to.be.revertedWithCustomError(vault, "EnforcedPause");
  });

  it("reverts when releasing more than the vault holds", async () => {
    const { bridge, user, vault } = await deploy();
    await vault.connect(user).depositEth(PROFILE, { value: ethers.parseEther("0.1") });
    await expect(
      vault.connect(bridge).redeem(user.address, ETH, ethers.parseEther("1"), 1n)
    ).to.be.revertedWithCustomError(vault, "InsufficientVaultBalance");
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm test:evm`
Expected: FAIL — `redeem` is not a function.

- [ ] **Step 3: Implement redeem**

Add to `contracts/evm/CreditVault.sol` (inside the contract, after `depositToken`):
```solidity
    function redeem(address user, address token, uint256 amount, uint256 redeemId)
        external
        onlyBridge
        whenNotPaused
        nonReentrant
    {
        if (user == address(0)) revert ZeroAddress();
        if (amount == 0) revert ZeroAmount();
        if (processedRedeem[redeemId]) revert RedeemAlreadyProcessed();
        processedRedeem[redeemId] = true;

        if (token == ETH) {
            if (address(this).balance < amount) revert InsufficientVaultBalance();
            (bool ok, ) = payable(user).call{value: amount}("");
            if (!ok) revert EthTransferFailed();
        } else {
            if (IERC20(token).balanceOf(address(this)) < amount) revert InsufficientVaultBalance();
            IERC20(token).safeTransfer(user, amount);
        }
        emit CreditRedeemed(user, token, amount, redeemId);
    }
```

- [ ] **Step 4: Run to verify redeem tests pass**

Run: `pnpm test:evm`
Expected: PASS (all deposit + redeem tests).

- [ ] **Step 5: Commit**

```bash
git add contracts/evm/CreditVault.sol test/evm/CreditVault.test.cjs
git commit -m "feat(evm): CreditVault bridge-gated redeem with dedup and pause"
```

---

## Task 5: Reentrancy attack test (malicious token / receiver)

**Files:**
- Create: `test/evm/helpers/ReentrantToken.sol`
- Modify: `test/evm/CreditVault.test.cjs`

- [ ] **Step 1: Write a reentrant ERC20 that re-enters redeem on transfer**

`test/evm/helpers/ReentrantToken.sol`:
```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

interface IVaultRedeem {
    function redeem(address user, address token, uint256 amount, uint256 redeemId) external;
}

contract ReentrantToken is ERC20 {
    address public vault;
    bool private attacking;

    constructor() ERC20("Reentrant", "RE") {}

    function setVault(address v) external { vault = v; }
    function mint(address to, uint256 amount) external { _mint(to, amount); }

    function _update(address from, address to, uint256 value) internal override {
        super._update(from, to, value);
        if (vault != address(0) && from == vault && !attacking) {
            attacking = true;
            // attempt to re-enter with a different redeemId during the transfer-out
            IVaultRedeem(vault).redeem(to, address(this), value, 999_999);
            attacking = false;
        }
    }
}
```

- [ ] **Step 2: Write the failing-safely test**

Append to `test/evm/CreditVault.test.cjs`:
```js
describe("CreditVault reentrancy", () => {
  it("blocks reentrancy during ERC20 redeem", async () => {
    const [owner, bridge, user] = await ethers.getSigners();
    const Vault = await ethers.getContractFactory("CreditVault");
    const vault = await Vault.deploy(owner.address, bridge.address);
    const RT = await ethers.getContractFactory("ReentrantToken");
    const rt = await RT.deploy();
    await rt.setVault(await vault.getAddress());
    await rt.mint(user.address, 1000n);
    await vault.connect(owner).setTokenAllowed(await rt.getAddress(), true);
    await rt.connect(user).approve(await vault.getAddress(), 1000n);
    await vault.connect(user).depositToken(await rt.getAddress(), 1000n, PROFILE);

    await expect(
      vault.connect(bridge).redeem(user.address, await rt.getAddress(), 500n, 1n)
    ).to.be.revertedWithCustomError(vault, "ReentrancyGuardReentrantCall");
  });
});
```

- [ ] **Step 3: Run — expect PASS (guard already in place)**

Run: `pnpm test:evm`
Expected: PASS — `nonReentrant` on `redeem` causes the re-entrant call to revert with `ReentrancyGuardReentrantCall`.

- [ ] **Step 4: Commit**

```bash
git add test/evm/helpers/ReentrantToken.sol test/evm/CreditVault.test.cjs
git commit -m "test(evm): prove CreditVault redeem is reentrancy-safe"
```

---

## Task 6: Deploy script for Base Sepolia

**Files:**
- Create: `deploy/deploy-credit-vault.cjs`
- Modify: `package.json`
- Modify: `.env.example`

- [ ] **Step 1: Write the deploy script**

`deploy/deploy-credit-vault.cjs`:
```js
const hre = require("hardhat");

async function main() {
  const owner = process.env.CREDIT_VAULT_OWNER || (await hre.ethers.getSigners())[0].address;
  const bridge = process.env.CREDIT_VAULT_BRIDGE;
  if (!bridge) throw new Error("Set CREDIT_VAULT_BRIDGE (relayer authority address).");

  const Vault = await hre.ethers.getContractFactory("CreditVault");
  const vault = await Vault.deploy(owner, bridge);
  await vault.waitForDeployment();
  const address = await vault.getAddress();
  console.log("CreditVault deployed:", address);

  const usdc = process.env.CREDIT_VAULT_USDC;
  if (usdc) {
    const tx = await vault.setTokenAllowed(usdc, true);
    await tx.wait();
    console.log("Allowed USDC:", usdc);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
```

- [ ] **Step 2: Add the script + env keys**

In `package.json` `scripts`:
```json
    "deploy:vault": "hardhat run deploy/deploy-credit-vault.cjs --network baseSepolia --config hardhat.config.cjs",
```
Append to `.env.example`:
```
CREDIT_VAULT_OWNER=
CREDIT_VAULT_BRIDGE=
CREDIT_VAULT_USDC=
```

- [ ] **Step 3: Verify the script loads (no deploy)**

Run: `pnpm exec hardhat compile --config hardhat.config.cjs`
Expected: compiles clean. (Actual testnet deploy happens in Plan 1D integration.)

- [ ] **Step 4: Commit**

```bash
git add deploy/deploy-credit-vault.cjs package.json .env.example
git commit -m "feat(evm): add CreditVault Base Sepolia deploy script"
```

---

## Self-Review (1A)

- **Spec coverage:** `CreditVault.sol` with deposit/redeem ✓; ReentrancyGuard ✓ (Task 5 proves it); Pausable ✓; checked math (0.8.26) ✓; per-deposit nonce ✓; single rotatable bridge authority ✓; withdrawal ≤ vault balance ✓ (`InsufficientVaultBalance`). Profile attribution added so Plan 1D can map deposits → GenLayer profiles ✓.
- **Entitlement note:** per-user entitlement truth lives on GenLayer (Plan 1B `request_redeem` cannot exceed credit balance). The vault enforces only custody-level safety (balance cap + redeemId dedup) under the trusted-bridge model. L0 (sub-project #3) replaces the trusted bridge with verified messaging.
- **Type consistency:** event `CreditPurchased(user, token, profile, amount, nonce)` and `CreditRedeemed(user, token, amount, redeemId)` are referenced verbatim by Plan 1D. `bytes32 profile` is the GenLayer profile id encoding.
- **No placeholders:** all steps contain full code/commands.
