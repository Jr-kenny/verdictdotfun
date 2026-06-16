// Verdict Stone bridge relay (Phase 1c).
//
// Connects the GenLayer VerdictStone IC to the EVM VerdictStoneHub over the SAME GenLayer bridge
// boilerplate that the live Tokenpost product already runs (shared GL BridgeSender / BridgeReceiver
// ICs). It is a standalone relay on purpose — it does not touch Tokenpost's Supabase relay — so the
// stone loop is self-contained and reviewable in this repo. Reuse is safe because every read is
// target-filtered: this relay only ever delivers messages addressed to the stone hub / VerdictStone,
// and dedup is on-chain per receiver, so it is inert to Tokenpost's claim loop and vice versa.
//
// Two directions, both transport-agnostic authorized-relayer paths (no LayerZero leg — the LZ
// testnet reverse leg stalls, GENLAYER-FEEDBACK #8):
//
//   GL -> hub (OUT):  poll the GL BridgeSender outbox, keep only messages whose target_contract is
//                     the stone hub, and deliverDirect(deliveryId, envelope) to the EVM
//                     VerdictStoneBridgeReceiver, which dispatches to hub.processBridgeMessage.
//                     Carries mint / raise. Dedup: receiver.isDelivered(deliveryId).
//
//   hub -> GL (IN):   watch the hub's StoneOwnerChanged events, build the inbound abi payload, and
//                     call the GL BridgeReceiver IC's receive_message(...), which dispatches to
//                     VerdictStone.process_bridge_message. Carries owner_changed (marketplace
//                     rebind). Dedup: BridgeReceiver.is_message_processed(messageId).
//
// Run once (a single pass, for smoke / cron) or as a poll loop:
//   STONE_RELAY_ONCE=1 node ./deploy/stone-relay.mjs      # single pass
//   node ./deploy/stone-relay.mjs                          # poll loop
//
// Required env (addresses default to the live Phase 1c deployment):
//   GENLAYER_DEPLOYER_PRIVATE_KEY   GL relay account (also the GL deployer)
//   BASE_SEPOLIA_PRIVATE_KEY        EVM relay wallet (authorized on the stone receiver via wire:stone:hub)
//   GENLAYER_CHAIN                  default "studionet" (same network as the shared bridge ICs)
//   STONE_BRIDGE_SENDER_IC          GL BridgeSender IC          (default: Tokenpost's)
//   STONE_BRIDGE_RECEIVER_IC        GL BridgeReceiver IC        (default: Tokenpost's)
//   STONE_HUB_ADDRESS               VerdictStoneHub (EVM)
//   STONE_HUB_RECEIVER              VerdictStoneBridgeReceiver (EVM)
//   STONE_VERDICT_STONE_IC          GenLayer VerdictStone IC    (the inbound dispatch target)
//   STONE_HUB_CHAIN_ID              EVM hub chain id used as source_chain_id on the IN path (default 84532)
//   STONE_RELAY_FROM_BLOCK          first block to scan for StoneOwnerChanged (default: persisted/“latest-2000”)
import "dotenv/config";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { createAccount, createClient } from "genlayer-js";
import { localnet, studionet, testnetAsimov, testnetBradbury } from "genlayer-js/chains";
import {
  AbiCoder,
  Contract,
  JsonRpcProvider,
  Wallet,
  ZeroHash,
  getBytes,
  hexlify,
  keccak256,
} from "ethers";

// ---- config -----------------------------------------------------------------

const chains = { localnet, studionet, testnetAsimov, testnetBradbury };
const chainKey = process.env.GENLAYER_CHAIN ?? "studionet";
if (!(chainKey in chains)) throw new Error(`Unsupported GENLAYER_CHAIN "${chainKey}".`);

const glPrivateKey = process.env.GENLAYER_DEPLOYER_PRIVATE_KEY;
const basePrivateKey = process.env.BASE_SEPOLIA_PRIVATE_KEY;
const baseRpcUrl = process.env.BASE_SEPOLIA_RPC_URL || "https://sepolia.base.org";

