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
