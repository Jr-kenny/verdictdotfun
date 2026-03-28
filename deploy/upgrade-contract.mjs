import "dotenv/config";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createAccount, createClient } from "genlayer-js";
import { localnet, studionet, testnetAsimov, testnetBradbury } from "genlayer-js/chains";
import { TransactionStatus } from "genlayer-js/types";

const chainKey = process.env.GENLAYER_CHAIN ?? "studionet";
const privateKey = process.env.GENLAYER_DEPLOYER_PRIVATE_KEY;
const upgradeTarget = process.env.UPGRADE_TARGET ?? "vdt-core";
const vdtCoreAddress = process.env.VDT_CORE_CONTRACT_ADDRESS ?? process.env.VITE_VDT_CORE_CONTRACT_ADDRESS;

if (!privateKey) {
  throw new Error("Set GENLAYER_DEPLOYER_PRIVATE_KEY before upgrading contracts.");
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

const contracts = {
  "vdt-core": {
    address: vdtCoreAddress,
    path: resolve(process.cwd(), "contracts", "vdt_core.py"),
  },
};

const contractPaths = {
  playerProfile: resolve(process.cwd(), "contracts", "player_profile.py"),
  debate: resolve(process.cwd(), "contracts", "debate_game.py"),
  convince: resolve(process.cwd(), "contracts", "convince_me_game.py"),
  quiz: resolve(process.cwd(), "contracts", "quiz_game.py"),
  riddle: resolve(process.cwd(), "contracts", "riddle_game.py"),
};

const selectedContracts = upgradeTarget === "all" ? Object.entries(contracts) : Object.entries(contracts).filter(([name]) => name === upgradeTarget);

if (selectedContracts.length === 0) {
  throw new Error('Set UPGRADE_TARGET to "all" or "vdt-core".');
}

async function waitForReceipt(hash, status = TransactionStatus.FINALIZED) {
  const receipt = await client.waitForTransactionReceipt({
    hash,
    status,
    interval: 5_000,
    retries: 200,
  });

  const actualStatus = receipt?.statusName ?? receipt?.status;
  const acceptedStatuses =
    status === TransactionStatus.FINALIZED
      ? [TransactionStatus.FINALIZED]
      : [TransactionStatus.ACCEPTED, TransactionStatus.FINALIZED];

  if (!acceptedStatuses.includes(actualStatus)) {
    throw new Error(`Transaction ${hash} reached ${actualStatus ?? "UNKNOWN"} instead of ${status}.`);
  }

  return receipt;
}

async function writeContract(address, functionName, args = [], status = TransactionStatus.ACCEPTED) {
  const hash = await client.writeContract({
    address,
    functionName,
    args,
    value: 0n,
  });

  return waitForReceipt(hash, status);
}

for (const [name, config] of selectedContracts) {
  if (!config.address) {
    console.warn(`[upgrade] skipping ${name}; no configured address`);
    continue;
  }

  const code = await readFile(config.path, "utf-8");
  const hash = await client.writeContract({
    address: config.address,
    functionName: "upgrade",
    args: [Buffer.from(code, "utf-8")],
    value: 0n,
  });

  await waitForReceipt(hash, TransactionStatus.FINALIZED);

  if (name === "vdt-core") {
    const [playerProfileCode, debateCode, convinceCode, quizCode, riddleCode] = await Promise.all([
      readFile(contractPaths.playerProfile, "utf-8"),
      readFile(contractPaths.debate, "utf-8"),
      readFile(contractPaths.convince, "utf-8"),
      readFile(contractPaths.quiz, "utf-8"),
      readFile(contractPaths.riddle, "utf-8"),
    ]);

    await writeContract(config.address, "set_profile_code", [playerProfileCode]);
    await writeContract(config.address, "set_room_code", ["debate", debateCode]);
    await writeContract(config.address, "set_room_code", ["convince", convinceCode]);
    await writeContract(config.address, "set_room_code", ["quiz", quizCode]);
    await writeContract(config.address, "set_room_code", ["riddle", riddleCode]);
  }

  console.log(JSON.stringify({ contract: name, address: config.address, hash }, null, 2));
}
