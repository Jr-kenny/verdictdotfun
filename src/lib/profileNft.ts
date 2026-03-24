import { createPublicClient, createWalletClient, custom, http, type Address, type Hash } from "viem";
import { arenaEnv } from "@/lib/env";
import type { BrowserEthereumProvider } from "@/lib/ethereum";
import { getProfileChain, getProfileRpcUrl } from "@/lib/profileChain";
import type { ArenaProfile } from "@/types/arena";

const profileNftAbi = [
  {
    type: "function",
    stateMutability: "view",
    name: "hasProfile",
    inputs: [{ name: "owner", type: "address" }],
    outputs: [{ name: "", type: "bool" }],
  },
  {
    type: "function",
    stateMutability: "view",
    name: "getProfile",
    inputs: [{ name: "owner", type: "address" }],
    outputs: [
      {
        name: "",
        type: "tuple",
        components: [
          { name: "tokenId", type: "uint256" },
          { name: "handle", type: "string" },
          { name: "xp", type: "uint256" },
          { name: "wins", type: "uint256" },
          { name: "losses", type: "uint256" },
          { name: "level", type: "uint256" },
        ],
      },
    ],
  },
  {
    type: "function",
    stateMutability: "nonpayable",
    name: "mintProfile",
    inputs: [{ name: "handle", type: "string" }],
    outputs: [{ name: "tokenId", type: "uint256" }],
  },
] as const;

function getConfiguredProfileContractAddress(): Address {
  if (!arenaEnv.profileContractAddress) {
    throw new Error("Missing VITE_PROFILE_NFT_CONTRACT_ADDRESS.");
  }

  return arenaEnv.profileContractAddress as Address;
}

function createProfilePublicClient() {
  return createPublicClient({
    chain: getProfileChain(),
    transport: http(getProfileRpcUrl()),
  });
}

function createProfileWalletClient(account: Address, provider: BrowserEthereumProvider) {
  return createWalletClient({
    account,
    chain: getProfileChain(),
    transport: custom(provider),
  });
}

function readStructField(value: unknown, key: string, index: number) {
  if (Array.isArray(value)) {
    return value[index];
  }

  if (value && typeof value === "object") {
    return (value as Record<string, unknown>)[key];
  }

  return undefined;
}

function toNumber(value: unknown) {
  if (typeof value === "bigint") {
    return Number(value);
  }

  if (typeof value === "number") {
    return value;
  }

  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  return 0;
}

export async function fetchProfileNft(address: Address): Promise<ArenaProfile | null> {
  if (!arenaEnv.profileContractAddress) {
    return null;
  }

  const client = createProfilePublicClient();
  const contractAddress = getConfiguredProfileContractAddress();
  const hasProfile = await client.readContract({
    address: contractAddress,
    abi: profileNftAbi,
    functionName: "hasProfile",
    args: [address],
  } as never);

  if (!hasProfile) {
    return null;
  }

  const profile = await client.readContract({
    address: contractAddress,
    abi: profileNftAbi,
    functionName: "getProfile",
    args: [address],
  } as never);

  return {
    tokenId: toNumber(readStructField(profile, "tokenId", 0)),
    name: String(readStructField(profile, "handle", 1) ?? ""),
    xp: toNumber(readStructField(profile, "xp", 2)),
    wins: toNumber(readStructField(profile, "wins", 3)),
    losses: toNumber(readStructField(profile, "losses", 4)),
    level: toNumber(readStructField(profile, "level", 5)),
  };
}

export async function mintProfileNft(
  account: Address,
  provider: BrowserEthereumProvider,
  handle: string,
) {
  const walletClient = createProfileWalletClient(account, provider);
  const hash = await walletClient.writeContract({
    address: getConfiguredProfileContractAddress(),
    abi: profileNftAbi,
    functionName: "mintProfile",
    args: [handle],
    account,
    chain: getProfileChain(),
  } as never);

  const publicClient = createProfilePublicClient();
  return publicClient.waitForTransactionReceipt({
    hash: hash as Hash,
    confirmations: 1,
    pollingInterval: 3_000,
  });
}
