// Credit bridge runner (sub-project #1, Plan 1D).
//
// Mirrors EVM CreditVault deposits into GenLayer CreditLedger credits, drains
// ledger redeem requests back to the vault, and finalizes provisional rooms whose
// challenge window has elapsed.
//
// Standalone on purpose: it does not modify the existing relayer.mjs. Run it
// alongside the relayer. Live execution requires deployed CreditVault (1A),
// CreditLedger (1B), core + mode contracts (1B/1C), and a funded bridge key that
// is set as BOTH the vault `bridge` and the ledger `bridge`.
//
//   CREDIT_BRIDGE_ENABLED=1 node ./deploy/credit-bridge.mjs
//
import "dotenv/config";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { createAccount, createClient } from "genlayer-js";
import { localnet, studionet, testnetAsimov, testnetBradbury } from "genlayer-js/chains";
import { Contract, JsonRpcProvider, Wallet } from "ethers";
import { depositRef, attoCreditsForDeposit, tokenAmountForAtto, profileFromBytes32 } from "./lib/bridge.mjs";

const chains = { localnet, studionet, testnetAsimov, testnetBradbury };
const chainKey = process.env.GENLAYER_CHAIN ?? "studionet";
const glPrivateKey = process.env.GENLAYER_DEPLOYER_PRIVATE_KEY;
if (!glPrivateKey) throw new Error("Set GENLAYER_DEPLOYER_PRIVATE_KEY.");

const enabled = process.env.CREDIT_BRIDGE_ENABLED === "1";
const vaultAddress = process.env.CREDIT_VAULT_CONTRACT_ADDRESS || "";
const ledgerAddress = process.env.CREDIT_LEDGER_CONTRACT_ADDRESS || "";
const coreAddress =
  process.env.VERDICTDOTFUN_CONTRACT_ADDRESS || process.env.VDT_CORE_CONTRACT_ADDRESS || "";
const baseSepoliaRpcUrl = process.env.BASE_SEPOLIA_RPC_URL || "https://sepolia.base.org";
const bridgePrivateKey =
  process.env.CREDIT_BRIDGE_PRIVATE_KEY || process.env.BASE_SEPOLIA_PRIVATE_KEY || "";
const runOnce = process.env.CREDIT_BRIDGE_RUN_ONCE === "1";
const pollIntervalMs = Number(process.env.CREDIT_BRIDGE_POLL_INTERVAL_MS ?? "15000");
const stateFilePath = resolve(process.cwd(), process.env.CREDIT_BRIDGE_STATE_FILE ?? "artifacts/credit-bridge-state.json");

const VAULT_ABI = [
  "event CreditPurchased(address indexed user, address indexed token, bytes32 indexed profile, uint256 amount, uint256 nonce)",
  "function redeem(address user, address token, uint256 amount, uint256 redeemId) external",
];

function parseCreditTokens(csv) {
  const map = new Map();
  for (const entry of String(csv || "").split(",").map((s) => s.trim()).filter(Boolean)) {
    const [symbol, address, decimals, creditsPerToken] = entry.split(":");
    map.set(address.toLowerCase(), {
      symbol,
      address,
      decimals: Number(decimals),
      creditsPerToken: Number(creditsPerToken),
    });
  }
  return map;
}
const creditTokens = parseCreditTokens(process.env.CREDIT_TOKENS);
function tokenMetaBySymbol(symbol) {
  for (const meta of creditTokens.values()) {
    if (meta.symbol.toUpperCase() === String(symbol).toUpperCase()) return meta;
  }
  return null;
}

const glClient = createClient({
  chain: chains[chainKey],
  endpoint: process.env.GENLAYER_ENDPOINT ?? chains[chainKey].rpcUrls.default.http[0],
  account: createAccount(glPrivateKey),
});
const provider = new JsonRpcProvider(baseSepoliaRpcUrl);
const wallet = bridgePrivateKey ? new Wallet(bridgePrivateKey, provider) : null;

async function readState() {
  try {
    return JSON.parse(await readFile(stateFilePath, "utf-8"));
  } catch {
    return { creditFromBlock: 0, processedDeposits: {} };
  }
}
async function writeState(state) {
  await mkdir(dirname(stateFilePath), { recursive: true });
  await writeFile(stateFilePath, JSON.stringify(state, null, 2));
}

