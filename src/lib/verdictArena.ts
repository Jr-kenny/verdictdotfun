import { TransactionStatus } from "genlayer-js/types";
import { getAddress, isAddress } from "viem";
import type { Address } from "viem";
import { arenaEnv } from "@/lib/env";
import { createArenaClient } from "@/lib/genlayer";
import type { BrowserEthereumProvider } from "@/lib/ethereum";
import type { ArenaMode, ArenaRoom, ArenaRoomStatus, QuizPlayerState, QuizQuestionState } from "@/types/arena";

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

function getConfiguredCoreAddress(): Address {
  if (!arenaEnv.vdtCoreAddress) {
    throw new Error("Missing VITE_VDT_CORE_CONTRACT_ADDRESS.");
  }

  return arenaEnv.vdtCoreAddress as Address;
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

function parseRoom(mode: ArenaMode, raw: unknown): ArenaRoom | null {
  const record = asRecord(raw);
  const id = asString(record.id).trim();

  if (!id) {
    return null;
  }

  return {
    id,
    mode,
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
    materialBody: record.material_body === undefined ? undefined : asString(record.material_body),
    questionCount: record.question_count === undefined ? undefined : asNumber(record.question_count),
    currentQuestionIndex:
      record.current_question_index === undefined ? undefined : asNumber(record.current_question_index),
    ownerQuestionsSecured:
      record.owner_questions_secured === undefined ? undefined : asNumber(record.owner_questions_secured),
    opponentQuestionsSecured:
      record.opponent_questions_secured === undefined ? undefined : asNumber(record.opponent_questions_secured),
    ownerAttemptsUsed:
      record.owner_attempts_used === undefined ? undefined : asNumber(record.owner_attempts_used),
    opponentAttemptsUsed:
      record.opponent_attempts_used === undefined ? undefined : asNumber(record.opponent_attempts_used),
    ownerReady: record.owner_ready === undefined ? undefined : asBoolean(record.owner_ready),
    opponentReady: record.opponent_ready === undefined ? undefined : asBoolean(record.opponent_ready),
    currentTurn: record.current_turn === undefined ? undefined : asAddressString(record.current_turn),
    revealedAnswer: record.revealed_answer === undefined ? undefined : asString(record.revealed_answer),
    accepted: record.accepted === undefined ? undefined : asBoolean(record.accepted),
    ownerLastResult: record.owner_last_result === undefined ? undefined : asString(record.owner_last_result),
    opponentLastResult: record.opponent_last_result === undefined ? undefined : asString(record.opponent_last_result),
  };
}

function parseQuizPlayerState(raw: unknown): QuizPlayerState {
  const record = asRecord(raw);
  const role = asString(record.role) === "opponent" ? "opponent" : "owner";

  return {
    role,
    ready: asBoolean(record.ready),
    questionsSecured: asNumber(record.questions_secured),
    attemptsUsed: asNumber(record.attempts_used),
    attemptsRemaining: asNumber(record.attempts_remaining),
    totalQuestions: asNumber(record.total_questions),
    questionIndex: asNumber(record.question_index),
    status: asStatus(record.status),
    latestSubmission: asString(record.latest_submission),
    waitingOnOther: asBoolean(record.waiting_on_other),
    canAnswer: asBoolean(record.can_answer),
  };
}

function parseQuizQuestionState(raw: unknown): QuizQuestionState {
  const record = asRecord(raw);
  return {
    questionIndex: asNumber(record.question_index),
    question: asString(record.question),
    options: Array.isArray(record.options) ? record.options.map((value) => asString(value)) : [],
    revealedAnswer: asString(record.revealed_answer),
    currentTurn: asString(record.current_turn),
  };
}

function createWalletClient(account: Address, provider: BrowserEthereumProvider) {
  return createArenaClient(account, provider);
}

async function fetchRoomContractAddress(roomId: string) {
  const client = createArenaClient();
  const raw = await readContractWithRetry(() =>
    client.readContract({
      address: getConfiguredCoreAddress(),
      functionName: "get_room_contract",
      args: [roomId],
      jsonSafeReturn: true,
    }),
  );

  return asAddressString(raw) || EMPTY_ADDRESS;
}

async function fetchRegisteredRoomMode(roomId: string): Promise<ArenaMode | null> {
  const client = createArenaClient();
  const raw = await readContractWithRetry(() =>
    client.readContract({
      address: getConfiguredCoreAddress(),
      functionName: "get_room_mode",
      args: [roomId],
      jsonSafeReturn: true,
    }),
  );

  const mode = asString(raw);
  return mode === "debate" || mode === "convince" || mode === "quiz" || mode === "riddle" ? mode : null;
}

async function fetchAllRegisteredRoomIds() {
  const client = createArenaClient();
  const rawIds = await readContractWithRetry(() =>
    client.readContract({
      address: getConfiguredCoreAddress(),
      functionName: "get_room_ids",
      args: [],
      jsonSafeReturn: true,
    }),
  );

  if (!Array.isArray(rawIds)) {
    return [] as string[];
  }

  return rawIds.map((value) => asString(value).trim()).filter(Boolean);
}

async function fetchCoreRoomIndex() {
  const roomIds = await fetchAllRegisteredRoomIds();
  const indexedRooms: { roomId: string; mode: ArenaMode; address: Address }[] = [];

  for (const roomId of roomIds) {
    const mode = await fetchRegisteredRoomMode(roomId);
    if (!mode) {
      continue;
    }

    const address = await fetchRoomContractAddress(roomId);
    if (isEmptyAddress(address)) {
      continue;
    }

    indexedRooms.push({ roomId, mode, address: address as Address });
  }

  return indexedRooms;
}

async function fetchRoomByTarget(target: { address: Address; mode: ArenaMode }, roomId: string) {
  const client = createArenaClient();
  let raw: unknown;

  try {
    raw = await client.readContract({
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

async function resolveRoomTarget(mode: ArenaMode, roomId: string) {
  if (!arenaEnv.hasVdtCoreAddress) {
    return {
      address: getLegacyConfiguredContractAddress(mode),
      mode,
    };
  }

  const roomAddress = await fetchRoomContractAddress(roomId);
  if (isEmptyAddress(roomAddress)) {
    return null;
  }

  const resolvedMode = (await fetchRegisteredRoomMode(roomId)) ?? mode;
  return {
    address: roomAddress as Address,
    mode: resolvedMode,
  };
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
  const address = arenaEnv.hasVdtCoreAddress ? getConfiguredCoreAddress() : getLegacyConfiguredContractAddress(mode);

  try {
    return await client.getContractSchema(address);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);

    // Studionet currently serves contract reads but not schema introspection.
    if (!message.includes("Contract schema is not supported on this network")) {
      throw error;
    }

    await client.readContract({
      address,
      functionName: "get_room_ids",
      args: [],
      jsonSafeReturn: true,
    });

    return null;
  }
}

export async function fetchRoom(mode: ArenaMode, roomId: string) {
  const target = await resolveRoomTarget(mode, roomId);
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
    "The room transaction was accepted, but Studionet has not exposed the child room contract yet. Try again in a little while.",
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
  if (!arenaEnv.hasVdtCoreAddress) {
    const client = createArenaClient();
    const rawIds = await client.readContract({
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

  const roomIds = await fetchAllRegisteredRoomIds();
  const modes = await Promise.all(roomIds.map((roomId) => fetchRegisteredRoomMode(roomId)));
  const filteredRoomIds = roomIds.filter((_, index) => modes[index] === mode);
  const rooms = await Promise.all(filteredRoomIds.map((roomId) => fetchRoom(mode, roomId)));
  return rooms.filter(Boolean) as ArenaRoom[];
}

export async function fetchAllRooms(modes: ArenaMode[]) {
  if (arenaEnv.hasVdtCoreAddress) {
    const indexedRooms = await fetchCoreRoomIndex();
    const rooms = await Promise.all(
      indexedRooms
        .filter((entry) => modes.includes(entry.mode))
        .map((entry) => fetchRoomByTarget({ address: entry.address, mode: entry.mode }, entry.roomId).catch(() => null)),
    );

    return rooms.filter(Boolean) as ArenaRoom[];
  }

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
    profileAddress?: string | null;
  },
) {
  const client = createWalletClient(account, provider);
  const args = arenaEnv.hasVdtCoreAddress
    ? [mode, room.roomId, room.category, room.profileAddress ?? EMPTY_ADDRESS]
    : room.profileAddress && arenaEnv.hasProfileFactoryAddress
      ? [room.roomId, room.category, room.profileAddress]
      : [room.roomId, room.category];
  const hash = await writeContractWithRetry(client, {
    address: arenaEnv.hasVdtCoreAddress ? getConfiguredCoreAddress() : getLegacyConfiguredContractAddress(mode),
    functionName: "create_room",
    args,
    value: 0n,
  });

  return waitForReceipt(account, provider, hash);
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
  const target = await resolveRoomTarget(mode, roomId);
  if (!target) {
    throw new Error("Room does not exist.");
  }
  const args = profileAddress && arenaEnv.hasProfileFactoryAddress ? [roomId, profileAddress] : [roomId];
  const hash = await writeContractWithRetry(client, {
    address: target.address,
    functionName: "join_room",
    args,
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
  const target = await resolveRoomTarget(mode, roomId);
  if (!target) {
    throw new Error("Room does not exist.");
  }
  const hash = await writeContractWithRetry(client, {
    address: target.address,
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
  const target = await resolveRoomTarget(mode, roomId);
  if (!target) {
    throw new Error("Room does not exist.");
  }
  const hash = await writeContractWithRetry(client, {
    address: target.address,
    functionName: "resolve_room",
    args: [roomId],
    value: 0n,
  });

  return waitForReceipt(account, provider, hash, TransactionStatus.FINALIZED);
}

export async function forfeitRoom(
  mode: ArenaMode,
  account: Address,
  provider: BrowserEthereumProvider,
  roomId: string,
) {
  const client = createWalletClient(account, provider);
  const target = await resolveRoomTarget(mode, roomId);
  if (!target) {
    throw new Error("Room does not exist.");
  }
  const hash = await writeContractWithRetry(client, {
    address: target.address,
    functionName: "forfeit_room",
    args: [roomId],
    value: 0n,
  });

  return waitForReceipt(account, provider, hash, TransactionStatus.FINALIZED);
}

export async function fetchQuizPlayerState(roomId: string, player: Address) {
  const target = await resolveRoomTarget("quiz", roomId);
  if (!target) {
    throw new Error("Room does not exist.");
  }
  const client = createArenaClient();
  const raw = await client.readContract({
    address: target.address,
    functionName: "get_player_state",
    args: [roomId, player],
    jsonSafeReturn: true,
  });

  return parseQuizPlayerState(raw);
}

export async function fetchQuizQuestion(roomId: string) {
  const target = await resolveRoomTarget("quiz", roomId);
  if (!target) {
    throw new Error("Room does not exist.");
  }
  const client = createArenaClient();
  const raw = await client.readContract({
    address: target.address,
    functionName: "get_current_question",
    args: [roomId],
    jsonSafeReturn: true,
  });

  return parseQuizQuestionState(raw);
}

export async function acceptQuizRoom(
  account: Address,
  provider: BrowserEthereumProvider,
  roomId: string,
) {
  const client = createWalletClient(account, provider);
  const target = await resolveRoomTarget("quiz", roomId);
  if (!target) {
    throw new Error("Room does not exist.");
  }
  const hash = await writeContractWithRetry(client, {
    address: target.address,
    functionName: "accept_room",
    args: [roomId],
    value: 0n,
  });

  return waitForReceipt(account, provider, hash);
}

export async function startQuiz(
  account: Address,
  provider: BrowserEthereumProvider,
  roomId: string,
) {
  const client = createWalletClient(account, provider);
  const target = await resolveRoomTarget("quiz", roomId);
  if (!target) {
    throw new Error("Room does not exist.");
  }
  const hash = await writeContractWithRetry(client, {
    address: target.address,
    functionName: "start_quiz",
    args: [roomId],
    value: 0n,
  });

  return waitForReceipt(account, provider, hash, TransactionStatus.FINALIZED);
}

export async function readyQuiz(
  account: Address,
  provider: BrowserEthereumProvider,
  roomId: string,
) {
  const client = createWalletClient(account, provider);
  const target = await resolveRoomTarget("quiz", roomId);
  if (!target) {
    throw new Error("Room does not exist.");
  }
  const hash = await writeContractWithRetry(client, {
    address: target.address,
    functionName: "ready_up",
    args: [roomId],
    value: 0n,
  });

  return waitForReceipt(account, provider, hash);
}

export async function submitQuizAnswer(
  account: Address,
  provider: BrowserEthereumProvider,
  roomId: string,
  questionIndex: number,
  optionIndex: number,
) {
  const client = createWalletClient(account, provider);
  const target = await resolveRoomTarget("quiz", roomId);
  if (!target) {
    throw new Error("Room does not exist.");
  }
  const hash = await writeContractWithRetry(client, {
    address: target.address,
    functionName: "submit_entry",
    args: [roomId, questionIndex, optionIndex],
    value: 0n,
  });

  return waitForReceipt(account, provider, hash);
}

export function isEmptyAddress(address: string) {
  return !address || address.toLowerCase() === EMPTY_ADDRESS;
}
