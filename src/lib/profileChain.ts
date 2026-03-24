import { baseSepolia } from "viem/chains";
import { arenaEnv } from "@/lib/env";

const PROFILE_CHAIN_BY_KEY = {
  baseSepolia,
};

export function getProfileChain() {
  return PROFILE_CHAIN_BY_KEY[arenaEnv.profileChain];
}

export function getProfileRpcUrl() {
  return arenaEnv.profileRpcUrl || getProfileChain().rpcUrls.default.http[0];
}

export function getProfileChainHexId() {
  return `0x${getProfileChain().id.toString(16)}`;
}

export function getProfileWalletAddChainParams() {
  const chain = getProfileChain();

  return {
    chainId: getProfileChainHexId(),
    chainName: chain.name,
    nativeCurrency: chain.nativeCurrency,
    rpcUrls: [getProfileRpcUrl()],
    blockExplorerUrls: chain.blockExplorers?.default?.url ? [chain.blockExplorers.default.url] : [],
  };
}
