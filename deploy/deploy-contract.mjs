import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createAccount, createClient } from "genlayer-js";
import { localnet, studionet, testnetAsimov, testnetBradbury } from "genlayer-js/chains";
import { TransactionStatus } from "genlayer-js/types";

const chainKey = process.env.GENLAYER_CHAIN ?? "testnetBradbury";
const gameMode = process.env.GAME_MODE ?? "debate";
const privateKey = process.env.GENLAYER_DEPLOYER_PRIVATE_KEY;
const profileContractAddress =
  process.env.PROFILE_NFT_CONTRACT_ADDRESS ?? "0x0000000000000000000000000000000000000000";
const convinceHouseStance = process.env.CONVINCE_ME_HOUSE_STANCE ?? "WhatsApp is bad.";

if (!privateKey) {
  throw new Error("Set GENLAYER_DEPLOYER_PRIVATE_KEY before deploying the contract.");
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

const contractFiles = {
  debate: { path: resolve(process.cwd(), "contracts", "debate_game.py"), args: [profileContractAddress] },
  convince: {
    path: resolve(process.cwd(), "contracts", "convince_me_game.py"),
    args: [profileContractAddress, convinceHouseStance],
  },
  quiz: { path: resolve(process.cwd(), "contracts", "quiz_game.py"), args: [profileContractAddress] },
};

if (!(gameMode in contractFiles)) {
  throw new Error(`Unsupported GAME_MODE "${gameMode}". Expected debate, convince, or quiz.`);
}

const contractTarget = contractFiles[gameMode];
const contractPath = contractTarget.path;
const contractCode = await readFile(contractPath, "utf-8");
const account = createAccount(privateKey);
const client = createClient({
  chain: chains[chainKey],
  endpoint: process.env.GENLAYER_ENDPOINT ?? chains[chainKey].rpcUrls.default.http[0],
  account,
});

const hash = await client.deployContract({
  code: contractCode,
  args: contractTarget.args,
  leaderOnly: false,
});

const receipt = await client.waitForTransactionReceipt({
  hash,
  status: TransactionStatus.ACCEPTED,
  interval: 5_000,
  retries: 90,
});

const contractAddress = receipt?.data?.contract_address;

if (!contractAddress) {
  throw new Error("Deployment completed without returning a contract address.");
}

console.log(contractAddress);
