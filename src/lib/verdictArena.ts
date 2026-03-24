import { TransactionStatus } from "genlayer-js/types";
import type { Address } from "viem";
import { arenaEnv } from "@/lib/env";
import { createArenaClient } from "@/lib/genlayer";
import type { BrowserEthereumProvider } from "@/lib/ethereum";
import type { ArenaMode, ArenaRoom, ArenaRoomStatus } from "@/types/arena";

type JsonRecord = Record<string, unknown>;

const EMPTY_ADDRESS = "0x0000000000000000000000000000000000000000";

function getConfiguredContractAddress(mode: ArenaMode): Address {
  const address = arenaEnv.contractAddresses[mode];

  if (!address) {
    throw new Error(`Missing contract address for ${mode}.`);
  }

  return address as Address;
}

function asRecord(value: unknown): JsonRecord {
  return value && typeof value === "object" ? (value as JsonRecord) : {};
}

function asString(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }

  if (typeof value === "number" || typeof value === "boolean" || typeof value === "bigint") {
    return String(value);
  }

  if (value && typeof value === "object") {
    const record = value as { as_hex?: unknown; hex?: unknown };

    if (typeof record.as_hex === "string") {
      return record.as_hex;
    }

    if (typeof record.hex === "string") {
      return record.hex;
    }
  }

  return "";
}

function asNumber(value: unknown): number {
  if (typeof value === "number") {
    return value;
  }

  if (typeof value === "bigint") {
    return Number(value);
  }

  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  return 0;
}

function asStatus(value: unknown): ArenaRoomStatus {
  const status = asString(value);

  if (status === "active" || status === "resolved") {
    return status;
  }

  return "waiting";
}

function parseRoom(mode: ArenaMode, raw: unknown): ArenaRoom | null {
  const record = asRecord(raw);
  const id = asString(record.id).trim();

  if (!id) {
    return null;
  }

  return {
    id,
    mode,
    owner: asString(record.owner) || EMPTY_ADDRESS,
    ownerName: asString(record.owner_name),
    opponent: asString(record.opponent) || EMPTY_ADDRESS,
    opponentName: asString(record.opponent_name),
    category: asString(record.category),
    prompt: asString(record.prompt),
    houseStance: asString(record.house_stance),
    ownerSubmission: asString(record.owner_submission),
    opponentSubmission: asString(record.opponent_submission),
    status: asStatus(record.status),
    winner: asString(record.winner) || EMPTY_ADDRESS,
    ownerScore: asNumber(record.owner_score),
    opponentScore: asNumber(record.opponent_score),
    verdictReasoning: asString(record.verdict_reasoning),
  };
}

function createWalletClient(account: Address, provider: BrowserEthereumProvider) {
  return createArenaClient(account, provider);
}

async function waitForReceipt(
  account: Address,
  provider: BrowserEthereumProvider,
  hash: unknown,
  status = TransactionStatus.ACCEPTED,
) {
  const normalizedHash = asString(hash);

  if (!normalizedHash) {
    throw new Error("The transaction did not return a valid hash.");
  }

  const client = createWalletClient(account, provider);

  return client.waitForTransactionReceipt({
    hash: normalizedHash as never,
    status,
    interval: 3_000,
    retries: 90,
  });
}

export async function fetchContractSchema(mode: ArenaMode) {
  const client = createArenaClient();
  return client.getContractSchema(getConfiguredContractAddress(mode));
}

export async function fetchRoom(mode: ArenaMode, roomId: string) {
  const client = createArenaClient();
  const raw = await client.readContract({
    address: getConfiguredContractAddress(mode),
    functionName: "get_room",
    args: [roomId],
    jsonSafeReturn: true,
  });

  return parseRoom(mode, raw);
}

export async function fetchRooms(mode: ArenaMode) {
  const client = createArenaClient();
  const rawIds = await client.readContract({
    address: getConfiguredContractAddress(mode),
    functionName: "get_room_ids",
    args: [],
    jsonSafeReturn: true,
  });

  if (!Array.isArray(rawIds)) {
    return [] as ArenaRoom[];
  }

  const rooms = await Promise.all(
    rawIds
      .map((value) => asString(value).trim())
      .filter(Boolean)
      .map((roomId) => fetchRoom(mode, roomId)),
  );

  return rooms.filter(Boolean) as ArenaRoom[];
}

export async function fetchAllRooms(modes: ArenaMode[]) {
  const rooms = await Promise.all(modes.map((mode) => fetchRooms(mode)));
  return rooms.flat();
}

export async function createRoom(
  mode: ArenaMode,
  account: Address,
  provider: BrowserEthereumProvider,
  room: {
    roomId: string;
    category: string;
    prompt: string;
  },
) {
  const client = createWalletClient(account, provider);
  const hash = await client.writeContract({
    address: getConfiguredContractAddress(mode),
    functionName: "create_room",
    args: [room.roomId, room.category, room.prompt],
    value: 0n,
  });

  return waitForReceipt(account, provider, hash);
}

export async function joinRoom(
  mode: ArenaMode,
  account: Address,
  provider: BrowserEthereumProvider,
  roomId: string,
) {
  const client = createWalletClient(account, provider);
  const hash = await client.writeContract({
    address: getConfiguredContractAddress(mode),
    functionName: "join_room",
    args: [roomId],
    value: 0n,
  });

  return waitForReceipt(account, provider, hash);
}

export async function submitEntry(
  mode: ArenaMode,
  account: Address,
  provider: BrowserEthereumProvider,
  roomId: string,
  submission: string,
) {
  const client = createWalletClient(account, provider);
  const hash = await client.writeContract({
    address: getConfiguredContractAddress(mode),
    functionName: "submit_entry",
    args: [roomId, submission],
    value: 0n,
  });

  return waitForReceipt(account, provider, hash);
}

export async function resolveRoom(
  mode: ArenaMode,
  account: Address,
  provider: BrowserEthereumProvider,
  roomId: string,
) {
  const client = createWalletClient(account, provider);
  const hash = await client.writeContract({
    address: getConfiguredContractAddress(mode),
    functionName: "resolve_room",
    args: [roomId],
    value: 0n,
  });

  return waitForReceipt(account, provider, hash, TransactionStatus.FINALIZED);
}

export function isEmptyAddress(address: string) {
  return !address || address.toLowerCase() === EMPTY_ADDRESS;
}
