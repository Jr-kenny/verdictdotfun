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

describe("VerdictStoneHub applyMint", () => {
  it("mints a stone to the owner and records its state", async () => {
    const { hub, operator, alice } = await deploy();
    await expect(hub.connect(operator).applyMint(1, PROFILE, alice.address, 3))
      .to.emit(hub, "StoneMinted").withArgs(1, PROFILE, alice.address, 3);
    expect(await hub.ownerOf(1)).to.equal(alice.address);
    const s = await hub.getStone(1);
    expect(s.level).to.equal(3);
    expect(s.profile).to.equal(PROFILE);
    expect(s.location).to.equal(HUB_CHAIN);
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

describe("VerdictStoneHub owner-change signalling", () => {
  it("emits StoneOwnerChanged on transfer but not on mint", async () => {
    const { hub, operator, alice, bob } = await deploy();
    await expect(hub.connect(operator).applyMint(1, PROFILE, alice.address, 3))
      .to.not.emit(hub, "StoneOwnerChanged");
    await expect(hub.connect(alice).transferFrom(alice.address, bob.address, 1))
      .to.emit(hub, "StoneOwnerChanged").withArgs(1, bob.address);
    expect(await hub.ownerOf(1)).to.equal(bob.address);
  });
});

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
