import { TransactionStatus } from "genlayer-js/types";
import type { Address } from "viem";
import { createArenaClient, getArenaChain } from "@/lib/genlayer";
import type { BrowserEthereumProvider } from "@/lib/ethereum";

const ACCEPTED_STATUS_CODES = new Set([5, 7]);
const FINALIZED_STATUS_CODES = new Set([7]);
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

function sleep(ms: number) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function normalizeHash(hash: unknown) {
  if (typeof hash === "string" && hash.trim()) {
    return hash.trim();
  }

  if (typeof hash === "number" || typeof hash === "bigint") {
    return String(hash);
  }

  if (hash && typeof hash === "object") {
    const record = hash as { as_hex?: unknown; hex?: unknown };

    if (typeof record.as_hex === "string" && record.as_hex.trim()) {
      return record.as_hex.trim();
    }

    if (typeof record.hex === "string" && record.hex.trim()) {
      return record.hex.trim();
    }
  }

  return "";
}

function normalizeStatusName(status: unknown) {
  return typeof status === "string" ? status.trim().toUpperCase() : "";
}

function isSettledSuccess(status: unknown, expectedStatus: TransactionStatus) {
  if (typeof status === "number") {
    return expectedStatus === TransactionStatus.FINALIZED
      ? FINALIZED_STATUS_CODES.has(status)
      : ACCEPTED_STATUS_CODES.has(status);
  }

  const statusName = normalizeStatusName(status);
  if (!statusName) {
    return false;
  }

  if (expectedStatus === TransactionStatus.FINALIZED) {
    return statusName === "FINALIZED";
  }

  return statusName === "ACCEPTED" || statusName === "FINALIZED";
}

function describeStatus(statusName: string, statusCode: unknown) {
  if (statusName) {
    return statusName;
  }

  if (typeof statusCode === "number" || typeof statusCode === "string") {
    return String(statusCode);
  }

  return "UNKNOWN";
}

export async function waitForConsensusReceipt(
  account: Address,
  provider: BrowserEthereumProvider,
  hash: unknown,
  status = TransactionStatus.ACCEPTED,
  options?: {
    intervalMs?: number;
    timeoutMs?: number;
  },
) {
  const normalizedHash = normalizeHash(hash);

  if (!normalizedHash) {
    throw new Error("The transaction did not return a valid hash.");
  }

  const client = createArenaClient(account, provider);
  const intervalMs = options?.intervalMs ?? 5_000;
  const timeoutMs = options?.timeoutMs ?? (status === TransactionStatus.FINALIZED ? 35 * 60_000 : 25 * 60_000);
  const startedAt = Date.now();
  let lastKnownStatus = "PENDING";

  while (Date.now() - startedAt < timeoutMs) {
    const tx = await client.getTransaction({ hash: normalizedHash as never });
    const statusName = normalizeStatusName(tx?.statusName ?? tx?.status);
    const statusCode = tx?.status;

    lastKnownStatus = describeStatus(statusName, statusCode);

    if (isSettledSuccess(tx?.statusName ?? tx?.status, status)) {
      return tx;
    }

    if (FAILED_STATUSES.has(statusName)) {
      throw new Error(`Transaction ${normalizedHash} ended in ${statusName}.`);
    }

    if (!statusName || IN_PROGRESS_STATUSES.has(statusName)) {
      await sleep(intervalMs);
      continue;
    }

    await sleep(intervalMs);
  }

  throw new Error(
    `Transaction ${normalizedHash} is still ${lastKnownStatus} on ${getArenaChain().name}. Keep monitoring the explorer and retry the refresh shortly.`,
  );
}
