// Deploy the GenLayer CreditLedger IC (sub-project #1 value rail).
//
// The ledger holds atto-credit balances and room escrow. `core` is the game core (only it may open
// escrows); `bridge` is the trusted relayer authority that credits deposits and settles redeems —
// the same wallet the credit-bridge runner uses (the deployer here).
//
//   GENLAYER_DEPLOYER_PRIVATE_KEY   required
//   GENLAYER_CHAIN                  default "studionet"
//   VERDICTDOTFUN_CONTRACT_ADDRESS  game core (falls back to VDT_CORE_CONTRACT_ADDRESS)
//   CREDIT_LEDGER_BRIDGE            bridge authority (default: the deployer address)
import "dotenv/config";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { createAccount, createClient } from "genlayer-js";
import { localnet, studionet, testnetAsimov, testnetBradbury } from "genlayer-js/chains";

const chains = { localnet, studionet, testnetAsimov, testnetBradbury };
const chainKey = process.env.GENLAYER_CHAIN ?? "studionet";
if (!(chainKey in chains)) throw new Error(`Unsupported GENLAYER_CHAIN "${chainKey}".`);

const privateKey = process.env.GENLAYER_DEPLOYER_PRIVATE_KEY;
if (!privateKey) throw new Error("Set GENLAYER_DEPLOYER_PRIVATE_KEY before deploying.");

const account = createAccount(privateKey);
const core = process.env.VERDICTDOTFUN_CONTRACT_ADDRESS || process.env.VDT_CORE_CONTRACT_ADDRESS || "";
if (!core) throw new Error("Set VERDICTDOTFUN_CONTRACT_ADDRESS (game core) before deploying the ledger.");
const bridge = process.env.CREDIT_LEDGER_BRIDGE || account.address;

const contractPath = resolve(process.cwd(), "contracts", "credit_ledger.py");
const deploymentPath = resolve(process.cwd(), "deploy", "deployments", "credit-ledger-studionet.json");

const client = createClient({
  chain: chains[chainKey],
  endpoint: process.env.GENLAYER_ENDPOINT ?? chains[chainKey].rpcUrls.default.http[0],
  account,
});

function normalizeHash(h) {
  if (typeof h === "string" && h.trim()) return h.trim();
  if (h && typeof h === "object") return h.as_hex?.trim() || h.hex?.trim() || "";
  return "";
}
function normalizeAddress(v) {
  if (!v) return "";
  if (typeof v === "string") return v;
  if (typeof v === "object") return v.as_hex || v.hex || String(v);
  return String(v);
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
  let lastError;
  for (let attempt = 1; attempt <= 4; attempt += 1) {
    try {
      const hash = await client.deployContract({ code, args: [core, bridge], leaderOnly: false });
      const receipt = await waitForReceipt(hash);
      const address = normalizeAddress(receipt?.data?.contract_address ?? receipt?.txDataDecoded?.contractAddress);
      if (!address) throw new Error("Deployment returned no contract address.");
      return address;
    } catch (error) {
      lastError = error;
      console.warn(`[deploy-credit-ledger] attempt ${attempt} failed: ${error?.message ?? error}`);
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
  deployer: account.address,
  contract: "CreditLedger",
  address,
  config: { core, bridge },
  note: "GenLayer value-rail ledger. bridge authority = the credit-bridge runner wallet.",
};
await mkdir(dirname(deploymentPath), { recursive: true });
await writeFile(deploymentPath, `${JSON.stringify(record, null, 2)}\n`, "utf-8");
console.log(JSON.stringify(record, null, 2));
console.log(`\nSet CREDIT_LEDGER_CONTRACT_ADDRESS=${address} and run CREDIT_BRIDGE_ENABLED=1 pnpm credit:bridge`);
