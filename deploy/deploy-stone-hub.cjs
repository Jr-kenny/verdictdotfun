const hre = require("hardhat");

// Deploys the Phase 1c stone hub stack to an EVM chain (Base Sepolia today; ZKsync Era once the
// zksolc toolchain is added) and wires it to the REUSED GenLayer bridge:
//   VerdictStoneBridgeReceiver  — dispatch-on-receive (relayer deliverDirect → hub.processBridgeMessage)
//   VerdictStoneHub             — authoritative stone registry
//
// Env (all optional except where noted):
//   STONE_HUB_NAME / STONE_HUB_SYMBOL   ERC-721 name/symbol (default "Verdict Stone" / "STONE")
//   STONE_HUB_OPERATOR                  admin/escape-hatch operator (default: deployer)
//   STONE_HUB_CHAIN_ID                  location chain id stored on stones (default: this network's chainId)
//   STONE_BRIDGE_ENDPOINT               LayerZero endpoint for the receiver's lzReceive path (default: zero = direct-only)
//   STONE_RELAYER                       relay wallet to authorize for deliverDirect (skipped if unset)
//   STONE_GL_SOURCE                     GenLayer VerdictStone IC address to gate inbound on (skipped if unset; set after GL deploy)
async function main() {
  const [deployer] = await hre.ethers.getSigners();
  const name = process.env.STONE_HUB_NAME || "Verdict Stone";
  const symbol = process.env.STONE_HUB_SYMBOL || "STONE";
  const operator = process.env.STONE_HUB_OPERATOR || deployer.address;
  const hubChainId = Number(process.env.STONE_HUB_CHAIN_ID || hre.network.config.chainId || 0);
  const endpoint = process.env.STONE_BRIDGE_ENDPOINT || hre.ethers.ZeroAddress;

  console.log(`Deployer: ${deployer.address}  network: ${hre.network.name} (chainId ${hubChainId})`);

  const Receiver = await hre.ethers.getContractFactory("VerdictStoneBridgeReceiver");
  const receiver = await Receiver.deploy(endpoint, deployer.address);
  await receiver.waitForDeployment();
  const receiverAddr = await receiver.getAddress();
  console.log("VerdictStoneBridgeReceiver:", receiverAddr);

  const Hub = await hre.ethers.getContractFactory("VerdictStoneHub");
  const hub = await Hub.deploy(name, symbol, operator, hubChainId);
  await hub.waitForDeployment();
  const hubAddr = await hub.getAddress();
  console.log("VerdictStoneHub:", hubAddr);

  // Wire the hub to its receiver.
  await (await hub.setBridgeReceiver(receiverAddr)).wait();
  console.log("hub.setBridgeReceiver ->", receiverAddr);

  const glSource = process.env.STONE_GL_SOURCE;
  if (glSource) {
    await (await hub.setGenlayerSource(glSource)).wait();
    console.log("hub.setGenlayerSource ->", glSource);
  } else {
    console.log("hub.setGenlayerSource SKIPPED — set STONE_GL_SOURCE after the GenLayer VerdictStone deploy.");
  }

  const relayer = process.env.STONE_RELAYER;
  if (relayer) {
    await (await receiver.setAuthorizedRelayer(relayer, true)).wait();
    console.log("receiver.setAuthorizedRelayer ->", relayer);
  } else {
    console.log("receiver.setAuthorizedRelayer SKIPPED — set STONE_RELAYER (the relay wallet) to authorize delivery.");
  }

  console.log("\nDone. Next: deploy VerdictStone on GenLayer with");
  console.log(`  hub_contract = ${hubAddr}`);
  console.log("  bridge_sender / bridge_receiver = the existing Tokenpost GL bridge ICs");
  console.log(`then set STONE_GL_SOURCE=${"<VerdictStone IC>"} and re-run wiring, and add a stone branch to the relay.`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
