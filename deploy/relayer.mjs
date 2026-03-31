import "dotenv/config";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createAccount, createClient } from "genlayer-js";
import { localnet, studionet, testnetAsimov, testnetBradbury } from "genlayer-js/chains";
import { TransactionStatus } from "genlayer-js/types";
import { Contract, JsonRpcProvider, Wallet } from "ethers";

const __dirname = dirname(fileURLToPath(import.meta.url));
const chainKey = process.env.GENLAYER_CHAIN ?? "testnetBradbury";
const privateKey = process.env.GENLAYER_DEPLOYER_PRIVATE_KEY;
const vdtCoreAddress =
  process.env.VERDICTDOTFUN_CONTRACT_ADDRESS ??
  process.env.VITE_VERDICTDOTFUN_CONTRACT_ADDRESS ??
  process.env.VDT_CORE_CONTRACT_ADDRESS ??
  process.env.VITE_VDT_CORE_CONTRACT_ADDRESS ??
  "";
const profileFactoryAddress = vdtCoreAddress;
const runOnce = process.env.RELAYER_RUN_ONCE === "1";
const pollIntervalMs = Number(process.env.RELAYER_POLL_INTERVAL_MS ?? "15000");
const postSyncDelayMs = Number(process.env.RELAYER_POST_SYNC_DELAY_MS ?? "4000");
const maxSyncAttempts = Number(process.env.RELAYER_MAX_SYNC_ATTEMPTS ?? "3");
const baseSepoliaRpcUrl = process.env.BASE_SEPOLIA_RPC_URL || "https://sepolia.base.org";
const verdictNftPrivateKey =
  process.env.VERDICT_NFT_RELAYER_PRIVATE_KEY ||
  process.env.BASE_SEPOLIA_PRIVATE_KEY ||
  process.env.VERDICT_NFT_OPERATOR_PRIVATE_KEY ||
  "";
const verdictNftAddress =
  process.env.VERDICT_NFT_CONTRACT_ADDRESS ||
  process.env.VITE_VERDICT_NFT_CONTRACT_ADDRESS ||
  "";
const roomFilter = parseCsv(process.env.RELAYER_ROOM_IDS);
const modeFilter = parseCsv(process.env.RELAYER_MODES);
const stateFilePath = resolve(process.cwd(), process.env.RELAYER_STATE_FILE ?? "artifacts/relayer-state.json");

