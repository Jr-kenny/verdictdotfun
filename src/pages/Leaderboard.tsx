import { useQuery } from "@tanstack/react-query";
import { Crown, Medal, Shield } from "lucide-react";
import BackButton from "@/components/BackButton";
import Header from "@/components/Header";
import { fetchLeaderboard } from "@/lib/profileFactory";

const badgeForPosition = (position: number) => {
  if (position === 1) {
    return <Crown className="h-5 w-5 text-primary" />;
  }
  if (position === 2) {
    return <Medal className="h-5 w-5 text-muted-foreground" />;
  }
  if (position === 3) {
    return <Shield className="h-5 w-5 text-label-blue" />;
  }
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
    <div className="min-h-screen grid-bg">
      <Header />
      <main className="mx-auto max-w-6xl px-4 pb-16 pt-24">
        <div className="mb-6">
          <BackButton backTo="/lobby" />
        </div>
        <section className="rounded-2xl border border-border bg-card/80 p-6 backdrop-blur">
          <div className="flex flex-col gap-3 border-b border-border/60 pb-5 md:flex-row md:items-end md:justify-between">
            <div>
              <p className="text-xs font-heading font-bold uppercase tracking-[0.32em] text-primary">Leaderboard</p>
              <h1 className="mt-2 font-heading text-3xl font-bold md:text-4xl">Current season standings</h1>
              <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
                Live ranking ordered by current tier, division, and seasonal total XP.
              </p>
            </div>
            <div className="rounded-xl border border-border/70 bg-background/60 px-4 py-3 text-sm text-muted-foreground">
              {leaderboardQuery.isLoading
                ? "Loading leaderboard..."
                : `${entries.length} ranked profile${entries.length === 1 ? "" : "s"}`}
            </div>
          </div>

          <div className="mt-6 space-y-3">
            {entries.length === 0 && !leaderboardQuery.isLoading ? (
              <div className="rounded-xl border border-dashed border-border/70 bg-background/40 px-4 py-8 text-center text-sm text-muted-foreground">
                No ranked profiles yet on the active VerdictDotFun contract.
              </div>
            ) : null}

            {entries.map(({ position, profile }) => (
              <div
                key={profile.profileAddress}
                className="grid gap-4 rounded-xl border border-border/70 bg-background/50 px-4 py-4 md:grid-cols-[80px_1.4fr_1fr_140px_140px]"
              >
                <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-full border border-border/60 bg-card">
                    {badgeForPosition(position)}
                  </div>
                  <div className="text-xs uppercase tracking-[0.24em] text-muted-foreground">Ranked</div>
                </div>

                <div>
                  <p className="font-heading text-xl font-bold">{profile.name}</p>
                  <p className="mt-1 break-all text-xs font-mono text-muted-foreground">{profile.profileAddress}</p>
                </div>

                <div className="grid gap-1">
                  <p className="text-[11px] uppercase tracking-[0.22em] text-muted-foreground">Tier</p>
                  <p className="font-heading text-lg font-bold">{profile.rankLabel}</p>
                </div>

                <div className="grid gap-1">
                  <p className="text-[11px] uppercase tracking-[0.22em] text-muted-foreground">Total XP</p>
                  <p className="font-heading text-lg font-bold">{profile.totalXp}</p>
                </div>

                <div className="grid gap-1">
                  <p className="text-[11px] uppercase tracking-[0.22em] text-muted-foreground">Record</p>
                  <p className="font-heading text-lg font-bold">
                    {profile.wins}-{profile.losses}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </section>
      </main>
    </div>
  );
};

export default Leaderboard;
