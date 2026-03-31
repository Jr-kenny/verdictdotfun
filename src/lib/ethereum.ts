import { getAddress, isAddress } from "viem";
import { getArenaChainHexId, getWalletAddChainParams } from "@/lib/genlayer";
import { getProfileChainHexId, getProfileWalletAddChainParams } from "@/lib/profileChain";

export interface BrowserEthereumProvider {
  request(args: { method: string; params?: unknown[] | object }): Promise<unknown>;
  on?(eventName: string, listener: (...args: unknown[]) => void): void;
  removeListener?(eventName: string, listener: (...args: unknown[]) => void): void;
  providers?: BrowserEthereumProvider[];
  isMetaMask?: boolean;
  isRabby?: boolean;
  isPhantom?: boolean;
  isCoinbaseWallet?: boolean;
  isBraveWallet?: boolean;
  isTrust?: boolean;
  isBinance?: boolean;
  isNightly?: boolean;
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

interface Eip6963ProviderInfo {
  uuid: string;
  name: string;
  icon: string;
  rdns: string;
}

interface Eip6963ProviderDetail {
  info: Eip6963ProviderInfo;
  provider: BrowserEthereumProvider;
}

interface Eip6963AnnounceProviderEvent extends Event {
  detail: Eip6963ProviderDetail;
}

export interface WalletOption {
  id: string;
  slug: string;
  name: string;
  icon: string | null;
  rdns: string | null;
  provider: BrowserEthereumProvider;
}

function isUnknownChainError(error: { code?: number; message?: string } | undefined) {
  const message = error?.message?.toLowerCase() ?? "";

  return (
    error?.code === 4902 ||
    message.includes("unrecognized chain id") ||
    message.includes("unknown chain") ||
    message.includes("chain has not been added") ||
    message.includes("try adding the chain")
  );
}

declare global {
  interface WindowEventMap {
    "eip6963:announceProvider": Eip6963AnnounceProviderEvent;
  }
}

function getWindowEthereum() {
  if (typeof window === "undefined") {
    return null;
  }

  return ((window as unknown) as Window & { ethereum?: BrowserEthereumProvider }).ethereum ?? null;
}

function slugifyWalletName(name: string) {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function inferWalletIdentity(
  provider: BrowserEthereumProvider,
  info?: Eip6963ProviderInfo,
): Pick<WalletOption, "slug" | "name" | "icon" | "rdns"> {
  const rdns = info?.rdns ?? null;

  if (provider.isRabby || rdns?.includes("rabby")) {
    return { slug: "rabby", name: "Rabby Wallet", icon: info?.icon ?? null, rdns };
  }

  if (provider.isPhantom || rdns?.includes("phantom")) {
    return { slug: "phantom", name: "Phantom", icon: info?.icon ?? null, rdns };
  }

  if (provider.isCoinbaseWallet || rdns?.includes("coinbase")) {
    return { slug: "coinbase", name: "Coinbase Wallet", icon: info?.icon ?? null, rdns };
  }

  if (provider.isBraveWallet || rdns?.includes("brave")) {
    return { slug: "brave", name: "Brave Wallet", icon: info?.icon ?? null, rdns };
  }

  if (provider.isTrust || rdns?.includes("trust")) {
    return { slug: "trust", name: "Trust Wallet", icon: info?.icon ?? null, rdns };
  }

  if (provider.isBinance || rdns?.includes("binance")) {
    return { slug: "binance", name: "Binance Wallet", icon: info?.icon ?? null, rdns };
  }

  if (provider.isNightly || rdns?.includes("nightly")) {
    return { slug: "nightly", name: "Nightly", icon: info?.icon ?? null, rdns };
  }

  if (provider.isMetaMask || rdns?.includes("metamask")) {
    return { slug: "metamask", name: "MetaMask", icon: info?.icon ?? null, rdns };
  }

  const name = info?.name?.trim() || "Browser Wallet";
  return {
    slug: slugifyWalletName(name),
    name,
    icon: info?.icon ?? null,
    rdns,
  };
}

function getLegacyProviders() {
  const ethereum = getWindowEthereum();

  if (!ethereum) {
    return [];
  }

  const providers = Array.isArray(ethereum.providers) && ethereum.providers.length > 0
    ? ethereum.providers
    : [ethereum];

  return providers.filter((provider, index, collection) => collection.indexOf(provider) === index);
}

function buildWalletOptions(announcedProviders: Map<string, Eip6963ProviderDetail>) {
  const walletMap = new Map<string, WalletOption>();
  const providerEntries: Array<{ provider: BrowserEthereumProvider; info?: Eip6963ProviderInfo }> = [];

  announcedProviders.forEach((detail) => {
    providerEntries.push(detail);
  });

  for (const provider of getLegacyProviders()) {
    providerEntries.push({ provider });
  }

  for (const entry of providerEntries) {
    const identity = inferWalletIdentity(entry.provider, entry.info);
    const id = identity.rdns || identity.slug;
    const existing = walletMap.get(id);

    if (!existing) {
      walletMap.set(id, {
        id,
        slug: identity.slug,
        name: identity.name,
        icon: identity.icon,
        rdns: identity.rdns,
        provider: entry.provider,
      });
      continue;
    }

    walletMap.set(id, {
      ...existing,
      icon: existing.icon || identity.icon,
      provider: existing.provider || entry.provider,
    });
  }

  return Array.from(walletMap.values()).sort((left, right) => left.name.localeCompare(right.name));
}

export function watchBrowserWallets(onChange: (wallets: WalletOption[]) => void) {
  if (typeof window === "undefined") {
    onChange([]);
    return () => undefined;
  }

  const announcedProviders = new Map<string, Eip6963ProviderDetail>();

  const emitWallets = () => {
    onChange(buildWalletOptions(announcedProviders));
  };

  const handleAnnouncement = (event: Eip6963AnnounceProviderEvent) => {
    const detail = event.detail;
    const id = detail.info.rdns || detail.info.uuid || slugifyWalletName(detail.info.name);
    announcedProviders.set(id, detail);
    emitWallets();
  };

  window.addEventListener("eip6963:announceProvider", handleAnnouncement as EventListener);
  window.dispatchEvent(new Event("eip6963:requestProvider"));
  emitWallets();

  const timer = window.setTimeout(emitWallets, 250);

  return () => {
    window.removeEventListener("eip6963:announceProvider", handleAnnouncement as EventListener);
    window.clearTimeout(timer);
  };
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

    if (!isUnknownChainError(providerError)) {
      throw new Error(providerError?.message || config.switchErrorMessage);
    }

    await provider.request({
      method: "wallet_addEthereumChain",
      params: [config.addChainParams],
    });

    const nextChainId = await getWalletChainId(provider);

    if (nextChainId !== targetChainId) {
      await provider.request({
        method: "wallet_switchEthereumChain",
        params: [{ chainId: targetChainId }],
      });
    }
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
    switchErrorMessage: "Failed to switch the wallet to the Verdict NFT network.",
  });
}
