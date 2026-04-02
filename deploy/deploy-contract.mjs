import "dotenv/config";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { abi, createAccount, createClient } from "genlayer-js";
import { localnet, studionet, testnetAsimov, testnetBradbury } from "genlayer-js/chains";
import { TransactionStatus } from "genlayer-js/types";
import { encodeFunctionData, parseEventLogs } from "viem";

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

const contractPaths = {
  verdictdotfun: resolve(process.cwd(), "contracts", "verdictdotfun.py"),
  argue: resolve(process.cwd(), "contracts", "argue_game.py"),
  riddle: resolve(process.cwd(), "contracts", "riddle_game.py"),
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

async function waitForReceipt(hash, expectedStatus = TransactionStatus.ACCEPTED, timeoutMs = 25 * 60_000) {
  const normalizedHash = normalizeHash(hash);
  if (!normalizedHash) {
    throw new Error("Transaction did not return a valid hash.");
  }

  const startedAt = Date.now();
  let lastError;

  while (Date.now() - startedAt < timeoutMs) {
    try {
      const tx = await client.getTransaction({ hash: normalizedHash });
      const statusName = normalizeStatusName(tx?.statusName ?? tx?.status);

      if (isSettledSuccess(tx?.statusName ?? tx?.status, expectedStatus)) {
        return tx;
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
        message.includes("unknown rpc error");

      if (!transient) {
        throw error;
      }
    }

    await new Promise((resolve) => setTimeout(resolve, 5_000));
  }

  throw lastError ?? new Error(`Timed out waiting for ${normalizedHash} to reach ${expectedStatus}.`);
}

function assertReceiptStatus(receipt, expectedStatus, context) {
  const actualStatusName =
    typeof receipt?.statusName === "string"
      ? receipt.statusName.toUpperCase()
      : typeof receipt?.status === "string"
        ? receipt.status.toUpperCase()
        : null;
  const actualStatus = receipt?.status;
  const acceptedStatusCodes = expectedStatus === TransactionStatus.FINALIZED ? [7] : [5, 7];
  const acceptedStatuses =
    expectedStatus === TransactionStatus.FINALIZED
      ? [TransactionStatus.FINALIZED, "FINALIZED"]
      : [TransactionStatus.ACCEPTED, TransactionStatus.FINALIZED, "ACCEPTED", "FINALIZED"];

  if (
    acceptedStatusCodes.includes(actualStatus) ||
    acceptedStatuses.includes(actualStatus) ||
    (actualStatusName && acceptedStatuses.includes(actualStatusName))
  ) {
    return receipt;
  }

  throw new Error(`${context} reached ${actualStatusName ?? actualStatus ?? "UNKNOWN"} instead of ${expectedStatus}.`);
}

function normalizeAddress(value) {
  if (!value) {
    return "";
  }

  if (typeof value === "string") {
    return value;
  }

  if (typeof value === "object") {
    if (typeof value.as_hex === "string" && value.as_hex) {
      return value.as_hex;
    }
    if (typeof value.hex === "string" && value.hex) {
      return value.hex;
    }
  }

  return String(value);
}

function getContractAddressFromReceipt(receipt) {
  const contractAddress = receipt?.data?.contract_address ?? receipt?.txDataDecoded?.contractAddress;

  if (!contractAddress) {
    throw new Error("Deployment completed without returning a contract address.");
  }

  return normalizeAddress(contractAddress);
}

async function deployContract(contractPath, args = []) {
  let lastError;

  for (let attempt = 1; attempt <= 4; attempt += 1) {
    try {
      const contractCode = await readFile(contractPath, "utf-8");
      const hash = await client.deployContract({
        code: contractCode,
        args,
        leaderOnly: false,
      });
      const receipt = assertReceiptStatus(await waitForReceipt(hash), TransactionStatus.ACCEPTED, `Deploy ${contractPath}`);
      return getContractAddressFromReceipt(receipt);
    } catch (error) {
      lastError = error;
      console.warn(`[deploy] attempt ${attempt} failed for ${contractPath}: ${error instanceof Error ? error.message : String(error)}`);
      if (attempt === 4) {
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 15_000));
    }
  }

  throw lastError;
}

async function writeContract(address, functionName, args = [], status = TransactionStatus.ACCEPTED) {
  let lastError;

  for (let attempt = 1; attempt <= 4; attempt += 1) {
    try {
      const hash = await client.writeContract({
        address,
        functionName,
        args,
        value: 0n,
      });
      return assertReceiptStatus(await waitForReceipt(hash, status), status, `${functionName} on ${address}`);
    } catch (error) {
      lastError = error;
      console.warn(
        `[deploy] attempt ${attempt} failed for ${functionName} on ${address}: ${error instanceof Error ? error.message : String(error)}`,
      );
      if (attempt === 4) {
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 15_000));
    }
  }

  throw lastError;
}

