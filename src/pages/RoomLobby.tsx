import { useMemo, useState } from "react";
import { Navigate, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { motion } from "framer-motion";
import { Gavel, Users } from "lucide-react";
import { toast } from "sonner";
import BackButton from "@/components/BackButton";
import Header from "@/components/Header";
import { Button } from "@/components/ui/button";
import { useArena } from "@/context/ArenaContext";
import { GAME_MODE_META, getArenaMode } from "@/lib/gameModes";
import { fetchRoom, isEmptyAddress, joinRoom, resolveRoom, submitEntry } from "@/lib/verdictArena";

const RoomLobby = () => {
  const { roomId, mode: rawMode } = useParams();
  const mode = getArenaMode(rawMode);
  const queryClient = useQueryClient();
  const { walletAddress, provider, ensureArenaNetwork, gameContracts } = useArena();
  const [submission, setSubmission] = useState("");

  const roomQuery = useQuery({
    queryKey: ["room", mode, roomId],
    queryFn: () => fetchRoom(mode!, roomId!),
    enabled: Boolean(roomId && mode) && gameContracts[mode ?? "debate"].status === "ready",
    refetchInterval: 5_000,
  });

  const room = roomQuery.data;
  const modeMeta = mode ? GAME_MODE_META[mode] : null;

  const amOwner = useMemo(() => {
    return Boolean(walletAddress && room && room.owner.toLowerCase() === walletAddress.toLowerCase());
  }, [room, walletAddress]);

  const amOpponent = useMemo(() => {
    return Boolean(walletAddress && room && room.opponent.toLowerCase() === walletAddress.toLowerCase());
  }, [room, walletAddress]);

  const canJoin = Boolean(walletAddress && room && !amOwner && isEmptyAddress(room.opponent));
  const canSubmit =
    Boolean(walletAddress && room && room.status !== "resolved" && (amOwner || amOpponent)) &&
    ((amOwner && !room.ownerSubmission) || (amOpponent && !room.opponentSubmission));
  const canResolve = Boolean(walletAddress && room && room.status !== "resolved" && room.ownerSubmission && room.opponentSubmission) &&
    (amOwner || amOpponent);

  const joinMutation = useMutation({
    mutationFn: async () => {
      if (!walletAddress || !provider || !roomId || !mode) {
        throw new Error("Wallet, provider, mode, or room is missing.");
      }

      await ensureArenaNetwork();
      return joinRoom(mode, walletAddress, provider, roomId);
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["room", mode, roomId] });
      await queryClient.invalidateQueries({ queryKey: ["rooms"] });
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

      await ensureArenaNetwork();
      return submitEntry(mode, walletAddress, provider, roomId, submission.trim());
    },
    onSuccess: async () => {
      setSubmission("");
      await queryClient.invalidateQueries({ queryKey: ["room", mode, roomId] });
      await queryClient.invalidateQueries({ queryKey: ["rooms"] });
      toast.success("Submission accepted.");
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : "Submission failed.");
    },
  });

  const resolveMutation = useMutation({
    mutationFn: async () => {
      if (!walletAddress || !provider || !roomId || !mode) {
        throw new Error("Wallet, provider, mode, or room is missing.");
      }

      await ensureArenaNetwork();
      return resolveRoom(mode, walletAddress, provider, roomId);
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["room", mode, roomId] });
      await queryClient.invalidateQueries({ queryKey: ["rooms"] });
      await queryClient.invalidateQueries({ queryKey: ["profile-nft", walletAddress] });
      toast.success("Verdict finalized on-chain.");
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : "Verdict resolution failed.");
    },
  });

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
            <p className="mt-3 text-muted-foreground">
              {gameContracts[mode].error ?? "This contract is not live yet."}
            </p>
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
          <BackButton backTo="/lobby" />
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
                    <span className="rounded-full border border-border px-3 py-1 text-xs text-muted-foreground">
                      {room.category}
                    </span>
                    <span className="rounded-full border border-border px-3 py-1 text-xs text-muted-foreground">
                      Room {room.id}
                    </span>
                  </div>

                  <div>
                    <h1 className="font-heading text-3xl font-black md:text-4xl">{room.prompt}</h1>
                    {room.houseStance && <p className="mt-3 max-w-2xl italic text-muted-foreground">House stance: "{room.houseStance}"</p>}
                  </div>
                </div>

                <div className="rounded-2xl border border-border/70 bg-background/60 px-5 py-4 text-center">
                  <p className="text-xs uppercase tracking-[0.24em] text-muted-foreground">Status</p>
                  <p
                    className={`mt-2 font-heading text-lg font-bold ${
                      room.status === "resolved"
                        ? "text-victory"
                        : room.status === "active"
                          ? "text-primary"
                          : "text-muted-foreground"
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
                    <p className="mt-2 break-all text-xs text-muted-foreground">
                      {isEmptyAddress(room.opponent) ? "Open slot" : room.opponent}
                    </p>
                  </div>

                  {canJoin && (
                    <Button variant="arena" className="w-full py-6 text-base" onClick={() => joinMutation.mutate()} disabled={joinMutation.isPending}>
                      {joinMutation.isPending ? "Joining..." : "Join Room"}
                    </Button>
                  )}
                </div>
              </section>

              <section className="rounded-2xl border border-border/70 bg-card/80 p-6">
                <div className="mb-5 flex items-center gap-3">
                  <Gavel className="h-5 w-5 text-primary" />
                  <h2 className="font-heading text-2xl font-bold">Match state</h2>
                </div>

                <div className="space-y-5">
                  <div className="grid gap-4 md:grid-cols-2">
                    <div className="rounded-2xl border border-border/70 bg-background/50 p-4">
                      <p className="text-xs uppercase tracking-[0.22em] text-muted-foreground">
                        {room.ownerName || modeMeta.ownerLabel} submission
                      </p>
                      <p className="mt-3 text-sm text-muted-foreground">
                        {room.ownerSubmission || "No submission yet."}
                      </p>
                    </div>
                    <div className="rounded-2xl border border-border/70 bg-background/50 p-4">
                      <p className="text-xs uppercase tracking-[0.22em] text-muted-foreground">
                        {room.opponentName || modeMeta.opponentLabel} submission
                      </p>
                      <p className="mt-3 text-sm text-muted-foreground">
                        {room.opponentSubmission || "No submission yet."}
                      </p>
                    </div>
                  </div>

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
                        {submitMutation.isPending ? "Submitting..." : "Submit Entry"}
                      </Button>
                    </div>
                  )}

                  {canResolve && (
                    <Button
                      variant="secondary"
                      className="w-full py-6 text-base"
                      disabled={resolveMutation.isPending}
                      onClick={() => resolveMutation.mutate()}
                    >
                      {resolveMutation.isPending ? "Resolving With GenLayer..." : "Resolve Verdict"}
                    </Button>
                  )}

                  {room.status === "resolved" && (
                    <motion.div
                      initial={{ opacity: 0, y: 12 }}
                      animate={{ opacity: 1, y: 0 }}
                      className="rounded-2xl border border-victory/30 bg-victory/10 p-5"
                    >
                      <p className="text-xs uppercase tracking-[0.24em] text-victory">Final verdict</p>
                      <h3 className="mt-3 font-heading text-2xl font-black">
                        Winner: {room.winner.toLowerCase() === room.owner.toLowerCase() ? room.ownerName : room.opponentName}
                      </h3>
                      <div className="mt-4 grid gap-3 md:grid-cols-2">
                        <div className="rounded-xl border border-border/60 bg-background/60 p-4 text-sm">
                          <p className="text-muted-foreground">{room.ownerName || modeMeta.ownerLabel} score</p>
                          <p className="mt-2 font-heading text-3xl font-black">{room.ownerScore}</p>
                        </div>
                        <div className="rounded-xl border border-border/60 bg-background/60 p-4 text-sm">
                          <p className="text-muted-foreground">{room.opponentName || modeMeta.opponentLabel} score</p>
                          <p className="mt-2 font-heading text-3xl font-black">{room.opponentScore}</p>
                        </div>
                      </div>
                      <p className="mt-5 text-sm text-foreground/90">{room.verdictReasoning}</p>
                    </motion.div>
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
