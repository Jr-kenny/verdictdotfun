import { useMemo, useState } from "react";
import { Navigate, useNavigate, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { motion } from "framer-motion";
import { Gavel, Users } from "lucide-react";
import { toast } from "sonner";
import BackButton from "@/components/BackButton";
import Header from "@/components/Header";
import { Button } from "@/components/ui/button";
import { useArena } from "@/context/ArenaContext";
import { GAME_MODE_META, getArenaMode } from "@/lib/gameModes";
import { fetchStoredLocalProfileName, getLocalProfileQueryKey } from "@/lib/localProfile";
import { fetchArenaProfile } from "@/lib/profileFactory";
import {
  fetchRoom,
  forfeitRoom,
  isEmptyAddress,
  joinRoom,
  registerLocalProfile,
  resolveRoom,
  shouldUseLocalProfileAlias,
  startRoom,
  submitEntry,
} from "@/lib/verdictArena";

function getSubmissionPreview(text: string, showResolvedSubmissions: boolean) {
  if (showResolvedSubmissions) {
    return text || "No submission yet.";
  }
  if (text) {
    return "Submission received. Hidden until the verdict is finalized on-chain.";
  }
  return "No submission yet.";
}

function getWinnerLabel(winner: string, owner: string, opponent: string, ownerName: string, opponentName: string) {
  if (!winner || isEmptyAddress(winner)) {
    return "No winner";
  }
  if (winner.toLowerCase() === owner.toLowerCase()) {
    return ownerName || "Room owner";
  }
  if (winner.toLowerCase() === opponent.toLowerCase()) {
    return opponentName || "Opponent";
  }
  return "Unknown winner";
}

const RoomLobby = () => {
  const { roomId, mode: rawMode } = useParams();
  const mode = getArenaMode(rawMode);
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { walletAddress, walletReady, provider, ensureArenaNetwork, gameContracts } = useArena();
  const [submission, setSubmission] = useState("");

  const roomQuery = useQuery({
    queryKey: ["room", mode, roomId],
    queryFn: () => fetchRoom(mode!, roomId!),
    enabled: Boolean(roomId && mode) && gameContracts[mode ?? "argue"].status === "ready",
    refetchInterval: 2_000,
  });
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

  const room = roomQuery.data;
  const modeMeta = mode ? GAME_MODE_META[mode] : null;
  const isRiddleMode = mode === "riddle";
  const maxRiddleAttempts = 3;
  const activeIdentity = profileQuery.data?.profileAddress ?? walletAddress ?? null;
  const activeProfileName = profileQuery.data?.name ?? (shouldUseLocalProfileAlias() ? localProfileQuery.data ?? null : null);
  const missingProfileError = shouldUseLocalProfileAlias()
    ? "Create your player profile before interacting with rooms."
    : "Create your VerdictDotFun profile before interacting with rooms.";
  const showResolvedSubmissions = room?.status === "resolved";

  const amOwner = useMemo(
    () => Boolean(activeIdentity && room && room.owner.toLowerCase() === activeIdentity.toLowerCase()),
    [activeIdentity, room],
  );
  const amOpponent = useMemo(
    () => Boolean(activeIdentity && room && room.opponent.toLowerCase() === activeIdentity.toLowerCase()),
    [activeIdentity, room],
  );
  const isParticipant = amOwner || amOpponent;
  const canJoin = Boolean(walletAddress && room && !amOwner && isEmptyAddress(room.opponent));
  const canStart =
    mode === "argue" &&
    Boolean(walletAddress && room && amOwner && room.status === "ready_to_start") &&
    !isEmptyAddress(room?.opponent ?? "");
  const canSubmit =
    Boolean(walletAddress && room && room.status === "active" && (amOwner || amOpponent)) &&
    (
      isRiddleMode
        ? (amOwner && (room.ownerAttemptsUsed ?? 0) < maxRiddleAttempts) ||
          (amOpponent && (room.opponentAttemptsUsed ?? 0) < maxRiddleAttempts)
        : (amOwner && !room.ownerSubmission) || (amOpponent && !room.opponentSubmission)
    );
  const canResolve =
    mode === "argue" &&
    Boolean(walletAddress && room && room.status !== "resolved" && room.ownerSubmission && room.opponentSubmission) &&
    isParticipant;
  const canForfeit =
    Boolean(walletAddress && room && room.status !== "resolved" && isParticipant) &&
    !isEmptyAddress(room?.opponent ?? "");

  async function invalidateRoomState() {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["room", mode, roomId] }),
      queryClient.invalidateQueries({ queryKey: ["rooms"] }),
    ]);
  }

  const joinMutation = useMutation({
    mutationFn: async () => {
      if (!walletAddress || !provider || !roomId || !mode) {
        throw new Error("Wallet, provider, mode, or room is missing.");
      }
      if (shouldUseLocalProfileAlias() && !activeProfileName) {
        throw new Error(missingProfileError);
      }
      await ensureArenaNetwork();
      if (shouldUseLocalProfileAlias() && activeProfileName) {
        await registerLocalProfile(mode, walletAddress, provider, activeProfileName);
      }
      return joinRoom(mode, walletAddress, provider, roomId, profileQuery.data?.profileAddress ?? null);
    },
    onSuccess: async () => {
      await invalidateRoomState();
      toast.success("Joined room successfully.");
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : "Could not join room.");
    },
  });

  const submitMutation = useMutation({
    mutationFn: async () => {
      if (!walletAddress || !provider || !roomId || !mode) {
        throw new Error("Wallet, provider, mode, or room is missing.");
      }
      if (shouldUseLocalProfileAlias() && !activeProfileName) {
        throw new Error(missingProfileError);
      }
      await ensureArenaNetwork();
      if (shouldUseLocalProfileAlias() && activeProfileName) {
        await registerLocalProfile(mode, walletAddress, provider, activeProfileName);
      }
      await submitEntry(mode, walletAddress, provider, roomId, submission.trim());
      const resolutionStarted =
        mode === "riddle" ||
        (Boolean(room) && ((amOwner && Boolean(room.opponentSubmission)) || (amOpponent && Boolean(room.ownerSubmission))));
      return { resolutionStarted };
    },
    onSuccess: async ({ resolutionStarted }) => {
      setSubmission("");
      await invalidateRoomState();
      if (resolutionStarted || isRiddleMode) {
        await queryClient.invalidateQueries({ queryKey: ["profile", walletAddress] });
      }
      toast.success(
        isRiddleMode
          ? "Guess checked on-chain."
          : resolutionStarted
            ? "Submission sent. Resolution is processing on-chain."
            : "Submission sent on-chain.",
      );
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : "Submission failed.");
    },
  });

  const startMutation = useMutation({
    mutationFn: async () => {
      if (!walletAddress || !provider || !roomId || !mode) {
        throw new Error("Wallet, provider, mode, or room is missing.");
      }
      if (shouldUseLocalProfileAlias() && !activeProfileName) {
        throw new Error(missingProfileError);
      }
      await ensureArenaNetwork();
      if (shouldUseLocalProfileAlias() && activeProfileName) {
        await registerLocalProfile(mode, walletAddress, provider, activeProfileName);
      }
      return startRoom(mode, walletAddress, provider, roomId);
    },
    onSuccess: async () => {
      await invalidateRoomState();
      toast.success("Room start sent to chain.");
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : "Could not start the room.");
    },
  });

  const resolveMutation = useMutation({
    mutationFn: async () => {
      if (!walletAddress || !provider || !roomId || !mode) {
        throw new Error("Wallet, provider, mode, or room is missing.");
      }
      if (shouldUseLocalProfileAlias() && !activeProfileName) {
        throw new Error(missingProfileError);
      }
      await ensureArenaNetwork();
      if (shouldUseLocalProfileAlias() && activeProfileName) {
        await registerLocalProfile(mode, walletAddress, provider, activeProfileName);
      }
      return resolveRoom(mode, walletAddress, provider, roomId);
    },
    onSuccess: async () => {
      await invalidateRoomState();
      await queryClient.invalidateQueries({ queryKey: ["profile", walletAddress] });
      toast.success("Verdict resolution sent to chain.");
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : "Verdict resolution failed.");
    },
  });

  const forfeitMutation = useMutation({
    mutationFn: async () => {
      if (!walletAddress || !provider || !roomId || !mode) {
        throw new Error("Wallet, provider, mode, or room is missing.");
      }
      if (shouldUseLocalProfileAlias() && !activeProfileName) {
        throw new Error(missingProfileError);
      }
      await ensureArenaNetwork();
      if (shouldUseLocalProfileAlias() && activeProfileName) {
        await registerLocalProfile(mode, walletAddress, provider, activeProfileName);
      }
      return forfeitRoom(mode, walletAddress, provider, roomId);
    },
    onSuccess: async () => {
      await invalidateRoomState();
      await queryClient.invalidateQueries({ queryKey: ["profile", walletAddress] });
      toast.success("Forfeit sent to chain.");
      navigate("/lobby");
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : "Could not quit the room.");
    },
  });

  if (!walletReady) {
    return (
      <div className="min-h-screen bg-background text-foreground">
        <Header />
        <main className="mx-auto flex min-h-screen max-w-3xl items-center px-6 pt-24">
          <div className="w-full rounded-2xl border border-border/70 bg-card/80 p-8 text-muted-foreground">
            Restoring wallet session...
          </div>
        </main>
      </div>
    );
  }

  if (!walletAddress) {
    return <Navigate to="/" replace />;
  }

  if (!roomId || !mode || !modeMeta) {
    return <Navigate to="/lobby" replace />;
  }

  if (gameContracts[mode].status !== "ready") {
    return (
      <div className="min-h-screen bg-background text-foreground">
        <Header />
        <main className="mx-auto flex min-h-screen max-w-3xl items-center px-6 pt-24">
          <div className="w-full rounded-2xl border border-defeat/30 bg-card/80 p-8">
            <h1 className="font-heading text-3xl font-black">{modeMeta.title} contract not ready</h1>
            <p className="mt-3 text-muted-foreground">{gameContracts[mode].error ?? "This contract is not live yet."}</p>
          </div>
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background text-foreground">
      <Header />
      <main className="mx-auto max-w-5xl px-6 pb-12 pt-28">
        <div className="mb-8">
          <BackButton
            isGame={canForfeit}
            backTo="/lobby"
            onConfirm={canForfeit ? async () => {
              await forfeitMutation.mutateAsync();
            } : undefined}
            disabled={forfeitMutation.isPending}
          />
        </div>

        {!room && roomQuery.isLoading && (
          <div className="rounded-2xl border border-border/70 bg-card/80 p-8 text-muted-foreground">Loading room state...</div>
        )}

        {!room && !roomQuery.isLoading && (
          <div className="rounded-2xl border border-defeat/30 bg-card/80 p-8">
            <h1 className="font-heading text-3xl font-black">Room not found</h1>
            <p className="mt-3 text-muted-foreground">The room either does not exist or the contract could not return its state.</p>
          </div>
        )}

        {room && (
          <div className="space-y-8">
            <section className="rounded-3xl border border-border/70 bg-card/80 p-7">
              <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
                <div className="space-y-4">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="rounded-full border border-primary/30 bg-primary/10 px-3 py-1 text-xs uppercase tracking-[0.24em] text-primary">
                      {modeMeta.title}
                    </span>
                    {room.mode === "argue" && (
                      <span className="rounded-full border border-primary/20 px-3 py-1 text-xs uppercase tracking-[0.24em] text-primary/80">
                        {room.argueStyle === "convince" ? "Convince" : "Debate"}
                      </span>
                    )}
                    <span className="rounded-full border border-border px-3 py-1 text-xs text-muted-foreground">{room.category}</span>
                    <span className="rounded-full border border-border px-3 py-1 text-xs text-muted-foreground">Room {room.id}</span>
                  </div>

                  <div>
                    <h1 className="font-heading text-3xl font-black md:text-4xl">{room.prompt || "Match prompt pending"}</h1>
                    {room.houseStance && (
                      <p className="mt-3 max-w-2xl italic text-muted-foreground">{`House stance: "${room.houseStance}"`}</p>
                    )}
                  </div>
                </div>

                <div className="rounded-2xl border border-border/70 bg-background/60 px-5 py-4 text-center">
                  <p className="text-xs uppercase tracking-[0.24em] text-muted-foreground">Status</p>
                  <p
                    className={`mt-2 font-heading text-lg font-bold ${
                      room.status === "resolved" ? "text-victory" : room.status === "active" ? "text-primary" : "text-muted-foreground"
                    }`}
                  >
                    {room.status}
                  </p>
                </div>
              </div>
            </section>

            <div className="grid gap-8 lg:grid-cols-[0.9fr_1.1fr]">
              <section className="rounded-2xl border border-border/70 bg-card/80 p-6">
                <div className="mb-5 flex items-center gap-3">
                  <Users className="h-5 w-5 text-primary" />
                  <h2 className="font-heading text-2xl font-bold">Participants</h2>
                </div>

                <div className="space-y-4">
                  <div className="rounded-2xl border border-border/70 bg-background/50 p-4">
                    <p className="text-xs uppercase tracking-[0.22em] text-muted-foreground">{modeMeta.ownerLabel}</p>
                    <p className="mt-2 font-heading text-xl font-bold">{room.ownerName || "Unknown player"}</p>
                    <p className="mt-2 break-all text-xs text-muted-foreground">{room.owner}</p>
                  </div>

                  <div className="rounded-2xl border border-border/70 bg-background/50 p-4">
                    <p className="text-xs uppercase tracking-[0.22em] text-muted-foreground">{modeMeta.opponentLabel}</p>
                    <p className="mt-2 font-heading text-xl font-bold">
                      {room.opponentName || (isEmptyAddress(room.opponent) ? `Waiting for ${modeMeta.opponentLabel.toLowerCase()}` : "Unknown player")}
                    </p>
                    <p className="mt-2 break-all text-xs text-muted-foreground">{isEmptyAddress(room.opponent) ? "Open slot" : room.opponent}</p>
                  </div>

                  {canJoin && (
                    <Button variant="arena" className="w-full py-6 text-base" onClick={() => joinMutation.mutate()} disabled={joinMutation.isPending}>
                      {joinMutation.isPending ? "Joining..." : "Join Room"}
                    </Button>
                  )}

                  {canStart && (
                    <Button variant="arena" className="w-full py-6 text-base" onClick={() => startMutation.mutate()} disabled={startMutation.isPending}>
                      {startMutation.isPending ? "Starting..." : "Start Room"}
                    </Button>
                  )}

                  {room.status === "resolved" && (
                    <motion.div
                      initial={{ opacity: 0, y: 12 }}
                      animate={{ opacity: 1, y: 0 }}
                      className={`rounded-2xl border p-5 ${
                        isEmptyAddress(room.winner) ? "border-border/70 bg-background/50" : "border-victory/30 bg-victory/10"
                      }`}
                    >
                      <p className={`text-xs uppercase tracking-[0.24em] ${isEmptyAddress(room.winner) ? "text-muted-foreground" : "text-victory"}`}>
                        Final verdict
                      </p>
                      <h3 className="mt-3 font-heading text-2xl font-black">
                        Winner: {getWinnerLabel(room.winner, room.owner, room.opponent, room.ownerName, room.opponentName)}
                      </h3>
                      <div className="mt-4 grid gap-3">
                        <div className="rounded-xl border border-border/60 bg-background/60 p-4 text-sm">
                          <p className="text-muted-foreground">{room.ownerName || modeMeta.ownerLabel} {isRiddleMode ? "riddles" : "score"}</p>
                          <p className="mt-2 font-heading text-3xl font-black">{room.ownerScore}</p>
                        </div>
                        <div className="rounded-xl border border-border/60 bg-background/60 p-4 text-sm">
                          <p className="text-muted-foreground">{room.opponentName || modeMeta.opponentLabel} {isRiddleMode ? "riddles" : "score"}</p>
                          <p className="mt-2 font-heading text-3xl font-black">{room.opponentScore}</p>
                        </div>
                      </div>
                      <p className="mt-5 text-sm text-foreground/90">{room.verdictReasoning}</p>
                    </motion.div>
                  )}
                </div>
              </section>

              <section className="rounded-2xl border border-border/70 bg-card/80 p-6">
                <div className="mb-5 flex items-center gap-3">
                  <Gavel className="h-5 w-5 text-primary" />
                  <h2 className="font-heading text-2xl font-bold">Match state</h2>
                </div>

                <div className="space-y-5">
                  {isRiddleMode ? (
                    <>
                      <div className="grid gap-4 md:grid-cols-2">
                        <div className="rounded-2xl border border-border/70 bg-background/50 p-4">
                          <p className="text-xs uppercase tracking-[0.22em] text-muted-foreground">{room.ownerName || modeMeta.ownerLabel}</p>
                          <p className="mt-3 font-heading text-2xl font-bold">{room.ownerScore} solved</p>
                        </div>
                        <div className="rounded-2xl border border-border/70 bg-background/50 p-4">
                          <p className="text-xs uppercase tracking-[0.22em] text-muted-foreground">{room.opponentName || modeMeta.opponentLabel}</p>
                          <p className="mt-3 font-heading text-2xl font-bold">{room.opponentScore} solved</p>
                        </div>
                      </div>

                      {room.revealedAnswer && (
                        <div className="rounded-xl border border-primary/20 bg-primary/5 p-4 text-sm text-foreground/90">
                          Revealed answer from the last riddle: <span className="font-semibold">{room.revealedAnswer}</span>
                        </div>
                      )}

                      <div className="rounded-2xl border border-border/70 bg-background/50 p-5">
                        <h3 className="font-heading text-2xl font-bold">{room.prompt}</h3>
                        <p className="mt-3 text-sm text-muted-foreground">
                          First correct answer wins the riddle immediately. Each player gets up to {maxRiddleAttempts} guesses.
                        </p>
                      </div>

                      <div className="grid gap-4 md:grid-cols-2">
                        <div className="rounded-2xl border border-border/70 bg-background/50 p-4">
                          <p className="text-xs uppercase tracking-[0.22em] text-muted-foreground">{room.ownerName || modeMeta.ownerLabel} guesses used</p>
                          <p className="mt-3 font-heading text-2xl font-bold">{room.ownerAttemptsUsed ?? 0} / {maxRiddleAttempts}</p>
                        </div>
                        <div className="rounded-2xl border border-border/70 bg-background/50 p-4">
                          <p className="text-xs uppercase tracking-[0.22em] text-muted-foreground">{room.opponentName || modeMeta.opponentLabel} guesses used</p>
                          <p className="mt-3 font-heading text-2xl font-bold">{room.opponentAttemptsUsed ?? 0} / {maxRiddleAttempts}</p>
                        </div>
                      </div>
                    </>
                  ) : (
                    <div className="grid gap-4 md:grid-cols-2">
                      <div className="rounded-2xl border border-border/70 bg-background/50 p-4">
                        <p className="text-xs uppercase tracking-[0.22em] text-muted-foreground">{room.ownerName || modeMeta.ownerLabel} submission</p>
                        <p className="mt-3 text-sm text-muted-foreground">{getSubmissionPreview(room.ownerSubmission, showResolvedSubmissions)}</p>
                      </div>
                      <div className="rounded-2xl border border-border/70 bg-background/50 p-4">
                        <p className="text-xs uppercase tracking-[0.22em] text-muted-foreground">{room.opponentName || modeMeta.opponentLabel} submission</p>
                        <p className="mt-3 text-sm text-muted-foreground">{getSubmissionPreview(room.opponentSubmission, showResolvedSubmissions)}</p>
                      </div>
                    </div>
                  )}

                  {room.mode === "argue" && !room.prompt && room.status !== "resolved" && (
                    <div className="rounded-xl border border-border/60 bg-background/60 p-4 text-sm text-muted-foreground">
                      The room prompt will be generated after both players join and the room owner starts the match.
                    </div>
                  )}

                  {canSubmit && (
                    <div className="space-y-3">
                      <label className="block text-sm text-muted-foreground">{modeMeta.submissionLabel}</label>
                      <textarea
                        value={submission}
                        onChange={(event) => setSubmission(event.target.value)}
                        placeholder={modeMeta.submissionPlaceholder}
                        className="min-h-40 w-full rounded-xl border border-border bg-background/70 p-4 text-sm outline-none transition focus:border-primary/60"
                      />
                      <Button
                        variant="arena"
                        className="w-full py-6 text-base"
                        disabled={submitMutation.isPending || submission.trim().length < modeMeta.minimumSubmissionLength}
                        onClick={() => submitMutation.mutate()}
                      >
                        {submitMutation.isPending ? (isRiddleMode ? "Submitting..." : "Submitting...") : isRiddleMode ? "Lock Guess" : "Submit Entry"}
                      </Button>
                    </div>
                  )}

                  {canResolve && (
                    <div className="rounded-xl border border-border/60 bg-background/60 p-4 text-sm text-muted-foreground">
                      {resolveMutation.isPending
                        ? "Resolving the verdict on-chain now."
                        : "Both submissions are locked. Resolve the verdict on-chain below."}
                    </div>
                  )}

                  {canResolve && !resolveMutation.isPending && (
                    <Button variant="secondary" className="w-full py-6 text-base" onClick={() => resolveMutation.mutate()}>
                      Resolve Verdict
                    </Button>
                  )}
                </div>
              </section>
            </div>
          </div>
        )}
      </main>
    </div>
  );
};

export default RoomLobby;