function getAddTransactionInputCount() {
  const addTransactionFunction = client.chain.consensusMainContract?.abi?.find(
    (item) => item?.type === "function" && item?.name === "addTransaction",
  );

  return Array.isArray(addTransactionFunction?.inputs) ? addTransactionFunction.inputs.length : 0;
}

function buildConsensusWriteData(address, functionName, args = [], leaderOnly = false, consensusMaxRotations = client.chain.defaultConsensusMaxRotations) {
  const calldataObject = abi.calldata.makeCalldataObject(functionName, args, undefined);
  const txData = abi.transactions.serialize([abi.calldata.encode(calldataObject), leaderOnly]);
  const addTransactionArgs = [
    client.account.address,
    address,
    client.chain.defaultNumberOfInitialValidators,
    consensusMaxRotations,
    txData,
  ];

  return encodeFunctionData({
    abi: client.chain.consensusMainContract.abi,
    functionName: "addTransaction",
    args: getAddTransactionInputCount() >= 6 ? [...addTransactionArgs, 0n] : addTransactionArgs,
  });
}

async function waitForEthereumReceipt(hash) {
  for (let attempt = 0; attempt < 180; attempt += 1) {
    const receipt = await client.request({
      method: "eth_getTransactionReceipt",
      params: [hash],
    });

    if (receipt) {
      return receipt;
    }

    await new Promise((resolve) => setTimeout(resolve, 5_000));
  }

  throw new Error(`Timed out waiting for Ethereum receipt for ${hash}.`);
}

async function writeContractWithForcedGas(
  address,
  functionName,
  args = [],
  {
    gas = 8_000_000n,
    leaderOnly = false,
    status = TransactionStatus.ACCEPTED,
    consensusMaxRotations = client.chain.defaultConsensusMaxRotations,
  } = {},
) {
  const account = client.account;
  const encodedData = buildConsensusWriteData(address, functionName, args, leaderOnly, consensusMaxRotations);
  const nonce = await client.getCurrentNonce({ address: account.address });
  const gasPriceHex = await client.request({ method: "eth_gasPrice" });
  const serializedTransaction = await account.signTransaction({
    account,
    to: client.chain.consensusMainContract.address,
    data: encodedData,
    type: "legacy",
    nonce: Number(nonce),
    value: 0n,
    gas,
    gasPrice: BigInt(gasPriceHex),
    chainId: client.chain.id,
  });
  const evmTxHash = await client.sendRawTransaction({ serializedTransaction });
  const evmReceipt = await waitForEthereumReceipt(evmTxHash);

  if (evmReceipt.status !== "0x1") {
    throw new Error(`${functionName} on ${address} reverted at the EVM layer (${evmTxHash}).`);
  }

  const events = parseEventLogs({
    abi: client.chain.consensusMainContract.abi,
    logs: evmReceipt.logs,
    strict: false,
  });
  const createdTransactionEvent = events.find(
    (event) => event.eventName === "CreatedTransaction" || event.eventName === "NewTransaction",
  );

  if (!createdTransactionEvent) {
    throw new Error(`${functionName} on ${address} did not emit a GenLayer tx id (${evmTxHash}).`);
  }

  return assertReceiptStatus(await waitForReceipt(createdTransactionEvent.args.txId, status), status, `${functionName} on ${address}`);
}

async function initializeModeContract(address, mode, code, { gas, consensusMaxRotations, retries = 3 }) {
  let lastError;

  for (let attempt = 1; attempt <= retries; attempt += 1) {
    try {
      return await writeContractWithForcedGas(address, "initialize_mode_contract", [mode, code], {
        gas,
        status: TransactionStatus.ACCEPTED,
        consensusMaxRotations,
      });
    } catch (error) {
      lastError = error;
      console.warn(
        `[deploy] attempt ${attempt} failed for initialize_mode_contract(${mode}) on ${address}: ${error instanceof Error ? error.message : String(error)}`,
      );
      if (attempt === retries) {
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 15_000));
    }
  }

  throw lastError;
}

async function deployFullStack() {
  const coreAddress = await deployContract(contractPaths.verdictdotfun, [initialSeason]);
  const argueAddress = await deployContract(contractPaths.argue, [coreAddress]);
  const riddleAddress = await deployContract(contractPaths.riddle, [coreAddress]);

  await writeContractWithForcedGas(coreAddress, "set_mode_contract", ["argue", argueAddress], {
    gas: 2_000_000n,
    status: TransactionStatus.FINALIZED,
  });
  await writeContractWithForcedGas(coreAddress, "set_mode_contract", ["riddle", riddleAddress], {
    gas: 2_000_000n,
    status: TransactionStatus.FINALIZED,
  });

  return {
    verdictdotfun: coreAddress,
    argue: argueAddress,
    riddle: riddleAddress,
  };
}

if (deployTarget !== "all") {
  throw new Error('The fixed-contract deployment uses DEPLOY_TARGET="all" only.');
}

const result = await deployFullStack();
console.log(JSON.stringify(result, null, 2));
