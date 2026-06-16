// Phase 1c OUT-path smoke: prove a GenLayer mint lands on the EVM hub end-to-end.
//
//   1. (GL) operator pushes sync_level(profile, gate, owner=deployer) — binds + sets account level
//   2. (GL) deployer calls request_mint()         — mints a stone on GenLayer, emits to BridgeSender
//   3. (relay) deliver the outbox message         — deliverDirect -> hub.processBridgeMessage(applyMint)
//   4. (EVM) read the hub's StoneMinted event + getStone — assert profile/level match
//
// Reuses the live relay logic from stone-relay.mjs. The GenLayer emit() is asynchronous, so the
// outbox message appears a tick after request_mint; this polls the relay until the hub reflects it.
//
//   GENLAYER_DEPLOYER_PRIVATE_KEY / BASE_SEPOLIA_PRIVATE_KEY   required
//   STONE_VERDICT_STONE_IC   VerdictStone IC (default: deploy/deployments/stone-genlayer.json)
//   STONE_HUB_ADDRESS        VerdictStoneHub (default: live)
import "dotenv/config";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createAccount, createClient } from "genlayer-js";
import { localnet, studionet, testnetAsimov, testnetBradbury } from "genlayer-js/chains";
import { TransactionStatus } from "genlayer-js/types";
import { Contract, JsonRpcProvider, getAddress, zeroPadValue } from "ethers";
import { relayOnce } from "./stone-relay.mjs";

const chains = { localnet, studionet, testnetAsimov, testnetBradbury };
const chainKey = process.env.GENLAYER_CHAIN ?? "studionet";
const privateKey = process.env.GENLAYER_DEPLOYER_PRIVATE_KEY;
if (!privateKey) throw new Error("Set GENLAYER_DEPLOYER_PRIVATE_KEY.");

const HUB_ADDRESS = process.env.STONE_HUB_ADDRESS || "0x6D612207Eea47Ccbd2Bab0D99bAaa54fFb189609";
const baseRpcUrl = process.env.BASE_SEPOLIA_RPC_URL || "https://sepolia.base.org";

async function resolveStoneIc() {
  if (process.env.STONE_VERDICT_STONE_IC) return process.env.STONE_VERDICT_STONE_IC;
  try {
    const rec = JSON.parse(await readFile(resolve(process.cwd(), "deploy", "deployments", "stone-genlayer.json"), "utf-8"));
    return rec.address;
  } catch {
    throw new Error("Set STONE_VERDICT_STONE_IC or deploy first (pnpm deploy:stone).");
  }
}

const account = createAccount(privateKey);
const gl = createClient({
  chain: chains[chainKey],
  endpoint: process.env.GENLAYER_ENDPOINT ?? chains[chainKey].rpcUrls.default.http[0],
  account,
});

function hashOf(h) {
  return typeof h === "string" ? h : h?.as_hex || h?.hex || String(h);
}

async function glWrite(address, functionName, args) {
  const hash = await gl.writeContract({ address, functionName, args, value: 0n });
  await gl.waitForTransactionReceipt({ hash: hashOf(hash), status: TransactionStatus.ACCEPTED, retries: 40 });
  return hashOf(hash);
}

const HUB_ABI = [
  "event StoneMinted(uint256 indexed tokenId, bytes32 indexed profile, address indexed to, uint256 level)",
  "function getStone(uint256 tokenId) view returns (tuple(uint256 level, bytes32 profile, uint64 location))",
];

async function main() {
  const stoneIc = await resolveStoneIc();
  const profile = account.address; // use the deployer address as the test profile + owner
  const gate = await gl.readContract({ address: stoneIc, functionName: "get_mint_gate", args: [profile] });
  const level = Number(gate); // exactly clears the gate
  console.log(`VerdictStone ${stoneIc}  profile=${profile}  gate=${gate} -> level=${level}`);

  const provider = new JsonRpcProvider(baseRpcUrl);
  const hub = new Contract(HUB_ADDRESS, HUB_ABI, provider);
  const fromBlock = await provider.getBlockNumber();

  console.log("[1/4] sync_level (bind + set account level)…");
  await glWrite(stoneIc, "sync_level", [profile, level, profile]);

  console.log("[2/4] request_mint…");
  await glWrite(stoneIc, "request_mint", []);

  console.log("[3/4] relay GL → hub (polling for the async emit)…");
  let minted = null;
  for (let attempt = 1; attempt <= 12 && !minted; attempt += 1) {
    const log = [];
    await relayOnce(log);
    if (log.length) console.log("  " + log.join("\n  "));
    const events = await hub.queryFilter(hub.filters.StoneMinted(), fromBlock, "latest");
    minted = events.find((e) => e.args.profile.toLowerCase() === zeroPadValue(getAddress(profile), 32).toLowerCase());
    if (!minted) await new Promise((r) => setTimeout(r, 6_000));
  }
  if (!minted) throw new Error("Timed out: no StoneMinted for the test profile on the hub.");

  const tokenId = minted.args.tokenId;
  const stone = await hub.getStone(tokenId);
  console.log(`[4/4] hub StoneMinted token ${tokenId}: profile=${minted.args.profile} to=${minted.args.to} level=${stone.level}`);

  const expectProfile = zeroPadValue(getAddress(profile), 32).toLowerCase();
  if (stone.profile.toLowerCase() !== expectProfile) throw new Error(`profile mismatch: ${stone.profile} != ${expectProfile}`);
  if (Number(stone.level) !== level) throw new Error(`level mismatch: ${stone.level} != ${level}`);

  console.log(`\n✅ OUT loop proven: GenLayer mint → hub applyMint (token ${tokenId}, level ${stone.level}).`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
