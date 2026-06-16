import { createPublicClient, getAddress, http, isAddress, type Address } from "viem";
import { baseSepolia } from "viem/chains";
import { arenaEnv } from "@/lib/env";

// Read-only view of the Verdict Stone hub (VerdictStoneHub, an ERC721Enumerable on Base Sepolia).
// The Stone is the tradeable, level-ratcheting reputation NFT. Eligibility, minting and the
// cross-chain binding are owned by the GenLayer VerdictStone IC; this hub is the authoritative
// registry the market reads from.

const stoneHubAbi = [
  { type: "function", name: "totalSupply", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  {
    type: "function",
    name: "tokenByIndex",
    stateMutability: "view",
    inputs: [{ name: "index", type: "uint256" }],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "ownerOf",
    stateMutability: "view",
    inputs: [{ name: "tokenId", type: "uint256" }],
    outputs: [{ type: "address" }],
  },
  {
    type: "function",
    name: "balanceOf",
    stateMutability: "view",
    inputs: [{ name: "owner", type: "address" }],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "tokenOfOwnerByIndex",
    stateMutability: "view",
    inputs: [
      { name: "owner", type: "address" },
      { name: "index", type: "uint256" },
    ],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "effectiveLevelOf",
    stateMutability: "view",
    inputs: [{ name: "holder", type: "address" }],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "getStone",
    stateMutability: "view",
    inputs: [{ name: "tokenId", type: "uint256" }],
    outputs: [
      {
        type: "tuple",
        components: [
          { name: "level", type: "uint256" },
          { name: "profile", type: "bytes32" },
          { name: "location", type: "uint64" },
        ],
      },
    ],
  },
] as const;

export interface Stone {
  tokenId: string;
  level: number;
  /** GenLayer profile bound to the stone (bytes32 left-padded address). */
  profile: string;
  /** Chain id where the stone currently lives. */
  location: number;
  owner: Address;
}

const MAX_COLLECTION = 120;

function hubAddress(): Address | null {
  return arenaEnv.stoneHubAddress && isAddress(arenaEnv.stoneHubAddress)
    ? getAddress(arenaEnv.stoneHubAddress)
    : null;
}

function client() {
  return createPublicClient({ chain: baseSepolia, transport: http(arenaEnv.profileEvmRpcUrl) });
}

function profileToAddress(profile: string): string {
  // bytes32 -> the trailing 20 bytes are the bound GenLayer profile address.
  if (!profile || profile.length < 42) return "";
  return getAddress(`0x${profile.slice(-40)}`);
}

async function readStone(address: Address, tokenId: bigint): Promise<Stone> {
  const c = client();
  const [stone, owner] = await Promise.all([
    c.readContract({ address, abi: stoneHubAbi, functionName: "getStone", args: [tokenId], authorizationList: undefined }),
    c.readContract({ address, abi: stoneHubAbi, functionName: "ownerOf", args: [tokenId], authorizationList: undefined }),
  ]);
  return {
    tokenId: tokenId.toString(),
    level: Number(stone.level),
    profile: profileToAddress(stone.profile),
    location: Number(stone.location),
    owner,
  };
}

export async function fetchAllStones(): Promise<Stone[]> {
  const address = hubAddress();
  if (!address) return [];
  const c = client();
  const total = await c.readContract({ address, abi: stoneHubAbi, functionName: "totalSupply", args: [], authorizationList: undefined });
  const count = Math.min(Number(total), MAX_COLLECTION);
  const ids = await Promise.all(
    Array.from({ length: count }, (_, i) =>
      c.readContract({ address, abi: stoneHubAbi, functionName: "tokenByIndex", args: [BigInt(i)], authorizationList: undefined }),
    ),
  );
  const stones = await Promise.all(ids.map((id) => readStone(address, id)));
  return stones.sort((a, b) => b.level - a.level || Number(a.tokenId) - Number(b.tokenId));
}

export interface OwnerStones {
  stones: Stone[];
  effectiveLevel: number;
}

export async function fetchOwnerStones(owner: string): Promise<OwnerStones> {
  const address = hubAddress();
  if (!address || !isAddress(owner)) return { stones: [], effectiveLevel: 0 };
  const c = client();
  const holder = getAddress(owner);
  const [balance, effectiveLevel] = await Promise.all([
    c.readContract({ address, abi: stoneHubAbi, functionName: "balanceOf", args: [holder], authorizationList: undefined }),
    c.readContract({ address, abi: stoneHubAbi, functionName: "effectiveLevelOf", args: [holder], authorizationList: undefined }),
  ]);
  const n = Number(balance);
  const ids = await Promise.all(
    Array.from({ length: n }, (_, i) =>
      c.readContract({ address, abi: stoneHubAbi, functionName: "tokenOfOwnerByIndex", args: [holder, BigInt(i)], authorizationList: undefined }),
    ),
  );
  const stones = await Promise.all(ids.map((id) => readStone(address, id)));
  return { stones: stones.sort((a, b) => b.level - a.level), effectiveLevel: Number(effectiveLevel) };
}

// ---- presentation helpers (level -> tier) -----------------------------------

export interface StoneTier {
  name: string;
  /** hsl color for the stone facet + glow. */
  hsl: string;
  /** tailwind-ready glow shadow. */
  glow: string;
}

export function tierForLevel(level: number): StoneTier {
  if (level >= 9) return { name: "Apex", hsl: "142 71% 45%", glow: "0 0 36px hsl(142 71% 45% / 0.55)" };
  if (level >= 7) return { name: "Radiant", hsl: "45 93% 58%", glow: "0 0 32px hsl(45 93% 58% / 0.5)" };
  if (level >= 5) return { name: "Tempered", hsl: "1 77% 55%", glow: "0 0 28px hsl(1 77% 55% / 0.45)" };
  if (level >= 3) return { name: "Honed", hsl: "213 94% 68%", glow: "0 0 22px hsl(213 94% 68% / 0.4)" };
  return { name: "Rough", hsl: "0 0% 64%", glow: "0 0 16px hsl(0 0% 70% / 0.25)" };
}

export function shortProfile(value: string): string {
  if (!value || value.length < 10) return value || "unbound";
  return `${value.slice(0, 6)}…${value.slice(-4)}`;
}
