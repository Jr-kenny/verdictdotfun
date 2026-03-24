import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import type { ContractSchema } from "genlayer-js/types";
import type { Address } from "viem";
import { arenaEnv } from "@/lib/env";
import { ARENA_MODES } from "@/lib/gameModes";
import {
  ensureArenaWalletChain,
  ensureProfileWalletChain,
  getBrowserProvider,
  getConnectedWalletAddress,
  getWalletChainId,
  requestWalletAddress,
  type BrowserEthereumProvider,
} from "@/lib/ethereum";
import { getArenaChain, getArenaChainHexId, getArenaEndpoint } from "@/lib/genlayer";
import { getProfileChain, getProfileChainHexId, getProfileRpcUrl } from "@/lib/profileChain";
import { fetchContractSchema } from "@/lib/verdictArena";
import type { ArenaMode } from "@/types/arena";

type ContractStatus = "missing-config" | "checking" | "ready" | "error";
type NetworkStatus = "unknown" | "ready" | "wrong-network";

interface GameContractState {
  address: string | null;
  status: ContractStatus;
  error: string | null;
  schema: ContractSchema | null;
}

interface ArenaContextValue {
  walletAddress: Address | null;
  provider: BrowserEthereumProvider | null;
  connectWallet: () => Promise<void>;
  disconnectWallet: () => void;
  ensureArenaNetwork: () => Promise<void>;
  ensureProfileNetwork: () => Promise<void>;
  walletChainId: string | null;
  walletArenaStatus: NetworkStatus;
  walletProfileStatus: NetworkStatus;
  gameContracts: Record<ArenaMode, GameContractState>;
  readyModes: ArenaMode[];
  configuredModes: ArenaMode[];
  profileContractAddress: string | null;
  profileContractConfigured: boolean;
  chain: string;
  endpoint: string;
  profileChain: string;
  profileEndpoint: string;
}

const ArenaContext = createContext<ArenaContextValue | null>(null);

function buildInitialGameContracts(): Record<ArenaMode, GameContractState> {
  return {
    debate: {
      address: arenaEnv.contractAddresses.debate,
      status: arenaEnv.contractAddresses.debate ? "checking" : "missing-config",
      error: arenaEnv.contractAddresses.debate ? null : "Set VITE_DEBATE_CONTRACT_ADDRESS after deployment.",
      schema: null,
    },
    convince: {
      address: arenaEnv.contractAddresses.convince,
      status: arenaEnv.contractAddresses.convince ? "checking" : "missing-config",
      error: arenaEnv.contractAddresses.convince ? null : "Set VITE_CONVINCE_ME_CONTRACT_ADDRESS after deployment.",
      schema: null,
    },
    quiz: {
      address: arenaEnv.contractAddresses.quiz,
      status: arenaEnv.contractAddresses.quiz ? "checking" : "missing-config",
      error: arenaEnv.contractAddresses.quiz ? null : "Set VITE_QUIZ_CONTRACT_ADDRESS after deployment.",
      schema: null,
    },
  };
}

