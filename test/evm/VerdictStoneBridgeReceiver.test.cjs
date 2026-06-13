const { expect } = require("chai");
const { ethers } = require("hardhat");

// Dispatch-on-receive receiver: authorized relayer delivers an envelope, the receiver decodes it
// and calls target.processBridgeMessage(srcChainId, srcSender, message). Proven end-to-end against
// the real VerdictStoneHub so the GL outbound wire format flows through both contracts.

const PROFILE = ethers.zeroPadValue("0xabc1230000000000000000000000000000000001", 32);
const HUB_CHAIN = 300;
const GL_EID = 61999;

const coder = ethers.AbiCoder.defaultAbiCoder();

function outMint(tokenId, profile, owner, level) {
  return coder.encode(
    ["uint8", "uint256", "bytes32", "address", "uint256"],
    [0, tokenId, profile, owner, level],
  );
}

function envelope(srcChainId, srcSender, target, message) {
  return coder.encode(["uint32", "address", "address", "bytes"], [srcChainId, srcSender, target, message]);
}

async function deploy() {
  const [owner, relayer, glSource, alice, stranger] = await ethers.getSigners();

  const Receiver = await ethers.getContractFactory("VerdictStoneBridgeReceiver");
  // endpoint = zero (direct path only on this deployment), owner = owner
  const receiver = await Receiver.deploy(ethers.ZeroAddress, owner.address);
  await receiver.waitForDeployment();

  const Hub = await ethers.getContractFactory("VerdictStoneHub");
  const hub = await Hub.deploy("Verdict Stone", "STONE", owner.address, HUB_CHAIN);
  await hub.waitForDeployment();

  await hub.connect(owner).setBridgeReceiver(await receiver.getAddress());
  await hub.connect(owner).setGenlayerSource(glSource.address);
  await receiver.connect(owner).setAuthorizedRelayer(relayer.address, true);

  return { owner, relayer, glSource, alice, stranger, receiver, hub };
}

describe("VerdictStoneBridgeReceiver admin", () => {
  it("owner authorizes relayers; non-owner cannot", async () => {
    const { receiver, owner, relayer, stranger } = await deploy();
    expect(await receiver.authorizedRelayers(relayer.address)).to.equal(true);
    await expect(receiver.connect(stranger).setAuthorizedRelayer(stranger.address, true))
      .to.be.revertedWithCustomError(receiver, "OwnableUnauthorizedAccount");
  });
});

describe("VerdictStoneBridgeReceiver deliverDirect", () => {
  it("dispatches a mint envelope through to the hub", async () => {
    const { receiver, hub, relayer, glSource, alice } = await deploy();
    const env = envelope(GL_EID, glSource.address, await hub.getAddress(), outMint(1, PROFILE, alice.address, 3));
    await expect(receiver.connect(relayer).deliverDirect(ethers.id("delivery-1"), env))
      .to.emit(hub, "StoneMinted").withArgs(1, PROFILE, alice.address, 3);
    expect(await hub.ownerOf(1)).to.equal(alice.address);
  });

  it("rejects an unauthorized relayer", async () => {
    const { receiver, hub, stranger, glSource, alice } = await deploy();
    const env = envelope(GL_EID, glSource.address, await hub.getAddress(), outMint(1, PROFILE, alice.address, 3));
    await expect(receiver.connect(stranger).deliverDirect(ethers.id("delivery-1"), env))
      .to.be.revertedWithCustomError(receiver, "NotAuthorizedRelayer");
  });

  it("dedups a replayed deliveryId", async () => {
    const { receiver, hub, relayer, glSource, alice } = await deploy();
    const env = envelope(GL_EID, glSource.address, await hub.getAddress(), outMint(1, PROFILE, alice.address, 3));
    const id = ethers.id("delivery-1");
    await receiver.connect(relayer).deliverDirect(id, env);
    expect(await receiver.isDelivered(id)).to.equal(true);
    await expect(receiver.connect(relayer).deliverDirect(id, env))
      .to.be.revertedWithCustomError(receiver, "AlreadyDelivered");
  });

  it("rejects a zero target", async () => {
    const { receiver, relayer, glSource, alice } = await deploy();
    const env = envelope(GL_EID, glSource.address, ethers.ZeroAddress, outMint(1, PROFILE, alice.address, 3));
    await expect(receiver.connect(relayer).deliverDirect(ethers.id("delivery-1"), env))
      .to.be.revertedWithCustomError(receiver, "ZeroTarget");
  });
});
