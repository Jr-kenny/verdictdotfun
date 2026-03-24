import { useState } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { motion } from "framer-motion";
import { toast } from "sonner";
import Header from "@/components/Header";
import BackButton from "@/components/BackButton";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useArena } from "@/context/ArenaContext";
import { fetchProfileNft, mintProfileNft } from "@/lib/profileNft";

const MintProfile = () => {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const {
    walletAddress,
    provider,
    ensureProfileNetwork,
    walletProfileStatus,
    profileContractConfigured,
    profileContractAddress,
    profileChain,
  } = useArena();
  const [name, setName] = useState("");

  const profileQuery = useQuery({
    queryKey: ["profile-nft", walletAddress],
    queryFn: () => fetchProfileNft(walletAddress!),
    enabled: Boolean(walletAddress) && profileContractConfigured,
  });

  const mintMutation = useMutation({
    mutationFn: async () => {
      if (!walletAddress || !provider) {
        throw new Error("Connect a wallet before minting a profile NFT.");
      }

      await ensureProfileNetwork();
      return mintProfileNft(walletAddress, provider, name.trim());
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["profile-nft", walletAddress] });
      toast.success("Profile NFT minted.");
      navigate("/lobby");
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : "Profile mint failed.");
    },
  });

  if (!walletAddress) {
    return <Navigate to="/" replace />;
  }

  if (!profileContractConfigured) {
    return (
      <div className="min-h-screen bg-background text-foreground">
        <Header />
        <main className="mx-auto flex min-h-screen max-w-3xl items-center px-6 pt-24">
          <div className="w-full rounded-2xl border border-defeat/30 bg-card/80 p-8">
            <h1 className="font-heading text-3xl font-black">Profile NFT not configured</h1>
            <p className="mt-3 text-muted-foreground">
              The opening mint flow now depends on an EVM profile NFT contract. Set
              ` VITE_PROFILE_NFT_CONTRACT_ADDRESS ` before using the production path.
            </p>
            <p className="mt-3 break-all font-mono text-xs text-muted-foreground">
              {profileContractAddress ?? "No address configured"}
            </p>
          </div>
        </main>
      </div>
    );
  }

  if (profileQuery.data) {
    return <Navigate to="/lobby" replace />;
  }

  return (
    <div className="min-h-screen bg-background text-foreground">
      <Header />

      <main className="mx-auto flex min-h-screen max-w-5xl items-center px-6 pb-12 pt-28">
        <div className="grid w-full gap-12 lg:grid-cols-[1fr_0.9fr]">
          <motion.section
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5 }}
            className="space-y-8"
          >
            <BackButton backTo="/" />

            <div className="space-y-4">
              <span className="inline-flex rounded-full border border-primary/30 bg-primary/10 px-4 py-1 text-xs uppercase tracking-[0.24em] text-primary">
                Mint player profile NFT
              </span>
              <h1 className="font-heading text-4xl font-black md:text-5xl">Create the identity your games will reward.</h1>
              <p className="max-w-xl text-muted-foreground">
                This screen is now the real NFT step. The profile contract lives on {profileChain}, and finalized wins
                from GenLayer games are expected to emit XP updates into this token.
              </p>
            </div>

            <div className="space-y-4 rounded-2xl border border-border/70 bg-card/80 p-6">
              <div>
                <label className="mb-2 block text-sm text-muted-foreground">Profile handle</label>
                <Input
                  value={name}
                  onChange={(event) => setName(event.target.value.slice(0, 24))}
                  placeholder="Use letters, numbers, or underscores"
                  className="h-12 bg-background/80"
                  maxLength={24}
                />
                <p className="mt-2 text-xs text-muted-foreground">{name.length}/24 characters</p>
              </div>

              <div className="rounded-xl border border-border/60 bg-background/60 p-4 text-sm text-muted-foreground">
                Wallet status:{" "}
                <span className={walletProfileStatus === "ready" ? "text-victory" : "text-defeat"}>
                  {walletProfileStatus === "ready"
                    ? `${profileChain} already selected.`
                    : `Click mint and the app will prompt a switch to ${profileChain}.`}
                </span>
              </div>

              <Button
                variant="arena"
                className="w-full py-6 text-base"
                disabled={mintMutation.isPending || !profileContractConfigured || name.trim().length < 3}
                onClick={() => mintMutation.mutate()}
              >
                {mintMutation.isPending ? "Minting NFT..." : "Mint Profile NFT"}
              </Button>
            </div>
          </motion.section>

          <motion.aside
            initial={{ opacity: 0, scale: 0.96 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.6, delay: 0.1 }}
            className="flex items-center justify-center"
          >
            <div className="w-full max-w-sm rounded-[2rem] border border-primary/20 bg-[linear-gradient(180deg,rgba(255,255,255,0.06),rgba(255,255,255,0.02))] p-7 shadow-[0_0_60px_rgba(255,68,68,0.12)]">
              <div className="rounded-[1.5rem] border border-border/70 bg-background/80 p-6">
                <div className="mb-8 flex h-28 items-center justify-center rounded-2xl border border-border/60 bg-card">
                  <span className="font-heading text-5xl font-black text-primary">
                    {name.trim() ? name.trim().slice(0, 1).toUpperCase() : "?"}
                  </span>
                </div>
                <p className="text-xs uppercase tracking-[0.24em] text-muted-foreground">Connected address</p>
                <p className="mt-2 break-all font-mono text-sm">{walletAddress}</p>
                <div className="mt-8 grid grid-cols-3 gap-3 text-center">
                  <div className="rounded-xl border border-border/60 bg-card/70 p-3">
                    <p className="text-xs text-muted-foreground">Wins</p>
                    <p className="font-heading text-xl font-bold">0</p>
                  </div>
                  <div className="rounded-xl border border-border/60 bg-card/70 p-3">
                    <p className="text-xs text-muted-foreground">Losses</p>
                    <p className="font-heading text-xl font-bold">0</p>
                  </div>
                  <div className="rounded-xl border border-border/60 bg-card/70 p-3">
                    <p className="text-xs text-muted-foreground">XP</p>
                    <p className="font-heading text-xl font-bold">0</p>
                  </div>
                </div>
              </div>
            </div>
          </motion.aside>
        </div>
      </main>
    </div>
  );
};

export default MintProfile;
