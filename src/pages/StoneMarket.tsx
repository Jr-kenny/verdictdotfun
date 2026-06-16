import { useMemo } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { motion } from "framer-motion";
import { ArrowUpRight, Gem, Layers, Lock, ShieldCheck, Sparkles, Trophy } from "lucide-react";
import Header from "@/components/Header";
import { Button } from "@/components/ui/button";
import { useArena } from "@/context/ArenaContext";
import { arenaEnv } from "@/lib/env";
import {
  fetchAllStones,
  fetchOwnerStones,
  shortProfile,
  tierForLevel,
  type Stone,
} from "@/lib/verdictStone";

const CHAIN_LABEL: Record<number, string> = { 84532: "Base Sepolia", 300: "ZKsync Era", 11155111: "Sepolia" };

function StoneFacet({ level, size = 72 }: { level: number; size?: number }) {
  const tier = tierForLevel(level);
  return (
    <div className="relative grid place-items-center" style={{ width: size, height: size }}>
      <div
        className="absolute inset-0 rounded-[28%] rotate-45"
        style={{
          background: `linear-gradient(145deg, hsl(${tier.hsl} / 0.95), hsl(${tier.hsl} / 0.35) 55%, hsl(0 0% 8%))`,
          boxShadow: `${tier.glow}, inset 0 1px 0 hsl(0 0% 100% / 0.35)`,
          border: `1px solid hsl(${tier.hsl} / 0.6)`,
        }}
      />
      <div
        className="absolute rounded-[30%] rotate-45"
        style={{
          inset: size * 0.22,
          background: `linear-gradient(145deg, hsl(0 0% 100% / 0.22), transparent 60%)`,
          borderTop: `1px solid hsl(0 0% 100% / 0.4)`,
        }}
      />
      <span className="relative font-heading text-lg font-black tabular-nums" style={{ color: "hsl(0 0% 100%)" }}>
        {level}
      </span>
    </div>
  );
}

function StoneCard({ stone, you, index }: { stone: Stone; you?: boolean; index: number }) {
  const tier = tierForLevel(stone.level);
  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: Math.min(index * 0.03, 0.4), duration: 0.4 }}
      className="group relative overflow-hidden rounded-2xl border border-border/70 bg-card/70 p-5 backdrop-blur-sm transition hover:border-border"
      style={{ boxShadow: `inset 0 0 60px hsl(${tier.hsl} / 0.05)` }}
    >
      <div
        className="pointer-events-none absolute -right-10 -top-10 h-32 w-32 rounded-full opacity-40 blur-2xl transition group-hover:opacity-70"
        style={{ background: `hsl(${tier.hsl} / 0.35)` }}
      />
      <div className="relative flex items-start justify-between">
        <StoneFacet level={stone.level} />
        <div className="text-right">
          <p
            className="font-heading text-[11px] font-bold uppercase tracking-[0.22em]"
            style={{ color: `hsl(${tier.hsl})` }}
          >
            {tier.name}
          </p>
          <p className="mt-1 font-mono text-xs text-muted-foreground">Stone #{stone.tokenId}</p>
          {you && (
            <span className="mt-2 inline-block rounded-full border border-primary/50 bg-primary/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-widest text-primary">
              Yours
            </span>
          )}
        </div>
      </div>
      <dl className="relative mt-5 space-y-2 text-sm">
        <div className="flex items-center justify-between">
          <dt className="text-muted-foreground">Holder</dt>
          <dd className="font-mono text-xs">{stone.owner.slice(0, 6)}…{stone.owner.slice(-4)}</dd>
        </div>
        <div className="flex items-center justify-between">
          <dt className="text-muted-foreground">Bound profile</dt>
          <dd className="font-mono text-xs">{shortProfile(stone.profile)}</dd>
        </div>
        <div className="flex items-center justify-between">
          <dt className="text-muted-foreground">Roaming on</dt>
          <dd className="text-xs">{CHAIN_LABEL[stone.location] ?? `chain ${stone.location}`}</dd>
        </div>
      </dl>
      <button
        disabled
        title="Secondary trading opens with the market contract"
        className="relative mt-5 flex w-full items-center justify-center gap-2 rounded-xl border border-border/70 bg-background/60 py-2.5 text-xs font-heading font-semibold uppercase tracking-[0.18em] text-muted-foreground"
      >
        <Lock className="h-3.5 w-3.5" />
        Trading opens soon
      </button>
    </motion.div>
  );
}

function StatPill({ label, value, accent }: { label: string; value: string; accent?: string }) {
  return (
    <div className="rounded-2xl border border-border/70 bg-card/60 px-5 py-4 backdrop-blur-sm">
      <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-muted-foreground">{label}</p>
      <p className="mt-1 font-heading text-3xl font-black tabular-nums" style={accent ? { color: accent } : undefined}>
        {value}
      </p>
    </div>
  );
}

