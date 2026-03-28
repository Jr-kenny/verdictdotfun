import {
  createPublicClient,
  createWalletClient,
  custom,
  getAddress,
  http,
  isAddress,
  type Address,
} from "viem";
import { baseSepolia } from "viem/chains";
import { arenaEnv } from "@/lib/env";
import type { BrowserEthereumProvider } from "@/lib/ethereum";
import type { VerdictBadge } from "@/types/arena";

const verdictNftAbi = [
  {
    type: "function",
    name: "hasBadge",
    stateMutability: "view",
    inputs: [{ name: "profileAddress", type: "address" }],
    outputs: [{ name: "", type: "bool" }],
  },
  {
    type: "function",
    name: "getBadgeByProfile",
    stateMutability: "view",
    inputs: [{ name: "profileAddress", type: "address" }],
    outputs: [
      {
        type: "tuple",
        components: [
          { name: "tokenId", type: "uint256" },
          { name: "profileAddress", type: "address" },
          { name: "handle", type: "string" },
          { name: "permanentXp", type: "uint256" },
          { name: "level", type: "uint256" },
          { name: "linked", type: "bool" },
        ],
      },
    ],
  },
  {
    type: "function",
    name: "ownerOf",
    stateMutability: "view",
    inputs: [{ name: "tokenId", type: "uint256" }],
    outputs: [{ name: "", type: "address" }],
  },
  {
    type: "function",
    name: "unlinkBadge",
    stateMutability: "nonpayable",
    inputs: [{ name: "tokenId", type: "uint256" }],
    outputs: [],
  },
] as const;

function getConfiguredVerdictNftAddress(): Address {
  if (!arenaEnv.verdictNftAddress) {
    throw new Error("Missing VITE_VERDICT_NFT_CONTRACT_ADDRESS.");
  }

  return arenaEnv.verdictNftAddress as Address;
}

function createVerdictPublicClient() {
  return createPublicClient({
    chain: baseSepolia,
    transport: http(arenaEnv.profileEvmRpcUrl),
  });
}

function createVerdictWalletClient(account: Address, provider: BrowserEthereumProvider) {
  return createWalletClient({
    account,
    chain: baseSepolia,
    transport: custom(provider),
  });
}

export async function fetchVerdictBadge(profileAddress: string): Promise<VerdictBadge | null> {
  if (!arenaEnv.verdictNftAddress || !isAddress(profileAddress)) {
    return null;
  }

  const client = createVerdictPublicClient();
  const normalizedProfile = getAddress(profileAddress);
  const hasBadge = await client.readContract({
    address: getConfiguredVerdictNftAddress(),
    abi: verdictNftAbi,
    functionName: "hasBadge",
    args: [normalizedProfile],
    authorizationList: undefined,
  });

  if (!hasBadge) {
    return null;
  }

  const badge = await client.readContract({
    address: getConfiguredVerdictNftAddress(),
    abi: verdictNftAbi,
    functionName: "getBadgeByProfile",
    args: [normalizedProfile],
    authorizationList: undefined,
  });
  const owner = await client.readContract({
    address: getConfiguredVerdictNftAddress(),
    abi: verdictNftAbi,
    functionName: "ownerOf",
    args: [badge.tokenId],
    authorizationList: undefined,
  });

  return {
    tokenId: badge.tokenId.toString(),
    profileAddress: badge.profileAddress,
    owner,
    handle: badge.handle,
    permanentXp: Number(badge.permanentXp),
    level: Number(badge.level),
    linked: badge.linked,
  };
}

export async function unlinkVerdictBadge(account: Address, provider: BrowserEthereumProvider, tokenId: string) {
  const walletClient = createVerdictWalletClient(account, provider);
  const publicClient = createVerdictPublicClient();

  const hash = await walletClient.writeContract({
    address: getConfiguredVerdictNftAddress(),
    abi: verdictNftAbi,
    functionName: "unlinkBadge",
    args: [BigInt(tokenId)],
    account,
    chain: baseSepolia,
  });

  return publicClient.waitForTransactionReceipt({ hash });
}
