import "dotenv/config";
import { abi, createAccount, createClient } from "genlayer-js";
import { localnet, studionet, testnetAsimov, testnetBradbury } from "genlayer-js/chains";
import { TransactionStatus } from "genlayer-js/types";
import { encodeFunctionData, parseEventLogs } from "viem";

const chainKey = process.env.GENLAYER_CHAIN ?? "studionet";
const privateKey = process.env.GENLAYER_DEPLOYER_PRIVATE_KEY;
const coreAddress =
  process.env.VERDICTDOTFUN_CONTRACT_ADDRESS ??
  process.env.VITE_VERDICTDOTFUN_CONTRACT_ADDRESS ??
  process.env.VDT_CORE_CONTRACT_ADDRESS ??
  process.env.VITE_VDT_CORE_CONTRACT_ADDRESS;
const configuredModeAddresses = {
  argue:
    process.env.VERDICTDOTFUN_ARGUE_CONTRACT_ADDRESS ??
    process.env.VITE_VERDICTDOTFUN_ARGUE_CONTRACT_ADDRESS ??
    process.env.VDT_ARGUE_CONTRACT_ADDRESS ??
    process.env.VITE_VDT_ARGUE_CONTRACT_ADDRESS,
  riddle:
    process.env.VERDICTDOTFUN_RIDDLE_CONTRACT_ADDRESS ??
    process.env.VITE_VERDICTDOTFUN_RIDDLE_CONTRACT_ADDRESS ??
    process.env.VDT_RIDDLE_CONTRACT_ADDRESS ??
    process.env.VITE_VDT_RIDDLE_CONTRACT_ADDRESS,
};

if (!privateKey) {
  throw new Error("Set GENLAYER_DEPLOYER_PRIVATE_KEY before binding mode contracts.");
}

if (!coreAddress) {
  throw new Error("Set VERDICTDOTFUN_CONTRACT_ADDRESS before binding mode contracts.");
}

for (const [mode, address] of Object.entries(configuredModeAddresses)) {
  if (!address) {
    throw new Error(`Set the ${mode} contract address before binding mode contracts.`);
  }
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

const FAILED_STATUSES = new Set([
  "UNDETERMINED",
  "CANCELED",
  "LEADER_TIMEOUT",
  "VALIDATORS_TIMEOUT",
]);

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

function normalizeAddress(value) {
  if (!value) {
    return "";
  }

  if (typeof value === "string") {
    return value;
  }

  if (typeof value === "object") {
    if (typeof value.as_hex === "string" && value.as_hex.trim()) {
      return value.as_hex.trim();
    }

    if (typeof value.hex === "string" && value.hex.trim()) {
      return value.hex.trim();
    }
  }

  return String(value);
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

async function waitForReceipt(hash, expectedStatus = TransactionStatus.FINALIZED, timeoutMs = 25 * 60_000) {
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

function getAddTransactionInputCount() {
  const addTransactionFunction = client.chain.consensusMainContract?.abi?.find(
    (item) => item?.type === "function" && item?.name === "addTransaction",
  );

  return Array.isArray(addTransactionFunction?.inputs) ? addTransactionFunction.inputs.length : 0;
}

function buildConsensusWriteData(address, functionName, args = [], leaderOnly = false, consensusMaxRotations = client.chain.defaultConsensusMaxRotations) {
  const calldataObject = abi.calldata.makeCalldataObject(functionName, args, undefined);
  const txData = abi.transactions.serialize([
    abi.calldata.encode(calldataObject),
    leaderOnly,
  ]);
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
    gas = 2_000_000n,
    leaderOnly = false,
    status = TransactionStatus.FINALIZED,
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

  return assertReceiptStatus(
    await waitForReceipt(createdTransactionEvent.args.txId, status),
    status,
    `${functionName} on ${address}`,
  );
}

async function readModeContract(mode) {
  const value = await client.readContract({
    address: coreAddress,
    functionName: "get_mode_contract",
    args: [mode],
    jsonSafeReturn: true,
  });

  return normalizeAddress(value);
}

function sameAddress(left, right) {
  return left.toLowerCase() === right.toLowerCase();
}

const before = {
  argue: await readModeContract("argue"),
  riddle: await readModeContract("riddle"),
};

const updated = [];

for (const mode of ["argue", "riddle"]) {
  const desiredAddress = normalizeAddress(configuredModeAddresses[mode]);
  const currentAddress = before[mode];

  if (sameAddress(currentAddress, desiredAddress)) {
    continue;
  }

  await writeContractWithForcedGas(coreAddress, "set_mode_contract", [mode, desiredAddress], {
    gas: 2_000_000n,
    status: TransactionStatus.FINALIZED,
  });
  updated.push(mode);
}

const after = {
  argue: await readModeContract("argue"),
  riddle: await readModeContract("riddle"),
};

console.log(
  JSON.stringify(
    {
      chain: chainKey,
      verdictdotfun: coreAddress,
      desired: configuredModeAddresses,
      before,
      after,
      updated,
    },
    null,
    2,
  ),
);
