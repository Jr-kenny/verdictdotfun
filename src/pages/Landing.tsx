import { useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import { AlertTriangle, Blocks, ShieldCheck, Wallet } from "lucide-react";
import { toast } from "sonner";
import Header from "@/components/Header";
import { Button } from "@/components/ui/button";
import { useArena } from "@/context/ArenaContext";
import { ARENA_MODES, GAME_MODE_META } from "@/lib/gameModes";
import { getArenaChainHexId } from "@/lib/genlayer";
import { getProfileChainHexId } from "@/lib/profileChain";

const Landing = () => {
  const navigate = useNavigate();
  const {
    connectWallet,
    ensureArenaNetwork,
    ensureProfileNetwork,
    walletAddress,
    walletChainId,
    walletArenaStatus,
    walletProfileStatus,
    gameContracts,
    readyModes,
    endpoint,
    chain,
    profileChain,
    profileEndpoint,
    profileContractAddress,
    profileContractConfigured,
  } = useArena();

  async function handleContinue() {
    try {
      if (!walletAddress) {
        await connectWallet();
      }

      navigate("/mint");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Wallet connection failed.");
    }
  }

  async function handleSwitchArenaNetwork() {
    try {
      await ensureArenaNetwork();
      toast.success(`Wallet switched to ${chain}.`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Network switch failed.");
    }
  }

  async function handleSwitchProfileNetwork() {
    try {
      await ensureProfileNetwork();
      toast.success(`Wallet switched to ${profileChain}.`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Profile network switch failed.");
    }
  }

  return (
    <div className="min-h-screen overflow-hidden bg-background text-foreground">
      <Header />

      <div className="pointer-events-none absolute inset-0">
        <div className="absolute left-1/2 top-24 h-[38rem] w-[38rem] -translate-x-1/2 rounded-full bg-primary/10 blur-[140px]" />
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_top,rgba(255,255,255,0.08),transparent_28%),linear-gradient(rgba(255,255,255,0.03)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.03)_1px,transparent_1px)] bg-[length:auto,54px_54px,54px_54px]" />
      </div>

      <main className="relative mx-auto flex min-h-screen max-w-6xl flex-col justify-center gap-10 px-6 pb-16 pt-28">
        <div className="grid gap-10 lg:grid-cols-[1.15fr_0.85fr]">
          <motion.section
            initial={{ opacity: 0, y: 30 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.7 }}
            className="space-y-6"
          >
            <span className="inline-flex rounded-full border border-primary/30 bg-primary/10 px-4 py-1 text-xs uppercase tracking-[0.32em] text-primary">
              Multi-contract GenLayer arena
            </span>
            <h1 className="max-w-3xl font-heading text-5xl font-black leading-[0.95] md:text-7xl">
              Three game contracts. One upgradable player NFT.
            </h1>
            <p className="max-w-2xl text-lg text-muted-foreground md:text-xl">
              Debate, Convince Me, and Quiz now have separate GenLayer runtimes. Player identity and XP live in a
              dedicated EVM profile NFT that the games target after finalized verdicts.
            </p>

            <div className="flex flex-wrap gap-4">
              <Button variant="arena" size="lg" className="px-8 py-6 text-base" onClick={() => void handleContinue()}>
                {walletAddress ? "Continue To Profile Mint" : "Connect Wallet"}
              </Button>
              <Button variant="secondary" size="lg" className="px-8 py-6 text-base" onClick={() => void handleSwitchArenaNetwork()}>
                Add / Switch Bradbury
              </Button>
              <Button variant="secondary" size="lg" className="px-8 py-6 text-base" onClick={() => void handleSwitchProfileNetwork()}>
                Add / Switch Base Sepolia
              </Button>
            </div>
          </motion.section>

          <motion.aside
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.7, delay: 0.1 }}
            className="space-y-4"
          >
            <div className="rounded-2xl border border-border/70 bg-card/80 p-6">
              <div className="mb-6 flex items-center gap-3">
                <Blocks className="h-5 w-5 text-primary" />
                <h2 className="font-heading text-xl font-bold">Runtime Status</h2>
              </div>

              <div className="space-y-4 text-sm">
                <div className="rounded-xl border border-border/60 bg-background/60 p-4">
                  <p className="mb-1 text-xs uppercase tracking-[0.24em] text-muted-foreground">GenLayer gameplay</p>
                  <p className="break-all font-mono text-foreground">
                    {chain} ({getArenaChainHexId()})
                  </p>
                  <p className="mt-2 break-all font-mono text-muted-foreground">{endpoint}</p>
                </div>
                <div className="rounded-xl border border-border/60 bg-background/60 p-4">
                  <p className="mb-1 text-xs uppercase tracking-[0.24em] text-muted-foreground">Profile NFT network</p>
                  <p className="break-all font-mono text-foreground">
                    {profileChain} ({getProfileChainHexId()})
                  </p>
                  <p className="mt-2 break-all font-mono text-muted-foreground">{profileEndpoint}</p>
                </div>
                <div className="rounded-xl border border-border/60 bg-background/60 p-4">
                  <p className="mb-1 text-xs uppercase tracking-[0.24em] text-muted-foreground">Profile NFT contract</p>
                  <p className="break-all font-mono text-foreground">{profileContractAddress ?? "Not configured"}</p>
                  <p className={`mt-2 text-xs ${profileContractConfigured ? "text-victory" : "text-defeat"}`}>
                    {profileContractConfigured ? "Profile NFT address is configured." : "Set VITE_PROFILE_NFT_CONTRACT_ADDRESS."}
                  </p>
                </div>
                <div className="rounded-xl border border-border/60 bg-background/60 p-4">
                  <p className="mb-2 text-xs uppercase tracking-[0.24em] text-muted-foreground">Wallet</p>
                  <div className="flex items-center gap-2 text-muted-foreground">
                    <Wallet className="h-4 w-4 text-primary" />
                    <span>{walletAddress ?? "No wallet connected yet."}</span>
                  </div>
                  <div className="mt-2 text-xs">
                    <p className={walletArenaStatus === "ready" ? "text-victory" : "text-defeat"}>
                      {walletArenaStatus === "ready"
                        ? `Gameplay network ready (${walletChainId ?? "unknown"}).`
                        : "Gameplay network still needs a wallet switch."}
                    </p>
                    <p className={walletProfileStatus === "ready" ? "mt-1 text-victory" : "mt-1 text-defeat"}>
                      {walletProfileStatus === "ready"
                        ? `Profile network ready (${walletChainId ?? "unknown"}).`
                        : "Profile NFT network still needs a wallet switch."}
                    </p>
                  </div>
                </div>
                <div className="rounded-xl border border-border/60 bg-background/60 p-4">
                  <p className="mb-3 text-xs uppercase tracking-[0.24em] text-muted-foreground">Game contracts</p>
                  <div className="space-y-3">
                    {ARENA_MODES.map((mode) => {
                      const contract = gameContracts[mode];
                      const healthy = contract.status === "ready";
                      return (
                        <div key={mode} className="rounded-xl border border-border/60 bg-card/60 p-3">
                          <div className="flex items-center gap-2">
                            {healthy ? (
                              <ShieldCheck className="h-4 w-4 text-victory" />
                            ) : (
                              <AlertTriangle className="h-4 w-4 text-defeat" />
                            )}
                            <span className="font-heading text-sm font-bold">{GAME_MODE_META[mode].title}</span>
                          </div>
                          <p className="mt-2 break-all font-mono text-xs text-muted-foreground">
                            {contract.address ?? "Not configured"}
                          </p>
                          <p className={`mt-2 text-xs ${healthy ? "text-victory" : "text-defeat"}`}>
                            {healthy ? "Schema loaded successfully." : contract.error ?? "Waiting for configuration."}
                          </p>
                        </div>
                      );
                    })}
                  </div>
                  <p className="mt-3 text-xs text-muted-foreground">{readyModes.length} of 3 game contracts are live.</p>
                </div>
              </div>
            </div>
          </motion.aside>
        </div>
      </main>
    </div>
  );
};

export default Landing;