export function ArenaProvider({ children }: { children: ReactNode }) {
  const [provider, setProvider] = useState<BrowserEthereumProvider | null>(null);
  const [walletAddress, setWalletAddress] = useState<Address | null>(null);
  const [walletChainId, setWalletChainId] = useState<string | null>(null);
  const [walletArenaStatus, setWalletArenaStatus] = useState<NetworkStatus>("unknown");
  const [walletProfileStatus, setWalletProfileStatus] = useState<NetworkStatus>("unknown");
  const [gameContracts, setGameContracts] = useState<Record<ArenaMode, GameContractState>>(buildInitialGameContracts);

  function updateWalletStatuses(chainId: string | null) {
    if (!chainId) {
      setWalletArenaStatus("unknown");
      setWalletProfileStatus("unknown");
      return;
    }

    const normalized = chainId.toLowerCase();
    setWalletArenaStatus(normalized === getArenaChainHexId().toLowerCase() ? "ready" : "wrong-network");
    setWalletProfileStatus(normalized === getProfileChainHexId().toLowerCase() ? "ready" : "wrong-network");
  }

  useEffect(() => {
    const nextProvider = getBrowserProvider();
    setProvider(nextProvider);
  }, []);

  useEffect(() => {
    if (!provider) {
      return;
    }

    let cancelled = false;

    void (async () => {
      try {
        const [connectedAddress, chainId] = await Promise.all([
          getConnectedWalletAddress(provider),
          getWalletChainId(provider),
        ]);

        if (!cancelled) {
          setWalletAddress(connectedAddress);
          setWalletChainId(chainId);
          updateWalletStatuses(chainId);
        }
      } catch {
        if (!cancelled) {
          setWalletAddress(null);
          setWalletChainId(null);
          updateWalletStatuses(null);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [provider]);

  useEffect(() => {
    if (!provider?.on) {
      return;
    }

    const handleAccountsChanged = async () => {
      const connectedAddress = await getConnectedWalletAddress(provider);
      setWalletAddress(connectedAddress);
    };

    const handleChainChanged = (nextChainId: unknown) => {
      const chainId = typeof nextChainId === "string" ? nextChainId.toLowerCase() : null;
      setWalletChainId(chainId);
      updateWalletStatuses(chainId);
    };

    provider.on("accountsChanged", handleAccountsChanged);
    provider.on("chainChanged", handleChainChanged);

    return () => {
      provider.removeListener?.("accountsChanged", handleAccountsChanged);
      provider.removeListener?.("chainChanged", handleChainChanged);
    };
  }, [provider]);

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      const nextState = buildInitialGameContracts();

      await Promise.all(
        ARENA_MODES.map(async (mode) => {
          if (!arenaEnv.contractAddresses[mode]) {
            return;
          }

          try {
            const schema = await fetchContractSchema(mode);

            if (!cancelled) {
              nextState[mode] = {
                address: arenaEnv.contractAddresses[mode],
                status: "ready",
                error: null,
                schema,
              };
            }
          } catch (error) {
            if (!cancelled) {
              nextState[mode] = {
                address: arenaEnv.contractAddresses[mode],
                status: "error",
                error: error instanceof Error ? error.message : "Unable to load the contract schema.",
                schema: null,
              };
            }
          }
        }),
      );

      if (!cancelled) {
        setGameContracts(nextState);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  async function ensureArenaNetwork() {
    if (!provider) {
      throw new Error("No browser wallet was detected. Install MetaMask or a compatible EIP-1193 wallet.");
    }

    await ensureArenaWalletChain(provider);
    const chainId = await getWalletChainId(provider);
    setWalletChainId(chainId);
    updateWalletStatuses(chainId);
  }

  async function ensureProfileNetwork() {
    if (!provider) {
      throw new Error("No browser wallet was detected. Install MetaMask or a compatible EIP-1193 wallet.");
    }

    await ensureProfileWalletChain(provider);
    const chainId = await getWalletChainId(provider);
    setWalletChainId(chainId);
    updateWalletStatuses(chainId);
  }

  async function connectWallet() {
    if (!provider) {
      throw new Error("No browser wallet was detected. Install MetaMask or a compatible EIP-1193 wallet.");
    }

    await ensureArenaNetwork();
    const address = await requestWalletAddress(provider);
    setWalletAddress(address);
  }

  function disconnectWallet() {
    setWalletAddress(null);
  }

  const readyModes = ARENA_MODES.filter((mode) => gameContracts[mode].status === "ready");

  return (
    <ArenaContext.Provider
      value={{
        walletAddress,
        provider,
        connectWallet,
        disconnectWallet,
        ensureArenaNetwork,
        ensureProfileNetwork,
        walletChainId,
        walletArenaStatus,
        walletProfileStatus,
        gameContracts,
        readyModes,
        configuredModes: arenaEnv.configuredModes,
        profileContractAddress: arenaEnv.profileContractAddress,
        profileContractConfigured: arenaEnv.hasProfileContractAddress,
        chain: getArenaChain().name,
        endpoint: getArenaEndpoint(),
        profileChain: getProfileChain().name,
        profileEndpoint: getProfileRpcUrl(),
      }}
    >
      {children}
    </ArenaContext.Provider>
  );
}

export function useArena() {
  const context = useContext(ArenaContext);

  if (!context) {
    throw new Error("useArena must be used within ArenaProvider");
  }

  return context;
}
