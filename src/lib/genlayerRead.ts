import { abi } from "genlayer-js";
import type { CalldataEncodable, TransactionHashVariant } from "genlayer-js/types";
import type { Address } from "viem";
import { createArenaClient } from "@/lib/genlayer";

type JsonRecord = Record<string, unknown>;

interface ReadContractArgs {
  address: Address;
  functionName: string;
  args?: CalldataEncodable[];
  kwargs?: Map<string, CalldataEncodable> | Record<string, CalldataEncodable>;
  jsonSafeReturn?: boolean;
  rawReturn?: boolean;
  transactionHashVariant?: TransactionHashVariant;
}

interface GenCallStatus {
  code?: number;
  message?: string;
}

interface GenCallLog {
  level?: string;
  message?: string;
  target?: string;
  file?: string;
}

interface GenCallResponse {
  data?: string;
  status?: GenCallStatus;
  stdout?: string;
  stderr?: string;
  logs?: GenCallLog[];
}

function asRecord(value: unknown): JsonRecord {
  return value && typeof value === "object" ? (value as JsonRecord) : {};
}

function normalizeText(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function formatLogs(logs: unknown) {
  if (!Array.isArray(logs)) {
    return "";
  }

  return logs
    .map((entry) => {
      const log = entry as GenCallLog;
      const level = normalizeText(log.level);
      const message = normalizeText(log.message);
      const target = normalizeText(log.target);

      if (!message) {
        return "";
      }

      return [level && `[${level}]`, target && `${target}:`, message].filter(Boolean).join(" ");
    })
    .filter(Boolean)
    .slice(0, 4)
    .join(" | ");
}

async function executeRawGenCall(args: ReadContractArgs) {
  const client = createArenaClient();
  const encodedData = [
    abi.calldata.encode(abi.calldata.makeCalldataObject(args.functionName, args.args, args.kwargs)),
    false,
  ];
  const serializedData = abi.transactions.serialize(encodedData);

  const request = {
    type: "read",
    to: args.address,
    from: "0x0000000000000000000000000000000000000000",
    data: serializedData,
    transaction_hash_variant: args.transactionHashVariant ?? "latest-nonfinal",
  };

  return (client.request as (payload: { method: string; params: unknown[] }) => Promise<GenCallResponse>)({
    method: "gen_call",
    params: [request],
  });
}

function buildGenCallErrorMessage(originalError: unknown, debugResult: unknown) {
  const originalMessage = originalError instanceof Error ? originalError.message : "Read failed.";
  const response = asRecord(debugResult) as GenCallResponse;
  const status = asRecord(response.status) as GenCallStatus;
  const statusMessage = normalizeText(status.message);
  const stdout = normalizeText(response.stdout);
  const stderr = normalizeText(response.stderr);
  const logs = formatLogs(response.logs);

  const parts = [statusMessage || originalMessage];

  if (stderr) {
    parts.push(`stderr: ${stderr}`);
  }

  if (stdout) {
    parts.push(`stdout: ${stdout}`);
  }

  if (logs) {
    parts.push(`logs: ${logs}`);
  }

  return parts.join("\n");
}

export async function readContractWithDebug<T>(args: ReadContractArgs): Promise<T> {
  const client = createArenaClient();

  try {
    return await client.readContract(args) as T;
  } catch (originalError) {
    try {
      const debugResult = await executeRawGenCall(args);
      throw new Error(buildGenCallErrorMessage(originalError, debugResult));
    } catch (debugError) {
      if (debugError instanceof Error && debugError.message !== (originalError instanceof Error ? originalError.message : "")) {
        throw debugError;
      }

      throw originalError;
    }
  }
}