if (!privateKey) {
  throw new Error("Set GENLAYER_DEPLOYER_PRIVATE_KEY before starting the relayer.");
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

const modeAddresses = Object.entries({
  argue:
    process.env.VERDICTDOTFUN_ARGUE_CONTRACT_ADDRESS ??
    process.env.VITE_VERDICTDOTFUN_ARGUE_CONTRACT_ADDRESS ??
    process.env.ARGUE_CONTRACT_ADDRESS ??
    process.env.VDT_ARGUE_CONTRACT_ADDRESS ??
    process.env.VITE_VDT_ARGUE_CONTRACT_ADDRESS,
  riddle:
    process.env.VERDICTDOTFUN_RIDDLE_CONTRACT_ADDRESS ??
    process.env.VITE_VERDICTDOTFUN_RIDDLE_CONTRACT_ADDRESS ??
    process.env.RIDDLE_CONTRACT_ADDRESS ??
    process.env.VDT_RIDDLE_CONTRACT_ADDRESS ??
    process.env.VITE_VDT_RIDDLE_CONTRACT_ADDRESS,
})
  .filter(([, address]) => !!address)
  .filter(([mode]) => modeFilter.length === 0 || modeFilter.includes(mode));

if (modeAddresses.length === 0 && !vdtCoreAddress) {
  throw new Error("No VerdictDotFun core or game contracts are configured for the relayer.");
}

const client = createClient({
  chain: chains[chainKey],
  endpoint: process.env.GENLAYER_ENDPOINT ?? chains[chainKey].rpcUrls.default.http[0],
  account: createAccount(privateKey),
});

const verdictNftAbi = [
  "function syncProfile(address profileOwner, address profileAddress, string handle, uint256 permanentXp) returns (uint256)",
  "function getBadgeByProfile(address profileAddress) view returns (tuple(uint256 tokenId,address profileAddress,string handle,uint256 permanentXp,uint256 level,bool linked))",
  "function hasBadge(address profileAddress) view returns (bool)",
  "function ownerOf(uint256 tokenId) view returns (address)",
];

const verdictNftClient =
  verdictNftAddress && verdictNftPrivateKey
    ? new Contract(verdictNftAddress, verdictNftAbi, new Wallet(verdictNftPrivateKey, new JsonRpcProvider(baseSepoliaRpcUrl)))
    : null;

if (typeof client.initializeConsensusSmartContract === "function") {
  await client.initializeConsensusSmartContract();
}

function parseCsv(value) {
  if (!value) {
    return [];
  }

  return value
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function sleep(ms) {
  return new Promise((resolveSleep) => setTimeout(resolveSleep, ms));
}

function roomKey(mode, roomId) {
  return `${mode}:${roomId}`.toUpperCase();
}

function normalizeAddress(value) {
  if (!value) {
    return "";
  }

  if (typeof value === "string") {
    return value.toLowerCase();
  }

  if (typeof value === "object") {
    return String(value.as_hex ?? value.hex ?? "").toLowerCase();
  }

  return String(value).toLowerCase();
}

function asString(value) {
  if (typeof value === "string") {
    return value;
  }
  if (typeof value === "number" || typeof value === "boolean" || typeof value === "bigint") {
    return String(value);
  }
  if (value && typeof value === "object") {
    return String(value.as_hex ?? value.hex ?? "");
  }
  return "";
}

function asNumber(value) {
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

function profileFingerprint(profile) {
  return [
    asNumber(profile.rank_tier),
    asNumber(profile.rank_division),
    asNumber(profile.xp),
    asNumber(profile.wins),
    asNumber(profile.losses),
    asNumber(profile.lifetime_wins),
    asNumber(profile.lifetime_losses),
  ].join(":");
}

function verdictFingerprint(badge) {
  if (!badge) {
    return "missing";
  }

  return [
    asString(badge.handle),
    asNumber(badge.permanentXp),
    asNumber(badge.level),
    String(Boolean(badge.linked)),
    normalizeAddress(badge.owner),
  ].join(":");
}

function getPermanentXp(profile) {
  const explicitLifetimeXp = asNumber(profile?.lifetime_xp);
  if (explicitLifetimeXp > 0) {
    return explicitLifetimeXp;
  }

  return asNumber(profile?.lifetime_wins) * 100;
}

function roomIsReadyToResolve(mode, room) {
  if (asString(room.status) === "resolved") {
    return false;
  }

  const owner = normalizeAddress(room.owner);
  const opponent = normalizeAddress(room.opponent);
  if (!owner || !opponent || opponent.endsWith("0000000000000000000000000000000000000000")) {
    return false;
  }

  if (mode === "riddle") {
    return false;
  }

  return Boolean(asString(room.owner_submission).trim() && asString(room.opponent_submission).trim());
}

function roomNeedsProfileSync(room) {
  return (
    profileFactoryAddress &&
    asString(room.status) === "resolved" &&
    normalizeAddress(room.winner) &&
    normalizeAddress(room.winner) !== "0x0000000000000000000000000000000000000000"
  );
}

async function waitForReceipt(hash, status = TransactionStatus.FINALIZED) {
  return client.waitForTransactionReceipt({
    hash,
    status,
    interval: 5_000,
    retries: 200,
  });
}

async function readRoom(mode, address, roomId) {
  return client.readContract({
    address,
    functionName: "get_room",
    args: [roomId],
    jsonSafeReturn: true,
  });
}

async function readRoomIds(address) {
  const raw = await client.readContract({
    address,
    functionName: "get_room_ids",
    args: [],
    jsonSafeReturn: true,
  });

  if (!Array.isArray(raw)) {
    return [];
  }

  return raw.map((entry) => asString(entry).trim()).filter(Boolean);
}

async function readCoreRoomMode(roomId) {
  return client.readContract({
    address: vdtCoreAddress,
    functionName: "get_room_mode",
    args: [roomId],
    jsonSafeReturn: true,
  });
}

async function readCoreRoomContract(roomId) {
  return client.readContract({
    address: vdtCoreAddress,
    functionName: "get_room_contract",
    args: [roomId],
    jsonSafeReturn: true,
  });
}

async function readProfile(profileAddress) {
  if (!profileFactoryAddress || !profileAddress) {
    return null;
  }

  return client.readContract({
    address: profileFactoryAddress,
    functionName: "get_profile_by_address",
    args: [profileAddress],
    jsonSafeReturn: true,
  });
}

async function readProfileCount() {
  if (!profileFactoryAddress) {
    return 0;
  }

  const raw = await client.readContract({
    address: profileFactoryAddress,
    functionName: "get_profile_count",
    args: [],
    jsonSafeReturn: true,
  });

  return asNumber(raw);
}

async function readProfileAt(index) {
  return client.readContract({
    address: profileFactoryAddress,
    functionName: "get_profile_at",
    args: [index],
    jsonSafeReturn: true,
  });
}

async function readVerdictBadge(profileAddress) {
  if (!verdictNftClient || !profileAddress) {
    return null;
  }

  const hasBadge = await verdictNftClient.hasBadge(profileAddress);
  if (!hasBadge) {
    return null;
  }

  const badge = await verdictNftClient.getBadgeByProfile(profileAddress);
  const owner = await verdictNftClient.ownerOf(badge.tokenId);

  return {
    tokenId: badge.tokenId,
    profileAddress: badge.profileAddress,
    handle: badge.handle,
    permanentXp: badge.permanentXp,
    level: badge.level,
    linked: badge.linked,
    owner,
  };
}

async function writeGame(address, functionName, args) {
  const hash = await client.writeContract({
    address,
    functionName,
    args,
    value: 0n,
  });

  const receipt = await waitForReceipt(hash);
  return { hash, receipt };
}

async function readState() {
  try {
    return JSON.parse(await readFile(stateFilePath, "utf-8"));
  } catch {
    return { rooms: {} };
  }
}

async function writeState(state) {
  await mkdir(dirname(stateFilePath), { recursive: true });
  await writeFile(stateFilePath, `${JSON.stringify(state, null, 2)}\n`, "utf-8");
}

async function processResolvedRoom(mode, address, roomId, room, state) {
  const key = roomKey(mode, roomId);
  const entry = state.rooms[key] ?? { syncAttempts: 0, syncCompleted: false };

  if (entry.syncCompleted) {
    return;
  }
  if (entry.syncAttempts >= maxSyncAttempts) {
    return;
  }

  const winnerAddress = normalizeAddress(room.winner);
  const loserAddress = winnerAddress === normalizeAddress(room.owner) ? normalizeAddress(room.opponent) : normalizeAddress(room.owner);
  const beforeWinner = await readProfile(winnerAddress);
  const beforeLoser = await readProfile(loserAddress);

  console.log(`[relayer] syncing profiles for ${mode}:${roomId}`);
  const { hash } = await writeGame(address, "sync_profile_results", [roomId]);
  entry.lastSyncHash = hash;
  entry.lastSyncAt = new Date().toISOString();
  entry.syncAttempts += 1;

  await sleep(postSyncDelayMs);

  const afterWinner = await readProfile(winnerAddress);
  const afterLoser = await readProfile(loserAddress);
  const changed =
    profileFingerprint(beforeWinner ?? {}) !== profileFingerprint(afterWinner ?? {}) ||
    profileFingerprint(beforeLoser ?? {}) !== profileFingerprint(afterLoser ?? {});

  entry.syncCompleted = changed;
  entry.lastObservedWinner = winnerAddress;
  entry.lastObservedLoser = loserAddress;
  entry.lastWinnerProfile = afterWinner ?? null;
  entry.lastLoserProfile = afterLoser ?? null;

  state.rooms[key] = entry;
}

async function processRoomInstance(mode, address, roomId, state) {
  const room = await readRoom(mode, address, roomId);
  if (!asString(room.id).trim()) {
    return;
  }

  const key = roomKey(mode, roomId);
  const entry = state.rooms[key] ?? { syncAttempts: 0, syncCompleted: false };
  entry.lastSeenStatus = asString(room.status);
  entry.lastSeenAt = new Date().toISOString();
  state.rooms[key] = entry;

  if (roomIsReadyToResolve(mode, room)) {
    console.log(`[relayer] resolving ${mode}:${roomId}`);
    const { hash } = await writeGame(address, "resolve_room", [roomId]);
    entry.lastResolveHash = hash;
    entry.lastResolvedAt = new Date().toISOString();
  }

  const refreshedRoom = await readRoom(mode, address, roomId);
  if (roomNeedsProfileSync(refreshedRoom)) {
    await processResolvedRoom(mode, address, roomId, refreshedRoom, state);
  }
}

async function processMode(mode, address, state) {
  const roomIds = roomFilter.length > 0 ? roomFilter : await readRoomIds(address);

  for (const roomId of roomIds) {
    await processRoomInstance(mode, address, roomId, state);
  }
}

async function processCoreRooms(state) {
  const roomIds = roomFilter.length > 0 ? roomFilter : await readRoomIds(vdtCoreAddress);

  for (const roomId of roomIds) {
    const mode = asString(await readCoreRoomMode(roomId)).trim();
    if (!mode || (modeFilter.length > 0 && !modeFilter.includes(mode))) {
      continue;
    }

    const address = asString(await readCoreRoomContract(roomId)).trim();
    if (!address) {
      continue;
    }

    await processRoomInstance(mode, address, roomId, state);
  }
}

async function syncVerdictNfts(state) {
  if (!profileFactoryAddress || !verdictNftClient) {
    return;
  }

  const totalProfiles = await readProfileCount();
  for (let index = 0; index < totalProfiles; index += 1) {
    const profileAddress = normalizeAddress(await readProfileAt(index));
    if (!profileAddress || profileAddress === "0x0000000000000000000000000000000000000000") {
      continue;
    }

    const profile = await readProfile(profileAddress);
    if (!profile) {
      continue;
    }

    const permanentXp = getPermanentXp(profile);
    const expectedOwner = normalizeAddress(profile.owner);
    const expectedHandle = asString(profile.handle);
    const badge = await readVerdictBadge(profileAddress);
    const key = `NFT:${profileAddress}`;
    const entry = state.rooms[key] ?? {};

    entry.profileOwner = expectedOwner;
    entry.profileHandle = expectedHandle;
    entry.permanentXp = permanentXp;

    if (!badge && permanentXp < 1_000) {
      state.rooms[key] = entry;
      continue;
    }

    if (badge && !badge.linked) {
      entry.badgeTokenId = String(badge.tokenId);
      entry.badgeLinked = false;
      entry.badgeOwner = normalizeAddress(badge.owner);
      entry.lastSeenAt = new Date().toISOString();
      state.rooms[key] = entry;
      continue;
    }

    const before = verdictFingerprint(badge);
    const needsSync =
      !badge ||
      asString(badge.handle) !== expectedHandle ||
      asNumber(badge.permanentXp) !== permanentXp ||
      normalizeAddress(badge.owner) !== expectedOwner;

    if (!needsSync) {
      entry.badgeTokenId = badge ? String(badge.tokenId) : null;
      entry.badgeLinked = badge ? Boolean(badge.linked) : true;
      entry.badgeOwner = badge ? normalizeAddress(badge.owner) : expectedOwner;
      entry.lastSeenAt = new Date().toISOString();
      state.rooms[key] = entry;
      continue;
    }

    console.log(`[relayer] syncing verdict nft for ${profileAddress}`);
    const tx = await verdictNftClient.syncProfile(expectedOwner, profileAddress, expectedHandle, BigInt(permanentXp));
    const receipt = await tx.wait();
    const afterBadge = await readVerdictBadge(profileAddress);

    entry.badgeTokenId = afterBadge ? String(afterBadge.tokenId) : null;
    entry.badgeLinked = afterBadge ? Boolean(afterBadge.linked) : true;
    entry.badgeOwner = afterBadge ? normalizeAddress(afterBadge.owner) : expectedOwner;
    entry.lastVerdictNftHash = receipt?.hash ?? tx.hash;
    entry.lastVerdictNftAt = new Date().toISOString();
    entry.synced = before !== verdictFingerprint(afterBadge);
    state.rooms[key] = entry;
  }
}

async function runCycle(state) {
  if (modeAddresses.length > 0) {
    for (const [mode, address] of modeAddresses) {
      await processMode(mode, address, state);
    }
  } else if (vdtCoreAddress) {
    await processCoreRooms(state);
  }

  await syncVerdictNfts(state);

  await writeState(state);
}

const state = await readState();

if (runOnce) {
  await runCycle(state);
  console.log("[relayer] one-shot cycle complete");
} else {
  while (true) {
    try {
      await runCycle(state);
    } catch (error) {
      console.error("[relayer] cycle failed", error);
    }

    await sleep(pollIntervalMs);
  }
}