// Live Phase 1c addresses (overridable). The GL bridge ICs are Tokenpost's deployed, shared ICs.
const BRIDGE_SENDER_IC = process.env.STONE_BRIDGE_SENDER_IC || "0xcfBD25E80e075e7F34E79C7DaCbA2EAbD6Aca22f";
const BRIDGE_RECEIVER_IC = process.env.STONE_BRIDGE_RECEIVER_IC || "0xce87655D60dCa6CA76183DEDc8582766e5DE4e57";
const HUB_ADDRESS = process.env.STONE_HUB_ADDRESS || "0x6D612207Eea47Ccbd2Bab0D99bAaa54fFb189609";
const HUB_RECEIVER = process.env.STONE_HUB_RECEIVER || "0x4Caad3aA8Fe34616479fFB9E8810367eED64c55c";
const VERDICT_STONE_IC = process.env.STONE_VERDICT_STONE_IC || "";
const HUB_CHAIN_ID = Number(process.env.STONE_HUB_CHAIN_ID || "84532");

const runOnce = process.env.STONE_RELAY_ONCE === "1";
const pollIntervalMs = Number(process.env.STONE_RELAY_POLL_INTERVAL_MS ?? "15000");
const stateFilePath = resolve(process.cwd(), process.env.STONE_RELAY_STATE_FILE ?? "artifacts/stone-relay-state.json");

// Inbound wire format — must byte-match VerdictStone._IN_T = (u8, u256, address, bytes32, u256).
const IN_TYPES = ["uint8", "uint256", "address", "bytes32", "uint256"];
const IN_OWNER_CHANGED = 0;

const RECEIVER_ABI = [
  "function deliverDirect(bytes32 deliveryId, bytes data) external",
  "function isDelivered(bytes32 deliveryId) external view returns (bool)",
];
const HUB_ABI = [
  "event StoneOwnerChanged(uint256 indexed tokenId, address indexed newOwner)",
];

if (!glPrivateKey) throw new Error("Set GENLAYER_DEPLOYER_PRIVATE_KEY (the GL relay account).");

// ---- clients ----------------------------------------------------------------

const glAccount = createAccount(glPrivateKey);
const gl = createClient({
  chain: chains[chainKey],
  endpoint: process.env.GENLAYER_ENDPOINT ?? chains[chainKey].rpcUrls.default.http[0],
  account: glAccount,
});

const baseProvider = new JsonRpcProvider(baseRpcUrl);
const baseWallet = basePrivateKey ? new Wallet(basePrivateKey, baseProvider) : null;
const hubReader = new Contract(HUB_ADDRESS, HUB_ABI, baseProvider);
const stoneReceiver = baseWallet ? new Contract(HUB_RECEIVER, RECEIVER_ABI, baseWallet) : null;

// genlayer-js returns a struct as a Map (older) or a plain object (newer) — read both.
function mget(m, key) {
  if (m && typeof m.get === "function") return m.get(key);
  return m?.[key];
}

function toHexBytes(data) {
  if (data instanceof Uint8Array) return hexlify(data);
  if (typeof data === "string") return data.startsWith("0x") ? data : `0x${data}`;
  return hexlify(getBytes(data));
}

async function readState() {
  try {
    return JSON.parse(await readFile(stateFilePath, "utf-8"));
  } catch {
    return { fromBlock: null };
  }
}

async function writeStateFile(state) {
  await mkdir(dirname(stateFilePath), { recursive: true });
  await writeFile(stateFilePath, `${JSON.stringify(state, null, 2)}\n`, "utf-8");
}

// ---- GL -> hub (mint / raise) ------------------------------------------------

async function syncGenLayerToHub(log) {
  if (!stoneReceiver) {
    log.push("[GL→hub] disabled (no BASE_SEPOLIA_PRIVATE_KEY)");
    return;
  }
  const hubTarget = HUB_ADDRESS.toLowerCase();
  let hashes;
  try {
    hashes = await gl.readContract({ address: BRIDGE_SENDER_IC, functionName: "get_message_hashes", args: [] });
  } catch (e) {
    log.push(`[GL→hub] read outbox failed: ${e.message}`);
    return;
  }
  if (!Array.isArray(hashes)) return;
  log.push(`[GL→hub] ${hashes.length} outbox message(s)`);

  for (const hash of hashes) {
    const deliveryId = hash.startsWith("0x") ? hash : `0x${hash}`;
    try {
      const msg = await gl.readContract({ address: BRIDGE_SENDER_IC, functionName: "get_message", args: [hash] });
      const target = String(mget(msg, "target_contract") || "").toLowerCase();
      if (target !== hubTarget) continue; // not a stone message — leave it for its own relay
      if (await stoneReceiver.isDelivered(deliveryId)) continue;

      const data = toHexBytes(mget(msg, "data"));
      const tx = await stoneReceiver.deliverDirect(deliveryId, data);
      log.push(`[GL→hub] deliverDirect ${deliveryId} → hub tx ${tx.hash}`);
      await tx.wait();
    } catch (e) {
      log.push(`[GL→hub] error ${deliveryId}: ${e.message}`);
    }
  }
}

