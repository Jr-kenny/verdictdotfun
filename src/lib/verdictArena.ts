import { TransactionStatus } from "genlayer-js/types";
import { getAddress, isAddress } from "viem";
import type { Address } from "viem";
import { arenaEnv } from "@/lib/env";
import { createArenaClient } from "@/lib/genlayer";
import { readContractWithDebug } from "@/lib/genlayerRead";
import { waitForConsensusReceipt } from "@/lib/genlayerTransactions";
import type { BrowserEthereumProvider } from "@/lib/ethereum";
import type { ArenaMode, ArenaRoom, ArenaRoomStatus, ArgueStyle } from "@/types/arena";

type JsonRecord = Record<string, unknown>;
type WalletArenaClient = ReturnType<typeof createWalletClient>;
type WalletWriteRequest = Parameters<WalletArenaClient["writeContract"]>[0];

const EMPTY_ADDRESS = "0x0000000000000000000000000000000000000000";

function getLegacyConfiguredContractAddress(mode: ArenaMode): Address {
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

function asAddressString(value: unknown): string {
  const candidate = asString(value);
  return isAddress(candidate) ? getAddress(candidate) : candidate;
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

function asBoolean(value: unknown): boolean {
  if (typeof value === "boolean") {
    return value;
  }

  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    return normalized === "true" || normalized === "1";
  }

  if (typeof value === "number" || typeof value === "bigint") {
    return Number(value) !== 0;
  }

  return false;
}

function asStatus(value: unknown): ArenaRoomStatus {
  const status = asString(value);

  if (
    status === "pending_accept" ||
    status === "ready_to_start" ||
    status === "studying" ||
    status === "active" ||
    status === "resolved"
  ) {
    return status;
  }

  return "waiting";
}

function isTransientRoomAvailabilityError(error: unknown) {
  if (!(error instanceof Error)) {
    return false;
  }

  const message = error.message.toLowerCase();
  return (
    message.includes("requested resource not found") ||
    message.includes("contract not found") ||
    message.includes("can not get contract state")
  );
}

function isTransientExecutionSlotError(error: unknown) {
  if (!(error instanceof Error)) {
    return false;
  }

  const message = error.message.toLowerCase();
  return (
    message.includes("server busy") ||
    message.includes("execution slots occupied") ||
    message.includes("retry later")
  );
}

function sleep(ms: number) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

async function readContractWithRetry<T>(read: () => Promise<T>, retries = 4) {
  let lastError: unknown;

  for (let attempt = 0; attempt < retries; attempt += 1) {
    try {
      return await read();
    } catch (error) {
      lastError = error;

      if (!(error instanceof Error) || !error.message.toLowerCase().includes("rate limit exceeded") || attempt === retries - 1) {
        throw error;
      }

      await sleep(10_500);
    }
  }

  throw lastError;
}

async function writeContractWithRetry(
  client: WalletArenaClient,
  request: WalletWriteRequest,
  retries = 4,
) {
  let lastError: unknown;

  for (let attempt = 0; attempt < retries; attempt += 1) {
    try {
      return await client.writeContract(request);
    } catch (error) {
      lastError = error;
      if (!isTransientExecutionSlotError(error) || attempt === retries - 1) {
        throw error;
      }

      await sleep(1_500 * (attempt + 1));
    }
  }

  throw lastError;
}

function asArgueStyle(value: unknown): ArgueStyle {
  return asString(value) === "convince" ? "convince" : "debate";
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
    argueStyle: record.argue_style === undefined ? undefined : asArgueStyle(record.argue_style),
    owner: asAddressString(record.owner) || EMPTY_ADDRESS,
    ownerName: asString(record.owner_name),
    opponent: asAddressString(record.opponent) || EMPTY_ADDRESS,
    opponentName: asString(record.opponent_name),
    category: asString(record.category),
    prompt: asString(record.prompt),
    houseStance: asString(record.house_stance),
    ownerSubmission: asString(record.owner_submission),
    opponentSubmission: asString(record.opponent_submission),
    status: asStatus(record.status),
    winner: asAddressString(record.winner) || EMPTY_ADDRESS,
    ownerScore: asNumber(record.owner_score),
    opponentScore: asNumber(record.opponent_score),
    verdictReasoning: asString(record.verdict_reasoning),
  };
}

