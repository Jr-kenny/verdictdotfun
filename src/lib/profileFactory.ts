import { TransactionStatus } from "genlayer-js/types";
import type { Address } from "viem";
import { arenaEnv } from "@/lib/env";
import { createArenaClient } from "@/lib/genlayer";
import type { BrowserEthereumProvider } from "@/lib/ethereum";
import type { ArenaProfile, LeaderboardEntry } from "@/types/arena";

type JsonRecord = Record<string, unknown>;

const EMPTY_ADDRESS = "0x0000000000000000000000000000000000000000";

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

function getConfiguredFactoryAddress(): Address {
  if (!arenaEnv.vdtCoreAddress) {
    throw new Error("Missing VITE_VDT_CORE_CONTRACT_ADDRESS.");
  }

  return arenaEnv.vdtCoreAddress as Address;
}

function parseArenaProfile(raw: unknown): ArenaProfile | null {
  const record = asRecord(raw);
  const profileAddress = asString(record.profile_address);

  if (!profileAddress || profileAddress.toLowerCase() === EMPTY_ADDRESS) {
    return null;
  }

  return {
    profileAddress,
    owner: asString(record.owner) || EMPTY_ADDRESS,
    name: asString(record.handle),
    seasonId: asNumber(record.season_id),
    currentSeasonId: asNumber(record.current_season_id),
    pendingReset: asBoolean(record.pending_reset),
    rankTier: asNumber(record.rank_tier),
    rankTierName: asString(record.rank_tier_name),
    rankDivision: asNumber(record.rank_division),
    rankLabel: asString(record.rank_label),
    xp: asNumber(record.xp),
    xpRequired: asNumber(record.xp_required),
    xpToNext: asNumber(record.xp_to_next),
    totalXp: asNumber(record.total_xp),
    wins: asNumber(record.wins),
    losses: asNumber(record.losses),
    lifetimeWins: asNumber(record.lifetime_wins),
    lifetimeLosses: asNumber(record.lifetime_losses),
  };
}

async function waitForReceipt(
  account: Address,
  provider: BrowserEthereumProvider,
  hash: unknown,
  status = TransactionStatus.ACCEPTED,
) {
  const client = createArenaClient(account, provider);
  const normalizedHash = asString(hash);

  if (!normalizedHash) {
    throw new Error("The transaction did not return a valid hash.");
  }

  return client.waitForTransactionReceipt({
    hash: normalizedHash as never,
    status,
    interval: 3_000,
    retries: 90,
  });
}

export async function fetchArenaProfile(ownerAddress: Address): Promise<ArenaProfile | null> {
  if (!arenaEnv.vdtCoreAddress) {
    return null;
  }

  const client = createArenaClient();
  const raw = await client.readContract({
    address: getConfiguredFactoryAddress(),
    functionName: "get_profile",
    args: [ownerAddress],
    jsonSafeReturn: true,
  });

  return parseArenaProfile(raw);
}

export async function createArenaProfile(
  account: Address,
  provider: BrowserEthereumProvider,
  handle: string,
) {
  const client = createArenaClient(account, provider);
  const hash = await client.writeContract({
    address: getConfiguredFactoryAddress(),
    functionName: "create_profile",
    args: [handle.trim()],
    value: 0n,
  });

  return waitForReceipt(account, provider, hash);
}

export async function transferArenaProfile(
  account: Address,
  provider: BrowserEthereumProvider,
  newOwner: string,
) {
  const client = createArenaClient(account, provider);
  const hash = await client.writeContract({
    address: getConfiguredFactoryAddress(),
    functionName: "transfer_profile",
    args: [newOwner.trim()],
    value: 0n,
  });

  return waitForReceipt(account, provider, hash, TransactionStatus.FINALIZED);
}

export async function renameArenaProfile(
  profileAddress: Address,
  account: Address,
  provider: BrowserEthereumProvider,
  handle: string,
) {
  const client = createArenaClient(account, provider);
  const hash = await client.writeContract({
    address: profileAddress,
    functionName: "set_handle",
    args: [handle.trim()],
    value: 0n,
  });

  return waitForReceipt(account, provider, hash);
}

export async function fetchLeaderboard(limit = 25): Promise<LeaderboardEntry[]> {
  if (!arenaEnv.vdtCoreAddress) {
    return [];
  }

  const client = createArenaClient();
  const rawProfiles = await client.readContract({
    address: getConfiguredFactoryAddress(),
    functionName: "get_leaderboard",
    args: [limit],
    jsonSafeReturn: true,
  });

  if (!Array.isArray(rawProfiles)) {
    return [];
  }

  const entries = await Promise.all(
    rawProfiles.map(async (profileAddress, index) => {
      const rawProfile = await client.readContract({
        address: getConfiguredFactoryAddress(),
        functionName: "get_profile_by_address",
        args: [asString(profileAddress)],
        jsonSafeReturn: true,
      });

      const profile = parseArenaProfile(rawProfile);
      return profile
        ? {
            position: index + 1,
            profile,
          }
        : null;
    }),
  );

  return entries.filter(Boolean) as LeaderboardEntry[];
}
