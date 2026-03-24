import { createClient } from "genlayer-js";
import { localnet, studionet, testnetAsimov, testnetBradbury } from "genlayer-js/chains";
import type { Address } from "viem";
import { arenaEnv, type ArenaChainKey } from "@/lib/env";
import type { BrowserEthereumProvider } from "@/lib/ethereum";

type ArenaChain = typeof localnet;

const CHAIN_BY_KEY: Record<ArenaChainKey, ArenaChain> = {
  localnet,
  studionet,
  testnetAsimov,
  testnetBradbury,
};

export function getArenaChain() {
  return CHAIN_BY_KEY[arenaEnv.chain];
}

export function getArenaEndpoint() {
  return arenaEnv.endpoint || getArenaChain().rpcUrls.default.http[0];
}

export function getArenaChainHexId() {
  return `0x${getArenaChain().id.toString(16)}`;
}

export function getWalletAddChainParams() {
  const chain = getArenaChain();

  return {
    chainId: getArenaChainHexId(),
    chainName: chain.name,
    nativeCurrency: chain.nativeCurrency,
    rpcUrls: [getArenaEndpoint()],
    blockExplorerUrls: chain.blockExplorers?.default?.url ? [chain.blockExplorers.default.url] : [],
  };
}

export function createArenaClient(account?: Address, provider?: BrowserEthereumProvider | null) {
  return createClient({
    chain: getArenaChain(),
    endpoint: getArenaEndpoint(),
    account,
    provider: provider ?? undefined,
  });
}