function createWalletClient(account: Address, provider: BrowserEthereumProvider) {
  return createArenaClient(account, provider);
}

async function fetchRoomByTarget(target: { address: Address; mode: ArenaMode }, roomId: string) {
  let raw: unknown;

  try {
    raw = await readContractWithDebug({
      address: target.address,
      functionName: "get_room",
      args: [roomId],
      jsonSafeReturn: true,
    });
  } catch (error) {
    if (isTransientRoomAvailabilityError(error)) {
      return null;
    }
    throw error;
  }

  return parseRoom(target.mode, raw);
}

async function resolveRoomTarget(mode: ArenaMode) {
  const address = getLegacyConfiguredContractAddress(mode);
  if (isEmptyAddress(address)) {
    return null;
  }

  return {
    address,
    mode,
  };
}

async function waitForReceipt(
  account: Address,
  provider: BrowserEthereumProvider,
  hash: unknown,
  status = TransactionStatus.ACCEPTED,
) {
  return waitForConsensusReceipt(account, provider, hash, status);
}

export async function fetchContractSchema(mode: ArenaMode) {
  const client = createArenaClient();
  const address = getLegacyConfiguredContractAddress(mode);

  try {
    return await client.getContractSchema(address);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);

    // Studionet currently serves contract reads but not schema introspection.
    if (!message.includes("Contract schema is not supported on this network")) {
      throw error;
    }

    await readContractWithDebug({
      address,
      functionName: "get_room_ids",
      args: [],
      jsonSafeReturn: true,
    });

    return null;
  }
}

export async function fetchRoom(mode: ArenaMode, roomId: string) {
  const target = await resolveRoomTarget(mode);
  if (!target) {
    return null;
  }
  return fetchRoomByTarget(target, roomId);
}

export async function waitForRoom(mode: ArenaMode, roomId: string, retries = 50, intervalMs = 2_500) {
  for (let attempt = 0; attempt < retries; attempt += 1) {
    const room = await fetchRoom(mode, roomId);

    if (room) {
      return room;
    }

    if (attempt < retries - 1) {
      await new Promise((resolve) => window.setTimeout(resolve, intervalMs));
    }
  }

  throw new Error(
    "The room transaction was accepted, but the game contract has not exposed it yet. Try again in a little while.",
  );
}

export async function waitForRoomState(
  mode: ArenaMode,
  roomId: string,
  predicate: (room: ArenaRoom) => boolean,
  retries = 20,
  intervalMs = 3_000,
) {
  for (let attempt = 0; attempt < retries; attempt += 1) {
    const room = await fetchRoom(mode, roomId);

    if (room && predicate(room)) {
      return room;
    }

    if (attempt < retries - 1) {
      await new Promise((resolve) => window.setTimeout(resolve, intervalMs));
    }
  }

  return null;
}

