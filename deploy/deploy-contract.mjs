import "dotenv/config";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createAccount, createClient } from "genlayer-js";
import { localnet, studionet, testnetAsimov, testnetBradbury } from "genlayer-js/chains";
import { TransactionStatus } from "genlayer-js/types";

const chainKey = process.env.GENLAYER_CHAIN ?? "studionet";
const deployTarget = process.env.DEPLOY_TARGET ?? "all";
const privateKey = process.env.GENLAYER_DEPLOYER_PRIVATE_KEY;
const initialSeason = Number(process.env.PROFILE_INITIAL_SEASON ?? "1");

if (!privateKey) {
  throw new Error("Set GENLAYER_DEPLOYER_PRIVATE_KEY before deploying contracts.");
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

const contractPaths = {
  vdtCore: resolve(process.cwd(), "contracts", "vdt_core.py"),
  playerProfile: resolve(process.cwd(), "contracts", "player_profile.py"),
  debate: resolve(process.cwd(), "contracts", "debate_game.py"),
  convince: resolve(process.cwd(), "contracts", "convince_me_game.py"),
  quiz: resolve(process.cwd(), "contracts", "quiz_game.py"),
  riddle: resolve(process.cwd(), "contracts", "riddle_game.py"),
};

async function waitForReceipt(hash, status = TransactionStatus.ACCEPTED) {
  let lastError;

  for (let attempt = 0; attempt < 40; attempt += 1) {
    try {
      return await client.waitForTransactionReceipt({
        hash,
        status,
        interval: 5_000,
        retries: 40,
      });
    } catch (error) {
      lastError = error;
      const message = error instanceof Error ? error.message.toLowerCase() : "";
      const transient =
        message.includes("fetch failed") ||
        message.includes("timeout") ||
        message.includes("network") ||
        message.includes("unknown rpc error");

      if (!transient || attempt === 39) {
        throw error;
      }

      await new Promise((resolve) => setTimeout(resolve, 10_000));
    }
  }

  throw lastError;
}

function assertReceiptStatus(receipt, expectedStatus, context) {
  const actualStatus = receipt?.statusName ?? receipt?.status;
  const acceptedStatuses =
    expectedStatus === TransactionStatus.FINALIZED
      ? [TransactionStatus.FINALIZED]
      : [TransactionStatus.ACCEPTED, TransactionStatus.FINALIZED];

  if (acceptedStatuses.includes(actualStatus)) {
    return receipt;
  }

  throw new Error(`${context} reached ${actualStatus ?? "UNKNOWN"} instead of ${expectedStatus}.`);
}

function getContractAddressFromReceipt(receipt) {
  const contractAddress =
    chainKey === "testnetBradbury"
      ? receipt?.txDataDecoded?.contractAddress
      : receipt?.data?.contract_address;

  if (!contractAddress) {
    throw new Error("Deployment completed without returning a contract address.");
  }

  return contractAddress;
}

async function deployContract(contractPath, args = []) {
  const contractCode = await readFile(contractPath, "utf-8");
  const hash = await client.deployContract({
    code: contractCode,
    args,
    leaderOnly: false,
  });
  const receipt = assertReceiptStatus(await waitForReceipt(hash), TransactionStatus.ACCEPTED, `Deploy ${contractPath}`);
  return getContractAddressFromReceipt(receipt);
}

async function writeContract(address, functionName, args = [], status = TransactionStatus.ACCEPTED) {
  const hash = await client.writeContract({
    address,
    functionName,
    args,
    value: 0n,
  });
  return assertReceiptStatus(await waitForReceipt(hash, status), status, `${functionName} on ${address}`);
}

async function deployFullStack() {
  const [playerProfileCode, debateCode, convinceCode, quizCode, riddleCode] = await Promise.all([
    readFile(contractPaths.playerProfile, "utf-8"),
    readFile(contractPaths.debate, "utf-8"),
    readFile(contractPaths.convince, "utf-8"),
    readFile(contractPaths.quiz, "utf-8"),
    readFile(contractPaths.riddle, "utf-8"),
  ]);

  const vdtCoreAddress = await deployContract(contractPaths.vdtCore, [initialSeason]);
  await writeContract(vdtCoreAddress, "set_profile_code", [playerProfileCode]);
  await writeContract(vdtCoreAddress, "set_room_code", ["debate", debateCode]);
  await writeContract(vdtCoreAddress, "set_room_code", ["convince", convinceCode]);
  await writeContract(vdtCoreAddress, "set_room_code", ["quiz", quizCode]);
  await writeContract(vdtCoreAddress, "set_room_code", ["riddle", riddleCode]);
  return {
    vdtCore: vdtCoreAddress,
  };
}

if (deployTarget !== "all") {
  throw new Error('VDTCore deployment now uses DEPLOY_TARGET="all" only.');
}

const result = await deployFullStack();
console.log(JSON.stringify(result, null, 2));
