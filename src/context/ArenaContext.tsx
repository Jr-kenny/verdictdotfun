import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { useAppKit, useAppKitAccount, useAppKitNetwork, useAppKitProvider, useDisconnect } from "@reown/appkit/react";
import type { Provider } from "@reown/appkit/react";
import type { ContractSchema } from "genlayer-js/types";
import { getAddress, type Address } from "viem";
import { arenaEnv } from "@/lib/env";
import { ensureArenaWalletChain, ensureProfileWalletChain, type BrowserEthereumProvider } from "@/lib/ethereum";
import { ARENA_MODES } from "@/lib/gameModes";
import { getArenaChain, getArenaEndpoint } from "@/lib/genlayer";
import { getProfileChain, getProfileRpcUrl } from "@/lib/profileChain";
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
  walletReady: boolean;
  openWalletModal: () => Promise<void>;
  connectWallet: () => Promise<void>;
  disconnectWallet: () => Promise<void>;
  ensureArenaNetwork: () => Promise<void>;
  ensureProfileNetwork: () => Promise<void>;
  walletChainId: string | null;
  walletArenaStatus: NetworkStatus;
  walletProfileStatus: NetworkStatus;
  gameContracts: Record<ArenaMode, GameContractState>;
  readyModes: ArenaMode[];
  configuredModes: ArenaMode[];
  coreContractAddress: string | null;
  coreContractConfigured: boolean;
  chain: string;
  endpoint: string;
  profileChain: string;
  profileEndpoint: string;
}

const ArenaContext = createContext<ArenaContextValue | null>(null);

function buildInitialGameContracts(): Record<ArenaMode, GameContractState> {
  return {
    argue: {
      address: arenaEnv.contractAddresses.argue,
      status: arenaEnv.contractAddresses.argue ? "checking" : "missing-config",
      error: arenaEnv.contractAddresses.argue ? null : "Set VITE_VERDICTDOTFUN_ARGUE_CONTRACT_ADDRESS after deployment.",
      schema: null,
    },
    riddle: {
      address: arenaEnv.contractAddresses.riddle,
      status: arenaEnv.contractAddresses.riddle ? "checking" : "missing-config",
      error: arenaEnv.contractAddresses.riddle ? null : "Set VITE_VERDICTDOTFUN_RIDDLE_CONTRACT_ADDRESS after deployment.",
      schema: null,
    },
  };
}

export function ArenaProvider({ children }: { children: ReactNode }) {
  const { open } = useAppKit();
  const { disconnect } = useDisconnect();
  const { address, status } = useAppKitAccount({ namespace: "eip155" });
  const { chainId } = useAppKitNetwork();
  const { walletProvider } = useAppKitProvider<Provider>("eip155");
  const [gameContracts, setGameContracts] = useState<Record<ArenaMode, GameContractState>>(buildInitialGameContracts);

  const walletAddress = useMemo(() => {
    if (!address) {
      return null;
    }

    return getAddress(address as `0x${string}`);
  }, [address]);

  const provider = (walletProvider as BrowserEthereumProvider | undefined) ?? null;
  const walletReady = status !== "connecting" && status !== "reconnecting";
  const walletChainId = typeof chainId === "number" ? `0x${chainId.toString(16)}` : null;
  const arenaChainHexId = `0x${getArenaChain().id.toString(16)}`.toLowerCase();
  const profileChainHexId = `0x${getProfileChain().id.toString(16)}`.toLowerCase();
  const normalizedWalletChainId = walletChainId?.toLowerCase() ?? null;
  const walletArenaStatus: NetworkStatus = !normalizedWalletChainId
    ? "unknown"
    : normalizedWalletChainId === arenaChainHexId
      ? "ready"
      : "wrong-network";
  const walletProfileStatus: NetworkStatus = !normalizedWalletChainId
    ? "unknown"
    : normalizedWalletChainId === profileChainHexId
      ? "ready"
      : "wrong-network";

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      const nextState = buildInitialGameContracts();

      await Promise.all(
        ARENA_MODES.map(async (mode) => {
          const configuredAddress = arenaEnv.contractAddresses[mode];

          if (!configuredAddress) {
            return;
          }

          try {
            const schema = await fetchContractSchema(mode);

            if (!cancelled) {
              nextState[mode] = {
                address: configuredAddress,
                status: "ready",
                error: null,
                schema,
              };
            }
          } catch (error) {
            if (!cancelled) {
              nextState[mode] = {
                address: configuredAddress,
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

  async function openWalletModal() {
    await open({ view: "Connect", namespace: "eip155" });
  }

  async function connectWallet() {
    await openWalletModal();
  }

  async function ensureArenaNetwork() {
    if (!provider) {
      throw new Error("Connect a wallet before switching networks.");
    }

    await ensureArenaWalletChain(provider);
  }

  async function ensureProfileNetwork() {
    if (!provider) {
      throw new Error("Connect a wallet before switching networks.");
    }

    await ensureProfileWalletChain(provider);
  }

  async function disconnectWallet() {
    await disconnect({ namespace: "eip155" });
  }

  const readyModes = ARENA_MODES.filter((mode) => gameContracts[mode].status === "ready");

  return (
    <ArenaContext.Provider
      value={{
        walletAddress,
        provider,
        walletReady,
        openWalletModal,
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
        coreContractAddress: arenaEnv.vdtCoreAddress,
        coreContractConfigured: arenaEnv.hasVdtCoreAddress,
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
