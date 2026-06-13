const { expect } = require("chai");
const { ethers } = require("hardhat");

const PROFILE = ethers.zeroPadValue("0xabc1230000000000000000000000000000000001", 32);
const HUB_CHAIN = 300; // zksync era eid placeholder for phase 1b
const GL_EID = 61999; // GenLayer studionet source chain id (envelope srcChainId)

const coder = ethers.AbiCoder.defaultAbiCoder();

// Outbound wire format from VerdictStone (GL): byte-matches gl.evm.encode / Solidity abi.encode.
function outMint(tokenId, profile, owner, level) {
  return coder.encode(
    ["uint8", "uint256", "bytes32", "address", "uint256"],
    [0, tokenId, profile, owner, level],
  );
}
function outRaise(tokenId, level) {
  return coder.encode(
    ["uint8", "uint256", "bytes32", "address", "uint256"],
    [1, tokenId, ethers.ZeroHash, ethers.ZeroAddress, level],
  );
}

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

describe("VerdictStoneHub processBridgeMessage (bridge dispatch)", () => {
  // Here `mockReceiver` stands in for the deployed VerdictStoneBridgeReceiver, and `glSource`
  // for the GenLayer VerdictStone IC address. The hub gates on both.
  async function deployWired() {
    const ctx = await deploy();
    const [, , , , mockReceiver, glSource] = await ethers.getSigners();
    await ctx.hub.connect(ctx.owner).setBridgeReceiver(mockReceiver.address);
    await ctx.hub.connect(ctx.owner).setGenlayerSource(glSource.address);
    return { ...ctx, mockReceiver, glSource };
  }

  it("owner sets bridgeReceiver and genlayerSource; non-owner cannot", async () => {
    const { hub, owner, alice, mockReceiver, glSource } = await deployWired();
    expect(await hub.bridgeReceiver()).to.equal(mockReceiver.address);
    expect(await hub.genlayerSource()).to.equal(glSource.address);
    await expect(hub.connect(alice).setBridgeReceiver(alice.address))
      .to.be.revertedWithCustomError(hub, "OwnableUnauthorizedAccount");
    await expect(hub.connect(alice).setGenlayerSource(alice.address))
      .to.be.revertedWithCustomError(hub, "OwnableUnauthorizedAccount");
  });

  it("dispatches a mint message to applyMint", async () => {
    const { hub, mockReceiver, glSource, alice } = await deployWired();
    const msg = outMint(1, PROFILE, alice.address, 3);
    await expect(hub.connect(mockReceiver).processBridgeMessage(GL_EID, glSource.address, msg))
      .to.emit(hub, "StoneMinted").withArgs(1, PROFILE, alice.address, 3);
    expect(await hub.ownerOf(1)).to.equal(alice.address);
    expect(await hub.levelOf(1)).to.equal(3);
  });

  it("dispatches a raise message to raiseLevel", async () => {
    const { hub, mockReceiver, glSource, alice } = await deployWired();
    await hub.connect(mockReceiver).processBridgeMessage(GL_EID, glSource.address, outMint(1, PROFILE, alice.address, 3));
    await expect(hub.connect(mockReceiver).processBridgeMessage(GL_EID, glSource.address, outRaise(1, 9)))
      .to.emit(hub, "StoneLeveled").withArgs(1, 9);
    expect(await hub.levelOf(1)).to.equal(9);
  });

  it("rejects a caller that is not the bridgeReceiver", async () => {
    const { hub, alice, glSource } = await deployWired();
    await expect(hub.connect(alice).processBridgeMessage(GL_EID, glSource.address, outMint(1, PROFILE, alice.address, 3)))
      .to.be.revertedWithCustomError(hub, "NotBridgeReceiver");
  });

  it("ignores a message from an unexpected GenLayer source (no state change)", async () => {
    const { hub, mockReceiver, alice, bob } = await deployWired();
    await expect(hub.connect(mockReceiver).processBridgeMessage(GL_EID, bob.address, outMint(1, PROFILE, alice.address, 3)))
      .to.emit(hub, "UnexpectedSource").withArgs(bob.address);
    expect(await hub.balanceOf(alice.address)).to.equal(0);
  });

  it("ignores an unknown message kind without reverting", async () => {
    const { hub, mockReceiver, glSource, alice } = await deployWired();
    const unknown = coder.encode(
      ["uint8", "uint256", "bytes32", "address", "uint256"],
      [7, 1, PROFILE, alice.address, 3],
    );
    await hub.connect(mockReceiver).processBridgeMessage(GL_EID, glSource.address, unknown);
    expect(await hub.balanceOf(alice.address)).to.equal(0);
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
