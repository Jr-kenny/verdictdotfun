// Deploy the GenLayer VerdictStone IC (Phase 1c) and wire it to the reused GenLayer bridge.
//
// VerdictStone owns eligibility / profile binding / the mint gate; the EVM VerdictStoneHub is the
// authoritative registry. They talk over Tokenpost's already-deployed GL BridgeSender / BridgeReceiver
// ICs (shared, target-filtered — safe to reuse). This deploys to the same GenLayer network the bridge
// ICs live on (studionet by default) so the cross-contract emit to the BridgeSender resolves.
//
// After this, finish the EVM side with: STONE_GL_SOURCE=<printed IC> pnpm wire:stone:hub
//
//   GENLAYER_DEPLOYER_PRIVATE_KEY   required
//   GENLAYER_CHAIN                  default "studionet"
//   STONE_BRIDGE_SENDER_IC          GL BridgeSender IC   (default: Tokenpost's)
//   STONE_BRIDGE_RECEIVER_IC        GL BridgeReceiver IC (default: Tokenpost's)
//   STONE_HUB_ADDRESS               VerdictStoneHub (EVM) — outbound target + inbound source gate
//   STONE_HUB_EID                   LZ EID of the hub chain (default 40245, Base Sepolia; not load-bearing
//                                   for the direct-deliver path, kept for wire-format correctness)
import "dotenv/config";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { createAccount, createClient } from "genlayer-js";
import { localnet, studionet, testnetAsimov, testnetBradbury } from "genlayer-js/chains";
import { TransactionStatus } from "genlayer-js/types";

const chains = { localnet, studionet, testnetAsimov, testnetBradbury };
const chainKey = process.env.GENLAYER_CHAIN ?? "studionet";
if (!(chainKey in chains)) throw new Error(`Unsupported GENLAYER_CHAIN "${chainKey}".`);

const privateKey = process.env.GENLAYER_DEPLOYER_PRIVATE_KEY;
if (!privateKey) throw new Error("Set GENLAYER_DEPLOYER_PRIVATE_KEY before deploying.");

const ZERO = "0x0000000000000000000000000000000000000000";
const BRIDGE_SENDER_IC = process.env.STONE_BRIDGE_SENDER_IC || "0xcfBD25E80e075e7F34E79C7DaCbA2EAbD6Aca22f";
const BRIDGE_RECEIVER_IC = process.env.STONE_BRIDGE_RECEIVER_IC || "0xce87655D60dCa6CA76183DEDc8582766e5DE4e57";
const HUB_ADDRESS = (process.env.STONE_HUB_ADDRESS || "0x6D612207Eea47Ccbd2Bab0D99bAaa54fFb189609").toLowerCase();
const HUB_EID = Number(process.env.STONE_HUB_EID || "40245");

const contractPath = resolve(process.cwd(), "contracts", "verdict_stone.py");
const deploymentPath = resolve(process.cwd(), "deploy", "deployments", "stone-genlayer.json");

const client = createClient({
  chain: chains[chainKey],
  endpoint: process.env.GENLAYER_ENDPOINT ?? chains[chainKey].rpcUrls.default.http[0],
  account: createAccount(privateKey),
});

function normalizeHash(hash) {
  if (typeof hash === "string" && hash.trim()) return hash.trim();
  if (hash && typeof hash === "object") return hash.as_hex?.trim() || hash.hex?.trim() || "";
  return "";
}

function normalizeAddress(value) {
  if (!value) return "";
  if (typeof value === "string") return value;
  if (typeof value === "object") return value.as_hex || value.hex || String(value);
  return String(value);
}

const FAILED = new Set(["UNDETERMINED", "CANCELED", "LEADER_TIMEOUT", "VALIDATORS_TIMEOUT"]);

async function waitForReceipt(hash, timeoutMs = 25 * 60_000) {
  const normalized = normalizeHash(hash);
  if (!normalized) throw new Error("Transaction did not return a valid hash.");
  const startedAt = Date.now();
  let lastError;
  while (Date.now() - startedAt < timeoutMs) {
    try {
      const tx = await client.getTransaction({ hash: normalized });
      const name = String(tx?.statusName ?? tx?.status ?? "").toUpperCase();
      if (name === "ACCEPTED" || name === "FINALIZED" || tx?.status === 5 || tx?.status === 7) return tx;
      if (FAILED.has(name)) throw new Error(`Transaction ${normalized} ended in ${name}.`);
    } catch (error) {
      lastError = error;
      const msg = error instanceof Error ? error.message.toLowerCase() : "";
      if (!/fetch failed|timeout|network|unknown rpc error/.test(msg)) throw error;
    }
    await new Promise((r) => setTimeout(r, 5_000));
  }
  throw lastError ?? new Error(`Timed out waiting for ${normalized}.`);
}

async function deploy() {
  const code = await readFile(contractPath, "utf-8");
  // operator = ZERO -> the constructor falls back to the deployer, so the deployer can push
  // sync_level during smoke. bridge wiring is set directly in the constructor.
  const args = [ZERO, BRIDGE_SENDER_IC, BRIDGE_RECEIVER_IC, HUB_ADDRESS, HUB_EID];
  let lastError;
  for (let attempt = 1; attempt <= 4; attempt += 1) {
    try {
      const hash = await client.deployContract({ code, args, leaderOnly: false });
      const receipt = await waitForReceipt(hash);
      const address = normalizeAddress(receipt?.data?.contract_address ?? receipt?.txDataDecoded?.contractAddress);
      if (!address) throw new Error("Deployment returned no contract address.");
      return address;
    } catch (error) {
      lastError = error;
      console.warn(`[deploy-stone] attempt ${attempt} failed: ${error?.message ?? error}`);
      if (attempt === 4) break;
      await new Promise((r) => setTimeout(r, 15_000));
    }
  }
  throw lastError;
}

const address = await deploy();
const record = {
  network: chainKey,
  deployedAt: new Date().toISOString().slice(0, 10),
  deployer: createAccount(privateKey).address,
  contract: "VerdictStone",
  address,
  config: {
    bridge_sender: BRIDGE_SENDER_IC,
    bridge_receiver: BRIDGE_RECEIVER_IC,
    hub_contract: HUB_ADDRESS,
    hub_eid: HUB_EID,
  },
  note: "Reuses Tokenpost's deployed GL BridgeSender/BridgeReceiver ICs. operator defaulted to the deployer.",
};
await mkdir(dirname(deploymentPath), { recursive: true });
await writeFile(deploymentPath, `${JSON.stringify(record, null, 2)}\n`, "utf-8");

console.log(JSON.stringify(record, null, 2));
console.log("\nNext:");
console.log(`  STONE_GL_SOURCE=${address} pnpm wire:stone:hub`);
console.log(`  STONE_VERDICT_STONE_IC=${address} STONE_RELAY_ONCE=1 pnpm relay:stone`);
