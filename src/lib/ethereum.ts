import { getAddress, isAddress } from "viem";
import { getArenaChainHexId, getWalletAddChainParams } from "@/lib/genlayer";
import { getProfileChainHexId, getProfileWalletAddChainParams } from "@/lib/profileChain";

export interface BrowserEthereumProvider {
  request(args: { method: string; params?: unknown[] | object }): Promise<unknown>;
  on?(eventName: string, listener: (...args: unknown[]) => void): void;
  removeListener?(eventName: string, listener: (...args: unknown[]) => void): void;
}

interface WalletChainConfig {
  targetChainId: string;
  addChainParams: {
    chainId: string;
    chainName: string;
    nativeCurrency: { name: string; symbol: string; decimals: number };
    rpcUrls: string[];
    blockExplorerUrls: string[];
  };
  switchErrorMessage: string;
}

declare global {
  interface Window {
    ethereum?: BrowserEthereumProvider;
  }
}

export function getBrowserProvider(): BrowserEthereumProvider | null {
  if (typeof window === "undefined") {
    return null;
  }

  return window.ethereum ?? null;
}

export async function requestWalletAddress(provider: BrowserEthereumProvider): Promise<`0x${string}`> {
  const accounts = await provider.request({ method: "eth_requestAccounts" });

  if (!Array.isArray(accounts) || accounts.length === 0) {
    throw new Error("No wallet account was returned by the provider.");
  }

  const address = String(accounts[0]);

  if (!isAddress(address)) {
    throw new Error("Wallet returned an invalid address.");
  }

  return getAddress(address);
}

export async function getConnectedWalletAddress(
  provider: BrowserEthereumProvider,
): Promise<`0x${string}` | null> {
  const accounts = await provider.request({ method: "eth_accounts" });

  if (!Array.isArray(accounts) || accounts.length === 0) {
    return null;
  }

  const address = String(accounts[0]);
  return isAddress(address) ? getAddress(address) : null;
}

export async function getWalletChainId(provider: BrowserEthereumProvider): Promise<string | null> {
  const chainId = await provider.request({ method: "eth_chainId" });
  return typeof chainId === "string" ? chainId.toLowerCase() : null;
}

async function ensureWalletChain(provider: BrowserEthereumProvider, config: WalletChainConfig) {
  const targetChainId = config.targetChainId.toLowerCase();
  const currentChainId = await getWalletChainId(provider);

  if (currentChainId === targetChainId) {
    return;
  }

  try {
    await provider.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: targetChainId }],
    });
  } catch (error) {
    const providerError = error as { code?: number; message?: string };

    if (providerError?.code !== 4902) {
      throw new Error(providerError?.message || config.switchErrorMessage);
    }

    await provider.request({
      method: "wallet_addEthereumChain",
      params: [config.addChainParams],
    });

    await provider.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: targetChainId }],
    });
  }
}

export async function ensureArenaWalletChain(provider: BrowserEthereumProvider) {
  return ensureWalletChain(provider, {
    targetChainId: getArenaChainHexId(),
    addChainParams: getWalletAddChainParams(),
    switchErrorMessage: "Failed to switch the wallet to the GenLayer network.",
  });
}

export async function ensureProfileWalletChain(provider: BrowserEthereumProvider) {
  return ensureWalletChain(provider, {
    targetChainId: getProfileChainHexId(),
    addChainParams: getProfileWalletAddChainParams(),
    switchErrorMessage: "Failed to switch the wallet to the profile NFT network.",
  });
}