// ---- hub -> GL (owner_changed rebind) ---------------------------------------

async function syncHubToGenLayer(log, state) {
  if (!VERDICT_STONE_IC) {
    log.push("[hub→GL] disabled (set STONE_VERDICT_STONE_IC after the GenLayer deploy)");
    return;
  }
  const latest = await baseProvider.getBlockNumber();
  const fromBlock = state.fromBlock ?? Number(process.env.STONE_RELAY_FROM_BLOCK || Math.max(0, latest - 2000));
  if (fromBlock > latest) return;

  let logs;
  try {
    logs = await hubReader.queryFilter(hubReader.filters.StoneOwnerChanged(), fromBlock, latest);
  } catch (e) {
    log.push(`[hub→GL] queryFilter failed: ${e.message}`);
    return;
  }
  log.push(`[hub→GL] ${logs.length} StoneOwnerChanged in [${fromBlock}, ${latest}]`);

  for (const ev of logs) {
    const tokenId = ev.args.tokenId;
    const newOwner = ev.args.newOwner;
    // Unique, deterministic delivery id for this event (txHash + logIndex).
    const messageId = keccak256(
      AbiCoder.defaultAbiCoder().encode(["bytes32", "uint256"], [ev.transactionHash, BigInt(ev.index)]),
    );
    try {
      const processed = await gl.readContract({
        address: BRIDGE_RECEIVER_IC,
        functionName: "is_message_processed",
        args: [messageId],
      });
      if (processed) continue;

      // owner_changed: (kind, tokenId, newOwner, profile=0, level=0) — the hub does not know the
      // bound profile; VerdictStone resolves newOwner -> profile from its own binding mirror.
      const payload = AbiCoder.defaultAbiCoder().encode(IN_TYPES, [IN_OWNER_CHANGED, tokenId, newOwner, ZeroHash, 0n]);
      const txHash = await gl.writeContract({
        address: BRIDGE_RECEIVER_IC,
        functionName: "receive_message",
        args: [messageId, HUB_CHAIN_ID, HUB_ADDRESS, VERDICT_STONE_IC, getBytes(payload)],
        value: 0n,
      });
      log.push(`[hub→GL] owner_changed token ${tokenId} → ${newOwner} tx ${txHash}`);
      await gl.waitForTransactionReceipt({ hash: txHash, status: "ACCEPTED", retries: 30 });
    } catch (e) {
      log.push(`[hub→GL] error token ${tokenId}: ${e.message}`);
    }
  }
  state.fromBlock = latest + 1;
}

// ---- runner ------------------------------------------------------------------

export async function relayOnce(log = []) {
  const state = await readState();
  // Independent directions — one failing must not skip the other.
  const results = await Promise.allSettled([syncGenLayerToHub(log), syncHubToGenLayer(log, state)]);
  for (const r of results) if (r.status === "rejected") log.push(`fatal: ${r.reason}`);
  await writeStateFile(state);
  return log;
}

async function main() {
  console.log(`[stone-relay] GL=${chainKey} hub=${HUB_ADDRESS} receiver=${HUB_RECEIVER}`);
  console.log(`[stone-relay] GL account ${glAccount.address}${baseWallet ? ` / EVM ${baseWallet.address}` : ""}`);
  do {
    const log = [];
    await relayOnce(log);
    if (log.length) console.log(log.join("\n"));
    if (!runOnce) await new Promise((r) => setTimeout(r, pollIntervalMs));
  } while (!runOnce);
}

// Run when invoked directly; stay importable for the smoke script.
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
