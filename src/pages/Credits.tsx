import { useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { motion } from "framer-motion";
import { ArrowDownToLine, Coins, Loader2, Wallet } from "lucide-react";
import { toast } from "sonner";
import Header from "@/components/Header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useArena } from "@/context/ArenaContext";
import { arenaEnv } from "@/lib/env";
import { creditsForEth, depositEthForCredits, fetchCreditBalance, formatCredits } from "@/lib/creditRail";
import { fetchArenaProfile } from "@/lib/profileFactory";

const PRESETS = ["0.001", "0.01", "0.05"];

const Credits = () => {
  const { walletAddress, provider, openWalletModal, ensureProfileNetwork, coreContractConfigured } = useArena();
  const queryClient = useQueryClient();
  const configured = arenaEnv.hasCreditRail;
  const [amount, setAmount] = useState("0.01");

  const profileQuery = useQuery({
    queryKey: ["profile", walletAddress],
    queryFn: () => fetchArenaProfile(walletAddress!),
    enabled: Boolean(walletAddress),
  });
  const profileAddress = profileQuery.data?.profileAddress ?? null;

  const balanceQuery = useQuery({
    queryKey: ["credit-balance", profileAddress],
    queryFn: () => fetchCreditBalance(profileAddress!),
    enabled: configured && Boolean(profileAddress),
    refetchInterval: 20_000,
  });

  const deposit = useMutation({
    mutationFn: async () => {
      if (!walletAddress || !provider) throw new Error("Connect a wallet first.");
      if (!profileAddress) throw new Error("Create a profile before buying credits.");
      await ensureProfileNetwork();
      return depositEthForCredits(amount, profileAddress, walletAddress, provider);
    },
    onSuccess: async () => {
      toast.success(`Deposited ${amount} ETH. Credits arrive once the bridge confirms it.`);
      await queryClient.invalidateQueries({ queryKey: ["credit-balance", profileAddress] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Deposit failed."),
  });

  const previewCredits = creditsForEth(amount);

  return (
    <div className="min-h-screen bg-background text-foreground">
      <Header />
      <main className="grid-bg noise-bg relative px-6 pb-24 pt-28">
        <div
          className="pointer-events-none absolute inset-x-0 top-0 h-72 opacity-60"
          style={{ background: "radial-gradient(ellipse at 50% -10%, hsl(142 71% 45% / 0.14), transparent 60%)" }}
        />
        <div className="relative mx-auto max-w-3xl">
          <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5 }}>
            <p className="flex items-center gap-2 font-heading text-xs font-semibold uppercase tracking-[0.4em] text-primary">
              <Coins className="h-4 w-4" /> Verdict // Treasury
            </p>
            <h1 className="mt-3 font-heading text-5xl font-black tracking-tight md:text-6xl">
              BUY <span className="text-gradient-red">CREDITS</span>
            </h1>
            <p className="mt-4 max-w-2xl text-base leading-relaxed text-muted-foreground">
              Credits are the wager currency. Deposit ETH into the on-chain vault and it is mirrored to your
              profile as credits you can stake in any room. Cash out anytime by redeeming back to ETH.
            </p>
          </motion.div>

          {!configured ? (
            <div className="mt-10 rounded-2xl border border-border/70 bg-card/60 p-8 text-center text-muted-foreground">
              The credit rail is not configured for this build. Set
              <span className="mx-1 font-mono text-foreground">VITE_CREDIT_VAULT_ADDRESS</span> and
              <span className="mx-1 font-mono text-foreground">VITE_CREDIT_LEDGER_ADDRESS</span>.
            </div>
          ) : !walletAddress ? (
            <div className="mt-10 flex flex-col items-start gap-4 rounded-2xl border border-border/70 bg-card/60 p-8 md:flex-row md:items-center md:justify-between">
              <p className="text-muted-foreground">Connect a wallet to buy and hold credits.</p>
              <Button variant="wallet" onClick={openWalletModal}>Connect Wallet</Button>
            </div>
          ) : coreContractConfigured && !profileAddress && !profileQuery.isLoading ? (
            <div className="mt-10 flex flex-col items-start gap-4 rounded-2xl border border-border/70 bg-card/60 p-8 md:flex-row md:items-center md:justify-between">
              <p className="text-muted-foreground">Create your permanent profile first — credits attach to it.</p>
              <Link to="/mint"><Button variant="wallet">Create Profile</Button></Link>
            </div>
          ) : (
            <>
              {/* balance */}
              <div className="mt-10 rounded-2xl border border-border/70 bg-card/60 p-6 backdrop-blur-sm">
                <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-muted-foreground">Your balance</p>
                <div className="mt-2 flex items-end gap-3">
                  <p className="font-heading text-5xl font-black tabular-nums" style={{ color: "hsl(142 71% 45%)" }}>
                    {balanceQuery.isLoading ? "…" : formatCredits(balanceQuery.data ?? 0)}
                  </p>
                  <p className="mb-2 font-heading text-sm uppercase tracking-[0.2em] text-muted-foreground">credits</p>
                </div>
              </div>

              {/* deposit */}
              <div className="mt-5 rounded-2xl border border-border/70 bg-card/60 p-6 backdrop-blur-sm">
                <div className="flex items-center gap-2">
                  <ArrowDownToLine className="h-5 w-5 text-primary" />
                  <h2 className="font-heading text-lg font-bold uppercase tracking-[0.16em]">Deposit ETH</h2>
                  <span className="ml-auto font-mono text-xs text-muted-foreground">1 ETH = {formatCredits(arenaEnv.creditsPerEth)} credits</span>
                </div>

                <div className="mt-4 flex flex-wrap gap-2">
                  {PRESETS.map((p) => (
                    <button
                      key={p}
                      onClick={() => setAmount(p)}
                      className={`rounded-full border px-4 py-1.5 text-sm transition ${
                        amount === p ? "border-primary/60 bg-primary/10 text-foreground" : "border-border/70 text-muted-foreground hover:border-primary/40"
                      }`}
                    >
                      {p} ETH
                    </button>
                  ))}
                </div>

                <div className="mt-4 flex flex-col gap-3 sm:flex-row">
                  <div className="relative flex-1">
                    <Input
                      value={amount}
                      onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ""))}
                      inputMode="decimal"
                      placeholder="Amount in ETH"
                      className="bg-background/60 pr-16"
                    />
                    <span className="absolute right-3 top-1/2 -translate-y-1/2 font-mono text-xs text-muted-foreground">ETH</span>
                  </div>
                  <Button
                    className="font-heading uppercase tracking-[0.16em]"
                    disabled={deposit.isPending || previewCredits <= 0}
                    onClick={() => deposit.mutate()}
                  >
                    {deposit.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Wallet className="mr-2 h-4 w-4" />}
                    {deposit.isPending ? "Confirming…" : `Buy ${formatCredits(previewCredits)} credits`}
                  </Button>
                </div>

                <p className="mt-4 text-xs leading-relaxed text-muted-foreground">
                  Your deposit lands on the vault immediately; the bridge then mirrors it to your credit balance
                  (usually within a minute). Staked rooms draw from this balance, and the winner takes the pot.
                </p>
              </div>

              <div className="mt-6">
                <Link to="/lobby">
                  <Button variant="secondary" className="font-heading uppercase tracking-[0.16em]">Take it to the Arena</Button>
                </Link>
              </div>
            </>
          )}
        </div>
      </main>
    </div>
  );
};

export default Credits;