const StoneMarket = () => {
  const { walletAddress, openWalletModal } = useArena();
  const configured = arenaEnv.hasStoneHubAddress;

  const collectionQuery = useQuery({
    queryKey: ["stones", "all"],
    queryFn: fetchAllStones,
    enabled: configured,
    refetchInterval: 30_000,
  });
  const vaultQuery = useQuery({
    queryKey: ["stones", "owner", walletAddress],
    queryFn: () => fetchOwnerStones(walletAddress!),
    enabled: configured && Boolean(walletAddress),
  });

  const stones = useMemo(() => collectionQuery.data ?? [], [collectionQuery.data]);
  const highest = useMemo(() => stones.reduce((m, s) => Math.max(m, s.level), 0), [stones]);
  const vault = vaultQuery.data;

  return (
    <div className="min-h-screen bg-background text-foreground">
      <Header />
      <main className="grid-bg noise-bg relative px-6 pb-24 pt-28">
        <div
          className="pointer-events-none absolute inset-x-0 top-0 h-80 opacity-60"
          style={{ background: "radial-gradient(ellipse at 50% -10%, hsl(1 77% 55% / 0.18), transparent 60%)" }}
        />
        <div className="relative mx-auto max-w-6xl">
          {/* Hero */}
          <motion.div initial={{ opacity: 0, y: 18 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5 }}>
            <p className="flex items-center gap-2 font-heading text-xs font-semibold uppercase tracking-[0.4em] text-primary">
              <Gem className="h-4 w-4" /> Verdict // Reliquary
            </p>
            <h1 className="mt-3 font-heading text-5xl font-black tracking-tight md:text-7xl">
              STONE <span className="text-gradient-red">MARKET</span>
            </h1>
            <p className="mt-4 max-w-2xl text-base leading-relaxed text-muted-foreground">
              The Verdict Stone is a living reputation relic. Its level ratchets up with the deeds of whoever
              holds it and never falls, so a stone carries its rank to its next owner. Forge one by proving
              yourself in the arena, then let it roam across chains.
            </p>
          </motion.div>

          {/* Stats */}
          <div className="mt-10 grid grid-cols-2 gap-4 md:grid-cols-3">
            <StatPill label="Stones Forged" value={configured ? String(stones.length) : "—"} />
            <StatPill label="Highest Level" value={highest ? String(highest) : "—"} accent="hsl(45 93% 58%)" />
            <StatPill
              label="Your Perk Level"
              value={walletAddress ? String(vault?.effectiveLevel ?? 0) : "—"}
              accent="hsl(142 71% 45%)"
            />
          </div>

          {!configured && (
            <div className="mt-12 rounded-2xl border border-border/70 bg-card/60 p-8 text-center text-muted-foreground">
              The stone hub address is not configured for this build. Set
              <span className="mx-1 font-mono text-foreground">VITE_STONE_HUB_ADDRESS</span>
              to bring the market online.
            </div>
          )}

          {/* Your vault */}
          {configured && (
            <section className="mt-14">
              <div className="flex items-center gap-3">
                <ShieldCheck className="h-5 w-5 text-primary" />
                <h2 className="font-heading text-2xl font-bold uppercase tracking-[0.18em]">Your Vault</h2>
              </div>
              {!walletAddress ? (
                <div className="mt-5 flex flex-col items-start gap-4 rounded-2xl border border-border/70 bg-card/60 p-8 md:flex-row md:items-center md:justify-between">
                  <p className="text-muted-foreground">Connect a wallet to see the stones you hold and your perk level.</p>
                  <Button variant="wallet" onClick={openWalletModal}>Connect Wallet</Button>
                </div>
              ) : (vault?.stones.length ?? 0) === 0 ? (
                <div className="mt-5 rounded-2xl border border-dashed border-border/70 bg-card/40 p-8 text-muted-foreground">
                  No stones bound to this wallet yet. Climb the arena to clear the mint gate, then forge your first
                  stone below.
                </div>
              ) : (
                <div className="mt-5 grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
                  {vault!.stones.map((s, i) => (
                    <StoneCard key={s.tokenId} stone={s} you index={i} />
                  ))}
                </div>
              )}
            </section>
          )}

          {/* The collection */}
          {configured && (
            <section className="mt-16">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <Layers className="h-5 w-5 text-primary" />
                  <h2 className="font-heading text-2xl font-bold uppercase tracking-[0.18em]">The Reliquary</h2>
                </div>
                <span className="font-mono text-xs text-muted-foreground">
                  {collectionQuery.isLoading ? "reading chain…" : `${stones.length} on the hub`}
                </span>
              </div>
              {stones.length === 0 && !collectionQuery.isLoading ? (
                <div className="mt-5 rounded-2xl border border-dashed border-border/70 bg-card/40 p-8 text-muted-foreground">
                  No stones have been forged yet. The first one is waiting to be claimed.
                </div>
              ) : (
                <div className="mt-5 grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
                  {stones.map((s, i) => (
                    <StoneCard key={s.tokenId} stone={s} you={s.owner.toLowerCase() === walletAddress?.toLowerCase()} index={i} />
                  ))}
                </div>
              )}
            </section>
          )}

          {/* Acquire */}
          <section className="mt-16 grid gap-5 md:grid-cols-3">
            {[
              {
                icon: Trophy,
                title: "Earn your rank",
                body: "Win debates and riddles in the arena. Your account level rises with every verdict in your favor.",
              },
              {
                icon: Sparkles,
                title: "Clear the mint gate",
                body: "Each stone you forge raises the bar for the next. Reach the gate and forge a stone bound to your profile.",
              },
              {
                icon: ArrowUpRight,
                title: "Hold, level, trade",
                body: "Perks follow the highest stone you hold. Levels ratchet up and never drop, so a stone keeps its rank when it changes hands.",
              },
            ].map(({ icon: Icon, title, body }) => (
              <div key={title} className="rounded-2xl border border-border/70 bg-card/50 p-6">
                <Icon className="h-6 w-6 text-primary" />
                <h3 className="mt-4 font-heading text-lg font-bold">{title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{body}</p>
              </div>
            ))}
          </section>

          <div className="mt-12 flex flex-wrap items-center gap-4">
            <Link to="/lobby">
              <Button variant="default" className="font-heading uppercase tracking-[0.18em]">
                Enter the Arena
              </Button>
            </Link>
            <p className="text-xs text-muted-foreground">
              Secondary trading and offers arrive with the market contract. For now stones are forged by merit and
              transfer with standard wallets.
            </p>
          </div>
        </div>
      </main>
    </div>
  );
};

export default StoneMarket;
