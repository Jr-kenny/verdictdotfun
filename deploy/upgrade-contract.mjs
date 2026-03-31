import "dotenv/config";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createAccount, createClient } from "genlayer-js";
import { localnet, studionet, testnetAsimov, testnetBradbury } from "genlayer-js/chains";
import { TransactionStatus } from "genlayer-js/types";

const chainKey = process.env.GENLAYER_CHAIN ?? "testnetBradbury";
const privateKey = process.env.GENLAYER_DEPLOYER_PRIVATE_KEY;
const upgradeTarget = process.env.UPGRADE_TARGET ?? "all";
const waitStatus =
  String(process.env.UPGRADE_WAIT_STATUS ?? "accepted").trim().toLowerCase() === "finalized"
    ? TransactionStatus.FINALIZED
    : TransactionStatus.ACCEPTED;
const verdictdotfunAddress =
  process.env.VERDICTDOTFUN_CONTRACT_ADDRESS ??
  process.env.VITE_VERDICTDOTFUN_CONTRACT_ADDRESS ??
  process.env.VDT_CORE_CONTRACT_ADDRESS ??
  process.env.VITE_VDT_CORE_CONTRACT_ADDRESS;
const argueAddress =
  process.env.VERDICTDOTFUN_ARGUE_CONTRACT_ADDRESS ??
  process.env.VITE_VERDICTDOTFUN_ARGUE_CONTRACT_ADDRESS ??
  process.env.VDT_ARGUE_CONTRACT_ADDRESS ??
  process.env.VITE_VDT_ARGUE_CONTRACT_ADDRESS;
const riddleAddress =
  process.env.VERDICTDOTFUN_RIDDLE_CONTRACT_ADDRESS ??
  process.env.VITE_VERDICTDOTFUN_RIDDLE_CONTRACT_ADDRESS ??
  process.env.VDT_RIDDLE_CONTRACT_ADDRESS ??
  process.env.VITE_VDT_RIDDLE_CONTRACT_ADDRESS;

if (!privateKey) {
  throw new Error("Set GENLAYER_DEPLOYER_PRIVATE_KEY before upgrading contracts.");
}

const chains = {
  localnet,
  studionet,
  testnetAsimov,
  testnetBradbury,
};

if (!(chainKey in chains)) {
  throw new Error(`Unsupported GENLAYER_CHAIN "${chainKey}".`);
}

const client = createClient({
  chain: chains[chainKey],
  endpoint: process.env.GENLAYER_ENDPOINT ?? chains[chainKey].rpcUrls.default.http[0],
  account: createAccount(privateKey),
});

if (typeof client.initializeConsensusSmartContract === "function") {
  await client.initializeConsensusSmartContract();
}

const FAILED_STATUSES = new Set([
  "UNDETERMINED",
  "CANCELED",
  "LEADER_TIMEOUT",
  "VALIDATORS_TIMEOUT",
]);

const contracts = {
  verdictdotfun: {
    address: verdictdotfunAddress,
    path: resolve(process.cwd(), "contracts", "verdictdotfun.py"),
  },
  argue: {
    address: argueAddress,
    path: resolve(process.cwd(), "contracts", "argue_game.py"),
  },
  riddle: {
    address: riddleAddress,
    path: resolve(process.cwd(), "contracts", "riddle_game.py"),
  },
};

const selectedContracts =
  upgradeTarget === "all"
    ? Object.entries(contracts)
    : Object.entries(contracts).filter(([name]) => name === upgradeTarget);

if (selectedContracts.length === 0) {
  throw new Error('Set UPGRADE_TARGET to "all", "verdictdotfun", "argue", or "riddle".');
}

function normalizeHash(hash) {
  if (typeof hash === "string" && hash.trim()) {
    return hash.trim();
  }

  if (hash && typeof hash === "object") {
    if (typeof hash.as_hex === "string" && hash.as_hex.trim()) {
      return hash.as_hex.trim();
    }
    if (typeof hash.hex === "string" && hash.hex.trim()) {
      return hash.hex.trim();
    }
  }

  return "";
}

function normalizeStatusName(status) {
  return typeof status === "string" ? status.trim().toUpperCase() : "";
}

function isSettledSuccess(status, expectedStatus) {
  if (typeof status === "number") {
    return expectedStatus === TransactionStatus.FINALIZED ? status === 7 : status === 5 || status === 7;
  }

  const name = normalizeStatusName(status);
  if (!name) {
    return false;
  }

  return expectedStatus === TransactionStatus.FINALIZED
    ? name === "FINALIZED"
    : name === "ACCEPTED" || name === "FINALIZED";
}

async function waitForReceipt(hash, status = waitStatus, timeoutMs = 25 * 60_000) {
  const normalizedHash = normalizeHash(hash);
  if (!normalizedHash) {
    throw new Error("Transaction did not return a valid hash.");
  }

  const startedAt = Date.now();
  let lastError = null;

  while (Date.now() - startedAt < timeoutMs) {
    try {
      const receipt = await client.getTransaction({ hash: normalizedHash });
      const statusName = normalizeStatusName(receipt?.statusName ?? receipt?.status);

      if (isSettledSuccess(receipt?.statusName ?? receipt?.status, status)) {
        return receipt;
      }

      if (FAILED_STATUSES.has(statusName)) {
        throw new Error(`Transaction ${normalizedHash} ended in ${statusName}.`);
      }
    } catch (error) {
      lastError = error;
      const message = error instanceof Error ? error.message.toLowerCase() : "";
      const transient =
        message.includes("fetch failed") ||
        message.includes("timeout") ||
        message.includes("network") ||
        message.includes("internal error") ||
        message.includes("unknown rpc error");

      if (!transient) {
        throw error;
      }
    }

    await new Promise((resolve) => setTimeout(resolve, 5_000));
  }

  throw lastError ?? new Error(`Timed out waiting for ${normalizedHash} to reach ${status}.`);
}

for (const [name, config] of selectedContracts) {
  if (!config.address) {
    console.warn(`[upgrade] skipping ${name}; no configured address`);
    continue;
  }

  const code = await readFile(config.path, "utf-8");
  const hash = await client.writeContract({
    address: config.address,
    functionName: "upgrade",
    args: [Buffer.from(code, "utf-8")],
    value: 0n,
  });

  const receipt = await waitForReceipt(hash, waitStatus);
  console.log(
    JSON.stringify(
      {
        contract: name,
        address: config.address,
        hash: normalizeHash(hash),
        status: receipt?.statusName ?? receipt?.status,
        waitedFor: waitStatus === TransactionStatus.FINALIZED ? "FINALIZED" : "ACCEPTED",
      },
      null,
      2,
    ),
  );
}
