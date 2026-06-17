import type { Address } from "viem";
import type { BrowserEthereumProvider } from "@/lib/ethereum";
import type { ArenaMode, ArenaRoom } from "@/types/arena";

export interface PlayHandle {
  account: Address;
  provider: BrowserEthereumProvider;
}

export interface PlayProps {
  room: ArenaRoom;
  mode: ArenaMode;
  amOwner: boolean;
  amOpponent: boolean;
  /** Ensures network + local profile, then returns the wallet handle. Throws if not ready. */
  prepare: () => Promise<PlayHandle>;
  /** Re-fetch room state after an on-chain action. */
  refresh: () => Promise<void>;
}
