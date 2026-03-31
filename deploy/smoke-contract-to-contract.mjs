import "dotenv/config";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createAccount, createClient } from "genlayer-js";
import { localnet, studionet, testnetAsimov, testnetBradbury } from "genlayer-js/chains";
import { TransactionStatus } from "genlayer-js/types";

const chainKey = process.env.GENLAYER_CHAIN ?? "testnetBradbury";
const privateKey = process.env.GENLAYER_DEPLOYER_PRIVATE_KEY;
const endpoint = process.env.GENLAYER_ENDPOINT;

if (!privateKey) {
  throw new Error("Set GENLAYER_DEPLOYER_PRIVATE_KEY before running the cross-contract smoke test.");
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

const chain = chains[chainKey];
const client = createClient({
  chain,
  endpoint: endpoint ?? chain.rpcUrls.default.http[0],
  account: createAccount(privateKey),
});

if (typeof client.initializeConsensusSmartContract === "function") {
  await client.initializeConsensusSmartContract();
}

const contractPaths = {
  core: resolve(process.cwd(), "contracts", "score_core_smoke.py"),
  game: resolve(process.cwd(), "contracts", "score_game_smoke.py"),
};

const IN_PROGRESS_STATUSES = new Set([
  "PENDING",
  "PROPOSING",
  "COMMITTING",
  "REVEALING",
  "APPEAL_COMMITTING",
  "APPEAL_REVEALING",
  "READY_TO_FINALIZE",
]);
const FAILED_STATUSES = new Set([
  "UNDETERMINED",
  "CANCELED",
  "LEADER_TIMEOUT",
  "VALIDATORS_TIMEOUT",
]);

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function normalizeStatusName(status) {
  return typeof status === "string" ? status.trim().toUpperCase() : "";
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

function getStatusLabel(statusName, statusCode) {
  if (statusName) {
    return statusName;
  }

  if (typeof statusCode === "number" || typeof statusCode === "string") {
    return String(statusCode);
  }

  return "UNKNOWN";
}

async function waitForConsensus(hash, expectedStatus = TransactionStatus.ACCEPTED, timeoutMs = 25 * 60_000) {
  const normalizedHash = normalizeHash(hash);
  if (!normalizedHash) {
    throw new Error("Transaction did not return a valid hash.");
  }

  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    const tx = await client.getTransaction({ hash: normalizedHash });
    const statusName = normalizeStatusName(tx?.statusName ?? tx?.status);
    const statusCode = tx?.status;

    if (isSettledSuccess(tx?.statusName ?? tx?.status, expectedStatus)) {
      return tx;
    }

    if (FAILED_STATUSES.has(statusName)) {
      throw new Error(`Transaction ${normalizedHash} ended in ${statusName}.`);
    }

    if (!statusName || IN_PROGRESS_STATUSES.has(statusName)) {
      await sleep(5_000);
      continue;
    }

    await sleep(5_000);
    console.log(`Still waiting for ${normalizedHash}: ${getStatusLabel(statusName, statusCode)}`);
  }

  throw new Error(`Timed out waiting for ${normalizedHash} to reach ${expectedStatus}.`);
}

function getContractAddress(tx) {
  return tx?.txDataDecoded?.contractAddress ?? tx?.data?.contract_address ?? null;
}

async function deployContract(contractPath, args = []) {
  const code = await readFile(contractPath, "utf8");
  const hash = await client.deployContract({
    code,
    args,
    leaderOnly: false,
  });
  const tx = await waitForConsensus(hash, TransactionStatus.ACCEPTED);
  const address = getContractAddress(tx);

  if (!address) {
    throw new Error(`Deployment for ${contractPath} completed without a contract address.`);
  }

  console.log(`Deployed ${contractPath} -> ${address}`);
  return { hash: normalizeHash(hash), address };
}

async function writeContract(address, functionName, args = [], expectedStatus = TransactionStatus.ACCEPTED) {
  let lastError = null;

  for (let attempt = 1; attempt <= 4; attempt += 1) {
    try {
      const hash = await client.writeContract({
        address,
        functionName,
        args,
        value: 0n,
      });
      const tx = await waitForConsensus(hash, expectedStatus);
      console.log(`${functionName} on ${address} -> ${normalizeHash(hash)} (${getStatusLabel(normalizeStatusName(tx?.statusName ?? tx?.status), tx?.status)})`);
      return { hash: normalizeHash(hash), tx };
    } catch (error) {
      lastError = error;
      const message = error instanceof Error ? error.message : String(error);
      console.warn(`Attempt ${attempt} failed for ${functionName} on ${address}: ${message}`);

      if (attempt === 4) {
        break;
      }

      await sleep(15_000);
    }
  }

  throw lastError ?? new Error(`Failed to call ${functionName} on ${address}.`);
}

async function readContract(address, functionName, args = []) {
  return client.readContract({
    address,
    functionName,
    args,
  });
}

function profileLooksUpdated(profile) {
  const wins = Number(profile?.wins ?? 0);
  const xp = Number(profile?.xp ?? 0);
  return wins >= 1 && xp >= 100;
}

async function waitForProfileUpdate(coreAddress, ownerAddress, timeoutMs = 20 * 60_000) {
  const startedAt = Date.now();
  let lastProfile = null;

  while (Date.now() - startedAt < timeoutMs) {
    lastProfile = await readContract(coreAddress, "get_profile", [ownerAddress]);
    if (profileLooksUpdated(lastProfile)) {
      return lastProfile;
    }

    console.log(`Profile not updated yet. Current profile: ${JSON.stringify(lastProfile)}`);
    await sleep(10_000);
  }

  throw new Error(`Timed out waiting for core profile update. Last profile: ${JSON.stringify(lastProfile)}`);
}

async function main() {
  const deployerAddress = client.account.address;
  const suffix = Date.now().toString(36).slice(-6);
  const handle = `smoke-${suffix}`;
  const matchId = `SMOKE-${suffix}`;

  console.log(`Running smoke test on ${chainKey} with deployer ${deployerAddress}`);

  const core = await deployContract(contractPaths.core);
  await writeContract(core.address, "register_profile", [handle]);

  const game = await deployContract(contractPaths.game, [core.address]);
  await writeContract(core.address, "set_game_contract", [game.address, true]);

  const report = await writeContract(game.address, "report_match", [matchId, deployerAddress, deployerAddress, "argue"]);
  const profile = await waitForProfileUpdate(core.address, deployerAddress);

  console.log(JSON.stringify({
    chain: chainKey,
    coreAddress: core.address,
    gameAddress: game.address,
    reportHash: report.hash,
    profile,
  }, null, 2));
}

await main();
