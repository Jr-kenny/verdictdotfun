import type { ArenaMode } from "@/types/arena";

const SUPPORTED_CHAINS = ["localnet", "studionet", "testnetAsimov", "testnetBradbury"] as const;
const SUPPORTED_PROFILE_CHAINS = ["baseSepolia"] as const;

export type ArenaChainKey = (typeof SUPPORTED_CHAINS)[number];
export type ProfileChainKey = (typeof SUPPORTED_PROFILE_CHAINS)[number];

function isSupportedChain(value: string | undefined): value is ArenaChainKey {
  return Boolean(value && SUPPORTED_CHAINS.includes(value as ArenaChainKey));
}

function isSupportedProfileChain(value: string | undefined): value is ProfileChainKey {
  return Boolean(value && SUPPORTED_PROFILE_CHAINS.includes(value as ProfileChainKey));
}

function cleanValue(value: string | undefined) {
  const trimmed = value?.trim() ?? "";
  return trimmed || null;
}

const chain = isSupportedChain(import.meta.env.VITE_GENLAYER_CHAIN)
  ? import.meta.env.VITE_GENLAYER_CHAIN
  : "testnetBradbury";

const contractAddresses: Record<ArenaMode, string | null> = {
  debate: cleanValue(import.meta.env.VITE_DEBATE_CONTRACT_ADDRESS),
  convince: cleanValue(import.meta.env.VITE_CONVINCE_ME_CONTRACT_ADDRESS),
  quiz: cleanValue(import.meta.env.VITE_QUIZ_CONTRACT_ADDRESS),
};

const configuredModes = (Object.entries(contractAddresses) as [ArenaMode, string | null][])
  .filter(([, address]) => Boolean(address))
  .map(([mode]) => mode);

const profileChain = isSupportedProfileChain(import.meta.env.VITE_PROFILE_NFT_CHAIN)
  ? import.meta.env.VITE_PROFILE_NFT_CHAIN
  : "baseSepolia";

export const arenaEnv = {
  chain,
  endpoint: import.meta.env.VITE_GENLAYER_ENDPOINT?.trim() || "",
  contractAddresses,
  configuredModes,
  hasConfiguredModes: configuredModes.length > 0,
  profileContractAddress: cleanValue(import.meta.env.VITE_PROFILE_NFT_CONTRACT_ADDRESS),
  hasProfileContractAddress: Boolean(cleanValue(import.meta.env.VITE_PROFILE_NFT_CONTRACT_ADDRESS)),
  profileChain,
  profileRpcUrl: import.meta.env.VITE_PROFILE_NFT_RPC_URL?.trim() || "",
} as const;
