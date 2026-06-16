// Phase 1c IN-path smoke: prove a hub transfer round-trips into GenLayer.
//
//   1. (EVM) transfer a stone on the hub deployer -> throwaway recipient  (emits StoneOwnerChanged)
//   2. (relay) hub -> GL: receive_message(...) -> VerdictStone.process_bridge_message (rebind)
//   3. assert the GL BridgeReceiver marked the delivery processed (transport proven end-to-end)
//
// The rebind handler itself runs in an async follow-up GenLayer tx (emit() is asynchronous) and its
// effect is not exposed by a public view, so this asserts the bridge TRANSPORT; the rebind LOGIC is
// covered by the VerdictStone direct test suite. Requires token 1 minted (run smoke:stone first).
//
//   GENLAYER_DEPLOYER_PRIVATE_KEY / BASE_SEPOLIA_PRIVATE_KEY   required
//   STONE_VERDICT_STONE_IC   VerdictStone IC (default: deploy/deployments/stone-genlayer.json)
//   STONE_STONE_TOKEN_ID     stone to move (default 1)
import "dotenv/config";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createAccount, createClient } from "genlayer-js";
import { localnet, studionet, testnetAsimov, testnetBradbury } from "genlayer-js/chains";
import { AbiCoder, Contract, JsonRpcProvider, Wallet, keccak256 } from "ethers";
import { relayOnce } from "./stone-relay.mjs";

const chains = { localnet, studionet, testnetAsimov, testnetBradbury };
const chainKey = process.env.GENLAYER_CHAIN ?? "studionet";
const glPk = process.env.GENLAYER_DEPLOYER_PRIVATE_KEY;
const basePk = process.env.BASE_SEPOLIA_PRIVATE_KEY;
if (!glPk || !basePk) throw new Error("Set GENLAYER_DEPLOYER_PRIVATE_KEY and BASE_SEPOLIA_PRIVATE_KEY.");

const HUB_ADDRESS = process.env.STONE_HUB_ADDRESS || "0x6D612207Eea47Ccbd2Bab0D99bAaa54fFb189609";
const BRIDGE_RECEIVER_IC = process.env.STONE_BRIDGE_RECEIVER_IC || "0xce87655D60dCa6CA76183DEDc8582766e5DE4e57";
const baseRpcUrl = process.env.BASE_SEPOLIA_RPC_URL || "https://sepolia.base.org";
const tokenId = BigInt(process.env.STONE_STONE_TOKEN_ID || "1");

const gl = createClient({
  chain: chains[chainKey],
  endpoint: process.env.GENLAYER_ENDPOINT ?? chains[chainKey].rpcUrls.default.http[0],
  account: createAccount(glPk),
});

const HUB_ABI = [
  "function ownerOf(uint256 tokenId) view returns (address)",
  "function safeTransferFrom(address from, address to, uint256 tokenId) external",
  "event StoneOwnerChanged(uint256 indexed tokenId, address indexed newOwner)",
];

async function resolveStoneIc() {
  if (process.env.STONE_VERDICT_STONE_IC) return process.env.STONE_VERDICT_STONE_IC;
  const rec = JSON.parse(await readFile(resolve(process.cwd(), "deploy", "deployments", "stone-genlayer.json"), "utf-8"));
  return rec.address;
}

async function main() {
  const stoneIc = await resolveStoneIc();
  if (!process.env.STONE_VERDICT_STONE_IC) process.env.STONE_VERDICT_STONE_IC = stoneIc; // enable the relay IN path
  const provider = new JsonRpcProvider(baseRpcUrl);
  const wallet = new Wallet(basePk, provider);
  const hub = new Contract(HUB_ADDRESS, HUB_ABI, wallet);

  const owner = await hub.ownerOf(tokenId);
  if (owner.toLowerCase() !== wallet.address.toLowerCase()) {
    throw new Error(`token ${tokenId} is owned by ${owner}, not the signer ${wallet.address}.`);
  }
  const recipient = Wallet.createRandom().address; // throwaway EOA — only needs to be a non-zero address
  console.log(`[1/3] transfer token ${tokenId}: ${wallet.address} → ${recipient}`);
  const txr = await (await hub.safeTransferFrom(wallet.address, recipient, tokenId)).wait();
  // Find the RAW log (it carries .index, the block log index the relay keys on); parseLog only
  // confirms which one it is — its descriptor has no index.
  const rawLog = txr.logs.find((l) => {
    try { return hub.interface.parseLog(l)?.name === "StoneOwnerChanged"; } catch { return false; }
  });
  if (!rawLog) throw new Error("transfer did not emit StoneOwnerChanged.");
  const messageId = keccak256(
    AbiCoder.defaultAbiCoder().encode(["bytes32", "uint256"], [txr.hash, BigInt(rawLog.index)]),
  );

  console.log("[2/3] relay hub → GL…");
  let processed = false;
  for (let attempt = 1; attempt <= 12 && !processed; attempt += 1) {
    const log = [];
    await relayOnce(log);
    if (log.length) console.log("  " + log.join("\n  "));
    processed = await gl.readContract({ address: BRIDGE_RECEIVER_IC, functionName: "is_message_processed", args: [messageId] });
    if (!processed) await new Promise((r) => setTimeout(r, 6_000));
  }

  console.log(`[3/3] hub.ownerOf(${tokenId}) = ${await hub.ownerOf(tokenId)}`);
  if (!processed) throw new Error(`IN message ${messageId} was not marked processed on the GL BridgeReceiver.`);
  console.log(`\n✅ IN transport proven: hub transfer → GL BridgeReceiver delivered owner_changed (msg ${messageId}).`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
