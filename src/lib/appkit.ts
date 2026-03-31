import { createAppKit } from "@reown/appkit/react";
import type { AppKitNetwork } from "@reown/appkit/networks";
import { WagmiAdapter } from "@reown/appkit-adapter-wagmi";
import { arenaEnv } from "@/lib/env";
import { getArenaChain } from "@/lib/genlayer";

const LOCALHOST_REOWN_PROJECT_ID = "b56e18d47c72ab683b10814fe9495694";

function getProjectId() {
  if (arenaEnv.reownProjectId) {
    return arenaEnv.reownProjectId;
  }

  if (typeof window !== "undefined" && ["localhost", "127.0.0.1"].includes(window.location.hostname)) {
    return LOCALHOST_REOWN_PROJECT_ID;
  }

  return LOCALHOST_REOWN_PROJECT_ID;
}

function getAppUrl() {
  if (typeof window !== "undefined") {
    return window.location.origin;
  }

  return "http://localhost:5173";
}

const projectId = getProjectId();

const arenaNetwork = getArenaChain() as AppKitNetwork;
const networks = [arenaNetwork] as [AppKitNetwork, ...AppKitNetwork[]];

const metadata = {
  name: "Verdict.fun",
  description: "On-chain argue and riddle rooms with player profiles on GenLayer.",
  url: getAppUrl(),
  icons: [`${getAppUrl()}/favicon.ico`],
};

export const wagmiAdapter = new WagmiAdapter({
  projectId,
  networks,
  ssr: false,
});

createAppKit({
  adapters: [wagmiAdapter],
  projectId,
  networks,
  defaultNetwork: arenaNetwork,
  metadata,
  features: {
    analytics: false,
    socials: false,
    email: false,
  },
});
