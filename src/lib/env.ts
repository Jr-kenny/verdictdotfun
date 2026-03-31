import type { ArenaMode } from "@/types/arena";

const SUPPORTED_CHAINS = ["localnet", "studionet", "testnetAsimov", "testnetBradbury"] as const;

export type ArenaChainKey = (typeof SUPPORTED_CHAINS)[number];

function isSupportedChain(value: string | undefined): value is ArenaChainKey {
  return Boolean(value && SUPPORTED_CHAINS.includes(value as ArenaChainKey));
}

function cleanValue(value: string | undefined) {
  const trimmed = value?.trim() ?? "";
  return trimmed || null;
}

const chain = isSupportedChain(import.meta.env.VITE_GENLAYER_CHAIN)
  ? import.meta.env.VITE_GENLAYER_CHAIN
  : "studionet";

const vdtCoreAddress =
  cleanValue(import.meta.env.VITE_VERDICTDOTFUN_CONTRACT_ADDRESS) ??
  cleanValue(import.meta.env.VITE_VDT_CORE_CONTRACT_ADDRESS);

const contractAddresses: Record<ArenaMode, string | null> = {
  argue:
    cleanValue(import.meta.env.VITE_VERDICTDOTFUN_ARGUE_CONTRACT_ADDRESS) ??
    cleanValue(import.meta.env.VITE_VDT_ARGUE_CONTRACT_ADDRESS),
  riddle:
    cleanValue(import.meta.env.VITE_VERDICTDOTFUN_RIDDLE_CONTRACT_ADDRESS) ??
    cleanValue(import.meta.env.VITE_VDT_RIDDLE_CONTRACT_ADDRESS) ??
    cleanValue(import.meta.env.VITE_RIDDLE_CONTRACT_ADDRESS),
};

const configuredModes = (Object.entries(contractAddresses) as [ArenaMode, string | null][])
  .filter(([, address]) => Boolean(address))
  .map(([mode]) => mode);

export const arenaEnv = {
  chain,
  endpoint: import.meta.env.VITE_GENLAYER_ENDPOINT?.trim() || "",
  reownProjectId: cleanValue(import.meta.env.VITE_REOWN_PROJECT_ID),
  hasReownProjectId: Boolean(cleanValue(import.meta.env.VITE_REOWN_PROJECT_ID)),
  vdtCoreAddress,
  hasVdtCoreAddress: Boolean(vdtCoreAddress),
  contractAddresses,
  configuredModes,
  hasConfiguredModes: configuredModes.length > 0,
  verdictNftAddress: cleanValue(import.meta.env.VITE_VERDICT_NFT_CONTRACT_ADDRESS),
  hasVerdictNftAddress: Boolean(cleanValue(import.meta.env.VITE_VERDICT_NFT_CONTRACT_ADDRESS)),
  profileEvmRpcUrl: cleanValue(import.meta.env.VITE_BASE_SEPOLIA_RPC_URL) ?? "https://sepolia.base.org",
} as const;
