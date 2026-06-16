const hre = require("hardhat");
const fs = require("node:fs");
const path = require("node:path");

// Wires the ALREADY-DEPLOYED Phase 1c stone hub stack to GenLayer (no redeploy):
//   hub.setGenlayerSource(<VerdictStone IC>)        — gate inbound bridge messages to our GL source
//   receiver.setAuthorizedRelayer(<relay wallet>)   — let the relay deliverDirect
//
// Reads the live addresses from deploy/deployments/stone-base-sepolia.json (override via env).
//
//   STONE_GL_SOURCE     GenLayer VerdictStone IC address (required to set genlayerSource)
//   STONE_RELAYER       EVM relay wallet (default: the deployer — the same wallet the relay uses)
//   STONE_HUB_ADDRESS   override hub address
//   STONE_HUB_RECEIVER  override receiver address
async function main() {
  const [signer] = await hre.ethers.getSigners();
  const recordPath = path.resolve(__dirname, "deployments", "stone-base-sepolia.json");
  const record = JSON.parse(fs.readFileSync(recordPath, "utf-8"));

  const hubAddr = process.env.STONE_HUB_ADDRESS || record.contracts.VerdictStoneHub.address;
  const receiverAddr = process.env.STONE_HUB_RECEIVER || record.contracts.VerdictStoneBridgeReceiver.address;
  const glSource = process.env.STONE_GL_SOURCE;
  const relayer = process.env.STONE_RELAYER || signer.address;

  console.log(`Signer: ${signer.address}  network: ${hre.network.name}`);
  console.log(`Hub: ${hubAddr}  Receiver: ${receiverAddr}`);

  const hub = await hre.ethers.getContractAt("VerdictStoneHub", hubAddr, signer);
  const receiver = await hre.ethers.getContractAt("VerdictStoneBridgeReceiver", receiverAddr, signer);

  // genlayerSource — only if provided and not already set to it.
  if (glSource) {
    const current = await hub.genlayerSource();
    if (current.toLowerCase() === glSource.toLowerCase()) {
      console.log(`hub.genlayerSource already ${glSource}`);
    } else {
      await (await hub.setGenlayerSource(glSource)).wait();
      console.log(`hub.setGenlayerSource -> ${glSource}`);
    }
  } else {
    console.log("hub.setGenlayerSource SKIPPED — set STONE_GL_SOURCE=<VerdictStone IC>.");
  }

  // bridgeReceiver — ensure it points at our receiver (idempotent).
  const wiredReceiver = await hub.bridgeReceiver();
  if (wiredReceiver.toLowerCase() !== receiverAddr.toLowerCase()) {
    await (await hub.setBridgeReceiver(receiverAddr)).wait();
    console.log(`hub.setBridgeReceiver -> ${receiverAddr}`);
  } else {
    console.log(`hub.bridgeReceiver already ${receiverAddr}`);
  }

  // authorizedRelayer — idempotent.
  if (await receiver.authorizedRelayers(relayer)) {
    console.log(`receiver.authorizedRelayers[${relayer}] already true`);
  } else {
    await (await receiver.setAuthorizedRelayer(relayer, true)).wait();
    console.log(`receiver.setAuthorizedRelayer -> ${relayer}`);
  }

  // Persist the wiring back to the deployment record.
  record.contracts.VerdictStoneHub.wired = {
    bridgeReceiver: receiverAddr,
    genlayerSource: glSource || (await hub.genlayerSource()),
  };
  record.contracts.VerdictStoneBridgeReceiver.authorizedRelayer = relayer;
  fs.writeFileSync(recordPath, `${JSON.stringify(record, null, 2)}\n`);
  console.log(`\nUpdated ${path.relative(process.cwd(), recordPath)}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
