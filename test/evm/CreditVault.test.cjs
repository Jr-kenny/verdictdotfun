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

describe("CreditVault redeem", () => {
  it("lets the bridge release ETH and dedups by redeemId", async () => {
    const { bridge, user, vault } = await deploy();
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

describe("CreditVault reentrancy", () => {
  // A token that tries to re-enter redeem() on transfer-out. The re-entrant call
  // runs with msg.sender == token, so `onlyBridge` rejects it first; `nonReentrant`
  // backstops the bridge-initiated path. Either way the attack must fail atomically
  // and leave no partial drain.
  it("blocks reentrancy during ERC20 redeem (attack reverts, no drain)", async () => {
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

    // The re-entrant redeem inside transfer reverts, bubbling up to revert the whole call.
    await expect(
      vault.connect(bridge).redeem(user.address, await rt.getAddress(), 500n, 1n)
    ).to.be.reverted;

    // No partial drain: vault still custodies all 1000, redeemId 1 never marked processed.
    expect(await rt.balanceOf(await vault.getAddress())).to.equal(1000n);
    expect(await rt.balanceOf(user.address)).to.equal(0n);
    expect(await vault.processedRedeem(1n)).to.equal(false);
  });
});