export async function fetchRooms(mode: ArenaMode) {
  const rawIds = await readContractWithDebug({
    address: getLegacyConfiguredContractAddress(mode),
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
      .map((roomId) => fetchRoom(mode, roomId).catch(() => null)),
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
    argueStyle?: ArgueStyle;
    profileAddress?: string | null;
  },
) {
  const client = createWalletClient(account, provider);
  const hash = await writeContractWithRetry(client, {
    address: getLegacyConfiguredContractAddress(mode),
    functionName: "create_room",
    args:
      mode === "argue"
        ? [room.roomId, room.category, room.profileAddress ?? EMPTY_ADDRESS, room.argueStyle ?? "debate"]
        : [room.roomId, room.category, room.profileAddress ?? EMPTY_ADDRESS],
    value: 0n,
  });

  void waitForReceipt(account, provider, hash, TransactionStatus.ACCEPTED).catch(() => undefined);
  return hash;
}

export async function registerLocalProfile(
  mode: ArenaMode,
  account: Address,
  provider: BrowserEthereumProvider,
  name: string,
) {
  const client = createWalletClient(account, provider);
  const hash = await writeContractWithRetry(client, {
    address: getLegacyConfiguredContractAddress(mode),
    functionName: "register_profile",
    args: [name.trim()],
    value: 0n,
  });

  return waitForReceipt(account, provider, hash);
}

export function shouldSyncStudionetProfileAlias() {
  return arenaEnv.chain === "studionet";
}

export function shouldUseLocalProfileAlias() {
  return !arenaEnv.hasVdtCoreAddress;
}

export async function joinRoom(
  mode: ArenaMode,
  account: Address,
  provider: BrowserEthereumProvider,
  roomId: string,
  profileAddress?: string | null,
) {
  const client = createWalletClient(account, provider);
  const target = await resolveRoomTarget(mode);
  if (!target) {
    throw new Error("Room does not exist.");
  }
  const args =
    profileAddress && arenaEnv.hasVdtCoreAddress ? [roomId, profileAddress] : [roomId];
  const hash = await writeContractWithRetry(client, {
    address: target.address,
    functionName: "join_room",
    args,
    value: 0n,
  });

  void waitForReceipt(account, provider, hash).catch(() => undefined);
  return hash;
}

export async function startRoom(
  mode: ArenaMode,
  account: Address,
  provider: BrowserEthereumProvider,
  roomId: string,
) {
  const client = createWalletClient(account, provider);
  const target = await resolveRoomTarget(mode);
  if (!target) {
    throw new Error("Room does not exist.");
  }
  const hash = await writeContractWithRetry(client, {
    address: target.address,
    functionName: "start_room",
    args: [roomId],
    value: 0n,
  });

  void waitForReceipt(account, provider, hash).catch(() => undefined);
  return hash;
}

export async function submitEntry(
  mode: ArenaMode,
  account: Address,
  provider: BrowserEthereumProvider,
  roomId: string,
  submission: string,
) {
  const client = createWalletClient(account, provider);
  const target = await resolveRoomTarget(mode);
  if (!target) {
    throw new Error("Room does not exist.");
  }
  const hash = await writeContractWithRetry(client, {
    address: target.address,
    functionName: "submit_entry",
    args: [roomId, submission],
    value: 0n,
  });

  void waitForReceipt(account, provider, hash).catch(() => undefined);
  return hash;
}

export async function resolveRoom(
  mode: ArenaMode,
  account: Address,
  provider: BrowserEthereumProvider,
  roomId: string,
) {
  const client = createWalletClient(account, provider);
  const target = await resolveRoomTarget(mode);
  if (!target) {
    throw new Error("Room does not exist.");
  }
  const hash = await writeContractWithRetry(client, {
    address: target.address,
    functionName: "resolve_room",
    args: [roomId],
    value: 0n,
  });

  void waitForReceipt(account, provider, hash, TransactionStatus.FINALIZED).catch(() => undefined);
  return hash;
}

export async function forfeitRoom(
  mode: ArenaMode,
  account: Address,
  provider: BrowserEthereumProvider,
  roomId: string,
) {
  const client = createWalletClient(account, provider);
  const target = await resolveRoomTarget(mode);
  if (!target) {
    throw new Error("Room does not exist.");
  }
  const hash = await writeContractWithRetry(client, {
    address: target.address,
    functionName: "forfeit_room",
    args: [roomId],
    value: 0n,
  });

  void waitForReceipt(account, provider, hash, TransactionStatus.FINALIZED).catch(() => undefined);
  return hash;
}

export function isEmptyAddress(address: string) {
  return !address || address.toLowerCase() === EMPTY_ADDRESS;
}