async function syncDeposits(state) {
  if (!vaultAddress || !ledgerAddress) return;
  const vault = new Contract(vaultAddress, VAULT_ABI, provider);
  const fromBlock = state.creditFromBlock ?? Number(process.env.CREDIT_BRIDGE_FROM_BLOCK ?? "0");
  const toBlock = await provider.getBlockNumber();
  if (toBlock < fromBlock) return;

  const events = await vault.queryFilter(vault.filters.CreditPurchased(), fromBlock, toBlock);
  for (const ev of events) {
    const { token, profile, amount, nonce } = ev.args;
    const ref = depositRef(ev.transactionHash, nonce);
    if (state.processedDeposits?.[ref]) continue;

    const meta = creditTokens.get(String(token).toLowerCase());
    if (!meta) {
      console.warn(`[credit] skip unknown token ${token} (deposit ${ref})`);
      continue;
    }
    const atto = attoCreditsForDeposit({ rawAmount: amount, decimals: meta.decimals, creditsPerToken: meta.creditsPerToken });
    const profileAddr = profileFromBytes32(profile);

    await glClient.writeContract({
      address: ledgerAddress,
      functionName: "credit",
      args: [profileAddr, atto.toString(), ref],
      value: 0n,
    });
    state.processedDeposits = state.processedDeposits || {};
    state.processedDeposits[ref] = true;
    console.log(`[credit] +${atto} atto -> ${profileAddr} (${ref})`);
  }
  state.creditFromBlock = toBlock + 1;
}

async function syncRedeems() {
  if (!vaultAddress || !ledgerAddress || !wallet) return;
  const count = BigInt(await glClient.readContract({
    address: ledgerAddress, functionName: "get_redeem_count", args: [], jsonSafeReturn: true,
  }));
  const vault = new Contract(vaultAddress, VAULT_ABI, wallet);
  for (let id = 0n; id < count; id++) {
    const r = await glClient.readContract({
      address: ledgerAddress, functionName: "get_redeem", args: [id.toString()], jsonSafeReturn: true,
    });
    if (r.settled) continue;
    const meta = tokenMetaBySymbol(r.token);
    if (!meta) { console.warn(`[redeem] unknown token ${r.token} (id ${id})`); continue; }
    const amount = tokenAmountForAtto({ attoAmount: BigInt(r.atto_amount), decimals: meta.decimals, creditsPerToken: meta.creditsPerToken });
    const tx = await vault.redeem(r.payout_wallet, meta.address, amount.toString(), id.toString());
    await tx.wait();
    await glClient.writeContract({
      address: ledgerAddress, functionName: "mark_redeem_settled", args: [id.toString()], value: 0n,
    });
    console.log(`[redeem] released ${amount} ${meta.symbol} -> ${r.payout_wallet} (id ${id})`);
  }
}

async function syncFinalize() {
  if (!coreAddress) return;
  const roomIds = await glClient.readContract({
    address: coreAddress, functionName: "get_room_ids", args: [], jsonSafeReturn: true,
  });
  for (const roomId of roomIds || []) {
    let entry;
    try {
      entry = await glClient.readContract({
        address: coreAddress, functionName: "get_room_registry_entry", args: [roomId], jsonSafeReturn: true,
      });
    } catch { continue; }
    const mode = entry?.contract;
    if (!mode || /^0x0+$/.test(String(mode))) continue;
    let room;
    try {
      room = await glClient.readContract({ address: mode, functionName: "get_room", args: [roomId], jsonSafeReturn: true });
    } catch { continue; }
    if (room.status !== "provisional" || room.appeal_state === "filed") continue;
    try {
      await glClient.writeContract({ address: mode, functionName: "finalize_room", args: [roomId], value: 0n });
      console.log(`[finalize] poked ${roomId}`);
    } catch (e) {
      if (!String(e?.message || "").includes("window")) console.warn(`[finalize] ${roomId}: ${e?.message}`);
    }
  }
}

async function tick() {
  const state = await readState();
  try {
    await syncDeposits(state);
    await syncRedeems();
    await syncFinalize();
  } finally {
    await writeState(state);
  }
}

async function main() {
  if (!enabled) {
    console.log("CREDIT_BRIDGE_ENABLED != 1 — exiting without action.");
    return;
  }
  if (runOnce) {
    await tick();
    return;
  }
  // eslint-disable-next-line no-constant-condition
  while (true) {
    await tick();
    await new Promise((r) => setTimeout(r, pollIntervalMs));
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
