import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronDown, Gavel, Trophy } from "lucide-react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { useArena } from "@/context/ArenaContext";
import { arenaEnv } from "@/lib/env";
import { fetchStoredLocalProfileName, getLocalProfileQueryKey } from "@/lib/localProfile";
import { fetchArenaProfile, renameArenaProfile } from "@/lib/profileFactory";
import { fetchVerdictBadge, unlinkVerdictBadge } from "@/lib/verdictNft";

const Header = ({ centered = false }: { centered?: boolean }) => {
  const {
    walletAddress,
    provider,
    disconnectWallet,
    openWalletModal,
    ensureArenaNetwork,
    ensureProfileNetwork,
    coreContractConfigured,
  } = useArena();
  const location = useLocation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [nextHandle, setNextHandle] = useState("");

  const profileQuery = useQuery({
    queryKey: ["profile", walletAddress],
    queryFn: () => fetchArenaProfile(walletAddress!),
    enabled: Boolean(walletAddress),
  });
  const localProfileQuery = useQuery({
    queryKey: getLocalProfileQueryKey(walletAddress),
    queryFn: () => fetchStoredLocalProfileName(walletAddress),
    enabled: Boolean(walletAddress),
  });
  const verdictBadgeQuery = useQuery({
    queryKey: ["verdict-badge", profileQuery.data?.profileAddress],
    queryFn: () => fetchVerdictBadge(profileQuery.data!.profileAddress),
    enabled: Boolean(profileQuery.data?.profileAddress && arenaEnv.hasVerdictNftAddress),
  });

  const profile = profileQuery.data;
  const localProfileName = localProfileQuery.data;
  const verdictBadge = verdictBadgeQuery.data;
  const displayName = profile?.name ?? (!coreContractConfigured ? localProfileName : null) ?? "Profile";
  const showLeaderboardLink = location.pathname === "/lobby";

  const renameMutation = useMutation({
    mutationFn: async () => {
      if (!walletAddress || !provider || !profile?.profileAddress) {
        throw new Error("Connect a wallet with an active profile before renaming.");
      }

      await ensureArenaNetwork();
      return renameArenaProfile(profile.profileAddress as `0x${string}`, walletAddress, provider, nextHandle);
    },
    onSuccess: async () => {
      setNextHandle("");
      await queryClient.invalidateQueries({ queryKey: ["profile", walletAddress] });
      toast.success("Profile name updated.");
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : "Could not update the profile name.");
    },
  });

  const unlinkVerdictMutation = useMutation({
    mutationFn: async () => {
      if (!walletAddress || !provider || !verdictBadge?.tokenId) {
        throw new Error("No linked Verdict NFT is available to unlink.");
      }

      await ensureProfileNetwork();
      return unlinkVerdictBadge(walletAddress, provider, verdictBadge.tokenId);
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["verdict-badge", profile?.profileAddress] });
      toast.success("Verdict NFT unlinked from this permanent profile.");
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : "Could not unlink the Verdict NFT.");
    },
  });

  const handleDisconnect = async () => {
    try {
      await disconnectWallet();
      toast.success("Wallet disconnected.");
      navigate("/");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not disconnect the wallet.");
    }
  };

  return (
    <header className="fixed top-0 left-0 right-0 z-50 flex items-center justify-between px-6 py-4 bg-background/80 backdrop-blur-md border-b border-border/50">
      <Link to="/" className={`flex items-center gap-2 ${centered ? "absolute left-1/2 -translate-x-1/2" : ""}`}>
        <Gavel className="w-5 h-5 text-primary" />
        <span className="font-heading text-lg font-bold tracking-widest">VERDICT.FUN</span>
      </Link>
      <div className="ml-auto flex items-center gap-3">
        {showLeaderboardLink && (
          <Link
            to="/leaderboard"
            className="hidden items-center gap-2 rounded-full border border-border/70 bg-card/70 px-4 py-2 text-sm font-heading font-semibold tracking-[0.18em] text-muted-foreground transition hover:border-primary/50 hover:text-foreground md:flex"
          >
            <Trophy className="h-4 w-4 text-primary" />
            Leaderboard
          </Link>
        )}
        {walletAddress ? (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button className="flex items-center gap-2 rounded-full border border-border/70 bg-card/80 px-3 py-2 text-left transition hover:border-primary/50">
                <span className="text-sm font-display font-semibold">{displayName}</span>
                <span className="text-xs text-muted-foreground font-mono">
                  {walletAddress.slice(0, 6)}...{walletAddress.slice(-4)}
                </span>
                <ChevronDown className="h-4 w-4 text-muted-foreground" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-80 border-border/70 bg-card/95 p-2">
              <DropdownMenuLabel className="px-3 py-2">
                <div className="space-y-1">
                  <p className="font-heading text-base font-bold">
                    {profile?.name || (!coreContractConfigured ? localProfileName : null) || (coreContractConfigured ? "No profile created" : "No local alias")}
                  </p>
                  <p className="text-xs font-mono text-muted-foreground">
                    {walletAddress}
                  </p>
                </div>
              </DropdownMenuLabel>
              <DropdownMenuSeparator />
              {profile ? (
                <>
                  <div className="grid grid-cols-2 gap-2 p-2 text-sm">
                    <div className="rounded-lg border border-border/70 bg-background/60 p-3">
                      <p className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">Rank</p>
                      <p className="mt-1 font-heading text-lg font-bold">{profile.rankLabel}</p>
                    </div>
                    <div className="rounded-lg border border-border/70 bg-background/60 p-3">
                      <p className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">XP</p>
                      <p className="mt-1 font-heading text-lg font-bold">{profile.xp}/{profile.xpRequired}</p>
                    </div>
                    <div className="rounded-lg border border-border/70 bg-background/60 p-3">
                      <p className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">Record</p>
                      <p className="mt-1 font-heading text-lg font-bold">
                        {profile.wins}-{profile.losses}
                      </p>
                    </div>
                    <div className="rounded-lg border border-border/70 bg-background/60 p-3">
                      <p className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">Season</p>
                      <p className="mt-1 font-heading text-lg font-bold">{profile.currentSeasonId}</p>
                    </div>
                    {arenaEnv.hasVerdictNftAddress && (
                      <>
                        <div className="rounded-lg border border-border/70 bg-background/60 p-3">
                          <p className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">VNFT Level</p>
                          <p className="mt-1 font-heading text-lg font-bold">
                            {verdictBadge ? verdictBadge.level : "Not Minted"}
                          </p>
                        </div>
                        <div className="rounded-lg border border-border/70 bg-background/60 p-3">
                          <p className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">VNFT XP</p>
                          <p className="mt-1 font-heading text-lg font-bold">
                            {verdictBadge ? verdictBadge.permanentXp : profile.lifetimeWins * 100}
                          </p>
                        </div>
                      </>
                    )}
                  </div>
                  <div className="px-3 pb-2">
                    <p className="text-xs text-muted-foreground break-all">Profile: {profile.profileAddress}</p>
                    {arenaEnv.hasVerdictNftAddress && (
                      verdictBadge ? (
                        <p className="mt-1 text-xs text-muted-foreground break-all">
                          Verdict NFT: #{verdictBadge.tokenId} {verdictBadge.linked ? "(linked)" : "(unlinked)"}
                        </p>
                      ) : (
                        <p className="mt-1 text-xs text-muted-foreground">
                          Verdict NFT mints automatically once permanent XP reaches 1000.
                        </p>
                      )
                    )}
                    {profile.pendingReset && (
                      <p className="mt-1 text-xs text-primary">Season rollover is pending for this profile.</p>
                    )}
                  </div>
                  <DropdownMenuSeparator />
                  <div className="space-y-3 p-3">
                    <div className="space-y-2">
                      <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">Rename</p>
                      <Input
                        value={nextHandle}
                        onChange={(event) => setNextHandle(event.target.value.slice(0, 24))}
                        placeholder="New profile name"
                        className="bg-background/60"
                      />
                      <Button
                        variant="secondary"
                        className="w-full"
                        disabled={renameMutation.isPending || nextHandle.trim().length < 3}
                        onClick={() => renameMutation.mutate()}
                      >
                        {renameMutation.isPending ? "Updating..." : "Update Name"}
                      </Button>
                    </div>
                    {verdictBadge?.linked && (
                      <div className="space-y-2">
                        <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">Verdict NFT</p>
                        <Button
                          variant="secondary"
                          className="w-full"
                          disabled={unlinkVerdictMutation.isPending}
                          onClick={() => unlinkVerdictMutation.mutate()}
                        >
                          {unlinkVerdictMutation.isPending ? "Unlinking..." : "Unlink Verdict NFT"}
                        </Button>
                      </div>
                    )}
                    <div className="space-y-2">
                      <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">Wallet</p>
                      <Button variant="secondary" className="w-full" onClick={() => void handleDisconnect()}>
                        Disconnect Wallet
                      </Button>
                    </div>
                  </div>
                </>
              ) : (
                <div className="space-y-3 p-3">
                  <div className="text-sm text-muted-foreground">
                    {coreContractConfigured
                      ? "Create your permanent VerdictDotFun profile to unlock your handle, rank, and XP."
                      : localProfileName
                        ? "Using a local test alias for this wallet on the current browser."
                        : "Create a local alias before joining rooms or creating matches."}
                  </div>
                  <Button variant="secondary" className="w-full" onClick={() => void handleDisconnect()}>
                    Disconnect Wallet
                  </Button>
                </div>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        ) : (
          <Button variant="wallet" size="sm" onClick={openWalletModal}>
            Connect Wallet
          </Button>
        )}
      </div>
    </header>
  );
};

export default Header;
