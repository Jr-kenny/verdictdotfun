import { baseSepolia } from "viem/chains";
import { arenaEnv } from "@/lib/env";
import { getArenaChain, getArenaChainHexId, getArenaEndpoint, getWalletAddChainParams } from "@/lib/genlayer";

function shouldUseVerdictNftChain() {
  return arenaEnv.hasVerdictNftAddress;
}

export function getProfileChain() {
  if (shouldUseVerdictNftChain()) {
    return baseSepolia;
  }
  return getArenaChain();
}

export function getProfileRpcUrl() {
  if (shouldUseVerdictNftChain()) {
    return arenaEnv.profileEvmRpcUrl;
  }
  return getArenaEndpoint();
}

export function getProfileChainHexId() {
  if (shouldUseVerdictNftChain()) {
    return `0x${baseSepolia.id.toString(16)}`;
  }
  return getArenaChainHexId();
}

export function getProfileWalletAddChainParams() {
  if (shouldUseVerdictNftChain()) {
    return {
      chainId: `0x${baseSepolia.id.toString(16)}`,
      chainName: baseSepolia.name,
      nativeCurrency: baseSepolia.nativeCurrency,
      rpcUrls: [arenaEnv.profileEvmRpcUrl],
      blockExplorerUrls: baseSepolia.blockExplorers?.default?.url ? [baseSepolia.blockExplorers.default.url] : [],
    };
  }
  return getWalletAddChainParams();
}
