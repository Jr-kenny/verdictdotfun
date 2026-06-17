const { expect } = require("chai");
const { ethers } = require("hardhat");

const PROFILE = ethers.zeroPadValue("0xabc1230000000000000000000000000000000001", 32);
const HUB_CHAIN = 84532;
const FEE_BPS = 250n; // 2.5%

async function deploy() {
  const [owner, seller, buyer, treasury] = await ethers.getSigners();
  const Hub = await ethers.getContractFactory("VerdictStoneHub");
  const hub = await Hub.deploy("Verdict Stone", "STONE", owner.address, HUB_CHAIN); // owner == operator
  await hub.waitForDeployment();

  const Market = await ethers.getContractFactory("StoneMarket");
  const market = await Market.deploy(await hub.getAddress(), owner.address, treasury.address, Number(FEE_BPS));
  await market.waitForDeployment();

  await hub.applyMint(1, PROFILE, seller.address, 3); // mint stone #1 to the seller
  return { owner, seller, buyer, treasury, hub, market };
}

describe("StoneMarket", () => {
  it("lists, sells, transfers the stone, and pays seller minus fee", async () => {
    const { seller, buyer, treasury, hub, market } = await deploy();
    const price = ethers.parseEther("0.1");
    await hub.connect(seller).approve(await market.getAddress(), 1);
    await market.connect(seller).list(1, price);

    const [s, p, active] = await market.getListing(1);
    expect(s).to.equal(seller.address);
    expect(p).to.equal(price);
    expect(active).to.equal(true);
    expect(await market.isListingLive(1)).to.equal(true);

    const sellerBefore = await ethers.provider.getBalance(seller.address);
    const treasuryBefore = await ethers.provider.getBalance(treasury.address);

    await expect(market.connect(buyer).buy(1, { value: price }))
      .to.emit(market, "Sale")
      .withArgs(1, seller.address, buyer.address, price, (price * FEE_BPS) / 10_000n);

    expect(await hub.ownerOf(1)).to.equal(buyer.address);
    const fee = (price * FEE_BPS) / 10_000n;
    expect(await ethers.provider.getBalance(treasury.address)).to.equal(treasuryBefore + fee);
    expect(await ethers.provider.getBalance(seller.address)).to.equal(sellerBefore + price - fee);
    expect((await market.getListing(1))[2]).to.equal(false);
  });

  it("reverts a buy with the wrong value", async () => {
    const { seller, buyer, hub, market } = await deploy();
    const price = ethers.parseEther("0.1");
    await hub.connect(seller).approve(await market.getAddress(), 1);
    await market.connect(seller).list(1, price);
    await expect(market.connect(buyer).buy(1, { value: price - 1n })).to.be.revertedWithCustomError(market, "WrongValue");
  });

  it("reverts listing without approval or ownership", async () => {
    const { seller, buyer, hub, market } = await deploy();
    await expect(market.connect(seller).list(1, ethers.parseEther("0.1"))).to.be.revertedWithCustomError(market, "NotApproved");
    await hub.connect(seller).setApprovalForAll(await market.getAddress(), true);
    await expect(market.connect(buyer).list(1, ethers.parseEther("0.1"))).to.be.revertedWithCustomError(market, "NotOwner");
  });

  it("lets the seller cancel and update price", async () => {
    const { seller, hub, market } = await deploy();
    await hub.connect(seller).approve(await market.getAddress(), 1);
    await market.connect(seller).list(1, ethers.parseEther("0.1"));
    await market.connect(seller).updatePrice(1, ethers.parseEther("0.2"));
    expect((await market.getListing(1))[1]).to.equal(ethers.parseEther("0.2"));
    await market.connect(seller).cancel(1);
    expect((await market.getListing(1))[2]).to.equal(false);
  });

  it("treats a listing whose stone moved away as stale", async () => {
    const { seller, buyer, hub, market } = await deploy();
    const price = ethers.parseEther("0.1");
    await hub.connect(seller).approve(await market.getAddress(), 1);
    await market.connect(seller).list(1, price);
    await hub.connect(seller).transferFrom(seller.address, buyer.address, 1); // seller moves it
    expect(await market.isListingLive(1)).to.equal(false);
    await expect(market.connect(buyer).buy(1, { value: price })).to.be.revertedWithCustomError(market, "StaleListing");
  });

  it("rejects a fee above the ceiling", async () => {
    const { hub, owner, treasury } = await deploy();
    const Market = await ethers.getContractFactory("StoneMarket");
    await expect(Market.deploy(await hub.getAddress(), owner.address, treasury.address, 1001)).to.be.revertedWithCustomError(
      Market,
      "FeeTooHigh",
    );
  });
});
