import { useQuery } from "@tanstack/react-query";
import { motion } from "framer-motion";
import { Crown, Medal, Shield, Trophy } from "lucide-react";
import BackButton from "@/components/BackButton";
import Header from "@/components/Header";
import { fetchLeaderboard } from "@/lib/profileFactory";

// Tier accent per podium position (matches the Stone Market's level tiers).
function rankAccent(position: number): string | null {
  if (position === 1) return "45 93% 58%"; // radiant gold
  if (position === 2) return "0 0% 70%"; // steel
  if (position === 3) return "213 94% 68%"; // honed blue
  return null;
}

const badgeForPosition = (position: number) => {
  if (position === 1) return <Crown className="h-5 w-5" style={{ color: "hsl(45 93% 58%)" }} />;
  if (position === 2) return <Medal className="h-5 w-5 text-muted-foreground" />;
  if (position === 3) return <Shield className="h-5 w-5 text-label-blue" />;
  return <span className="text-sm font-heading font-bold text-muted-foreground">#{position}</span>;
};

const Leaderboard = () => {
  const leaderboardQuery = useQuery({
    queryKey: ["leaderboard"],
    queryFn: () => fetchLeaderboard(50),
    refetchInterval: 15_000,
  });

  const entries = leaderboardQuery.data ?? [];

  return (
    <div className="min-h-screen bg-background text-foreground">
      <Header />
      <main className="grid-bg noise-bg relative px-4 pb-20 pt-24">
        <div
          className="pointer-events-none absolute inset-x-0 top-0 h-72 opacity-60"
          style={{ background: "radial-gradient(ellipse at 50% -10%, hsl(1 77% 55% / 0.16), transparent 60%)" }}
        />
        <div className="relative mx-auto max-w-6xl">
          <div className="mb-6">
            <BackButton backTo="/lobby" />
          </div>

          <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5 }}>
            <p className="flex items-center gap-2 font-heading text-xs font-semibold uppercase tracking-[0.4em] text-primary">
              <Trophy className="h-4 w-4" /> Verdict // Standings
            </p>
            <h1 className="mt-3 font-heading text-4xl font-black tracking-tight md:text-6xl">
              THE <span className="text-gradient-red">LADDER</span>
            </h1>
            <p className="mt-3 max-w-2xl text-sm text-muted-foreground">
              Live ranking by current tier, division, and seasonal total XP. Climb it to clear the gate and forge a
              Verdict Stone.
            </p>
          </motion.div>

          <section className="mt-8 rounded-2xl border border-border/70 bg-card/60 p-5 backdrop-blur-sm md:p-6">
            <div className="flex items-center justify-between border-b border-border/60 pb-4">
              <p className="font-heading text-sm font-bold uppercase tracking-[0.18em]">Current season</p>
              <span className="font-mono text-xs text-muted-foreground">
                {leaderboardQuery.isLoading
                  ? "reading chain…"
                  : `${entries.length} ranked profile${entries.length === 1 ? "" : "s"}`}
              </span>
            </div>

            <div className="mt-5 space-y-3">
              {entries.length === 0 && !leaderboardQuery.isLoading ? (
                <div className="rounded-xl border border-dashed border-border/70 bg-background/40 px-4 py-10 text-center text-sm text-muted-foreground">
                  No ranked profiles yet on the active contract. Be the first onto the ladder.
                </div>
              ) : null}

              {entries.map(({ position, profile }, i) => {
                const accent = rankAccent(position);
                return (
                  <motion.div
                    key={profile.profileAddress}
                    initial={{ opacity: 0, y: 12 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: Math.min(i * 0.03, 0.3), duration: 0.35 }}
                    className="group relative grid gap-4 overflow-hidden rounded-xl border bg-background/50 px-4 py-4 transition hover:border-border md:grid-cols-[80px_1.4fr_1fr_140px_140px]"
                    style={{
                      borderColor: accent ? `hsl(${accent} / 0.4)` : undefined,
                      boxShadow: accent ? `inset 0 0 50px hsl(${accent} / 0.06)` : undefined,
                    }}
                  >
                    {accent && (
                      <div
                        className="pointer-events-none absolute -left-10 top-1/2 h-24 w-24 -translate-y-1/2 rounded-full opacity-40 blur-2xl"
                        style={{ background: `hsl(${accent} / 0.4)` }}
                      />
                    )}
                    <div className="relative flex items-center gap-3">
                      <div
                        className="flex h-10 w-10 items-center justify-center rounded-full border bg-card"
                        style={{ borderColor: accent ? `hsl(${accent} / 0.5)` : undefined }}
                      >
                        {badgeForPosition(position)}
                      </div>
                      <div className="text-xs uppercase tracking-[0.24em] text-muted-foreground">Rank {position}</div>
                    </div>

                    <div className="relative">
                      <p className="font-heading text-xl font-bold">{profile.name}</p>
                      <p className="mt-1 break-all text-xs font-mono text-muted-foreground">{profile.profileAddress}</p>
                    </div>

                    <div className="relative grid gap-1">
                      <p className="text-[11px] uppercase tracking-[0.22em] text-muted-foreground">Tier</p>
                      <p className="font-heading text-lg font-bold">{profile.rankLabel}</p>
                    </div>

                    <div className="relative grid gap-1">
                      <p className="text-[11px] uppercase tracking-[0.22em] text-muted-foreground">Total XP</p>
                      <p className="font-heading text-lg font-bold tabular-nums">{profile.totalXp}</p>
                    </div>

                    <div className="relative grid gap-1">
                      <p className="text-[11px] uppercase tracking-[0.22em] text-muted-foreground">Record</p>
                      <p className="font-heading text-lg font-bold tabular-nums">
                        {profile.wins}-{profile.losses}
                      </p>
                    </div>
                  </motion.div>
                );
              })}
            </div>
          </section>
        </div>
      </main>
    </div>
  );
};

export default Leaderboard;
