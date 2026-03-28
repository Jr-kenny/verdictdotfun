import { Navigate, useNavigate, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { motion } from "framer-motion";
import { toast } from "sonner";
import BackButton from "@/components/BackButton";
import Header from "@/components/Header";
import { Button } from "@/components/ui/button";
import { useArena } from "@/context/ArenaContext";
import { getArenaMode } from "@/lib/gameModes";
import { fetchStoredLocalProfileName, getLocalProfileQueryKey } from "@/lib/localProfile";
import { fetchArenaProfile } from "@/lib/profileFactory";
import { fetchRoom, forfeitRoom, readyQuiz, registerLocalProfile, shouldUseLocalProfileAlias } from "@/lib/verdictArena";

const QuizMaterial = () => {
  const { roomId, mode: rawMode } = useParams();
  const mode = getArenaMode(rawMode);
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { walletAddress, walletReady, provider, ensureArenaNetwork, gameContracts } = useArena();

  const roomQuery = useQuery({
    queryKey: ["room", mode, roomId],
    queryFn: () => fetchRoom(mode!, roomId!),
    enabled: Boolean(roomId && mode === "quiz") && gameContracts.quiz.status === "ready",
    refetchInterval: 5_000,
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
  const activeIdentity = profileQuery.data?.profileAddress ?? walletAddress ?? null;
  const activeProfileName = profileQuery.data?.name ?? (shouldUseLocalProfileAlias() ? localProfileQuery.data ?? null : null);
  const amOwner = Boolean(activeIdentity && room && room.owner.toLowerCase() === activeIdentity.toLowerCase());
  const amOpponent = Boolean(activeIdentity && room && room.opponent.toLowerCase() === activeIdentity.toLowerCase());
  const isParticipant = amOwner || amOpponent;
  const participantReady = amOwner ? room?.ownerReady : amOpponent ? room?.opponentReady : false;
  const canForfeit = Boolean(walletAddress && room && room.status !== "resolved" && isParticipant && room.opponent && room.opponent !== "0x0000000000000000000000000000000000000000");
  const missingProfileError = shouldUseLocalProfileAlias()
    ? "Create your player profile before interacting with rooms."
    : "Create your transferable profile before interacting with rooms.";

  const readyMutation = useMutation({
    mutationFn: async () => {
      if (!walletAddress || !provider || !roomId) {
        throw new Error("Wallet, provider, or room is missing.");
      }
      if (shouldUseLocalProfileAlias() && !activeProfileName) {
        throw new Error(missingProfileError);
      }

      await ensureArenaNetwork();
      if (shouldUseLocalProfileAlias() && activeProfileName) {
        await registerLocalProfile("quiz", walletAddress, provider, activeProfileName);
      }

      return readyQuiz(walletAddress, provider, roomId);
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["room", "quiz", roomId] });
      await queryClient.invalidateQueries({ queryKey: ["rooms"] });
      toast.success("Ready state submitted.");
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : "Could not mark ready.");
    },
  });

  const forfeitMutation = useMutation({
    mutationFn: async () => {
      if (!walletAddress || !provider || !roomId) {
        throw new Error("Wallet, provider, or room is missing.");
      }
      if (shouldUseLocalProfileAlias() && !activeProfileName) {
        throw new Error(missingProfileError);
      }

      await ensureArenaNetwork();
      if (shouldUseLocalProfileAlias() && activeProfileName) {
        await registerLocalProfile("quiz", walletAddress, provider, activeProfileName);
      }

      return forfeitRoom("quiz", walletAddress, provider, roomId);
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["room", "quiz", roomId] });
      await queryClient.invalidateQueries({ queryKey: ["rooms"] });
      await queryClient.invalidateQueries({ queryKey: ["profile", walletAddress] });
      toast.success("Match forfeited.");
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

  if (mode !== "quiz" || !roomId) {
    return <Navigate to="/lobby" replace />;
  }

  if (gameContracts.quiz.status !== "ready") {
    return <Navigate to="/lobby" replace />;
  }

  if (room?.status === "active" || room?.status === "resolved") {
    return <Navigate to={`/room/quiz/${roomId}`} replace />;
  }

  if (room && room.status !== "studying") {
    return <Navigate to={`/room/quiz/${roomId}`} replace />;
  }

  return (
    <div className="min-h-screen bg-background text-foreground">
      <Header />
      <main className="mx-auto max-w-5xl px-6 pb-12 pt-28">
        <div className="mb-8">
          <BackButton
            isGame={canForfeit}
            backTo={`/room/quiz/${roomId}`}
            onConfirm={canForfeit ? async () => {
              await forfeitMutation.mutateAsync();
            } : undefined}
            disabled={forfeitMutation.isPending}
          />
        </div>

        {!room && roomQuery.isLoading && (
          <div className="rounded-2xl border border-border/70 bg-card/80 p-8 text-muted-foreground">Loading study material...</div>
        )}

        {room && (
          <div className="space-y-8">
            <section className="rounded-3xl border border-border/70 bg-card/80 p-7">
              <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                <div>
                  <p className="text-xs uppercase tracking-[0.24em] text-primary">Quiz Material</p>
                  <h1 className="mt-3 font-heading text-3xl font-black md:text-4xl">{room.prompt}</h1>
                  {room.houseStance && <p className="mt-3 max-w-3xl text-muted-foreground">{room.houseStance}</p>}
                </div>
                <div className="rounded-2xl border border-border/70 bg-background/60 px-5 py-4 text-center">
                  <p className="text-xs uppercase tracking-[0.24em] text-muted-foreground">Room</p>
                  <p className="mt-2 font-heading text-lg font-bold">{room.id}</p>
                </div>
              </div>
            </section>

            <section className="rounded-3xl border border-border/70 bg-card/80 p-7">
              <div className="flex flex-col gap-6 lg:flex-row lg:items-start lg:justify-between">
                <div className="max-w-3xl">
                  <p className="text-xs uppercase tracking-[0.22em] text-muted-foreground">Study Note</p>
                  <div className="mt-4 rounded-2xl border border-border/70 bg-background/50 p-6">
                    <p className="whitespace-pre-line text-base leading-8 text-foreground/90">{room.materialBody}</p>
                  </div>
                </div>

                <div className="w-full max-w-sm space-y-4">
                  <div className="rounded-2xl border border-border/70 bg-background/50 p-5">
                    <p className="text-xs uppercase tracking-[0.22em] text-muted-foreground">Ready Check</p>
                    <div className="mt-4 space-y-3 text-sm">
                      <div className="flex items-center justify-between rounded-xl border border-border/60 px-4 py-3">
                        <span>{room.ownerName || "Player One"}</span>
                        <span className={room.ownerReady ? "text-victory" : "text-muted-foreground"}>
                          {room.ownerReady ? "Ready" : "Waiting"}
                        </span>
                      </div>
                      <div className="flex items-center justify-between rounded-xl border border-border/60 px-4 py-3">
                        <span>{room.opponentName || "Player Two"}</span>
                        <span className={room.opponentReady ? "text-victory" : "text-muted-foreground"}>
                          {room.opponentReady ? "Ready" : "Waiting"}
                        </span>
                      </div>
                    </div>
                  </div>

                  {isParticipant ? (
                    participantReady ? (
                      <div className="rounded-xl border border-border/60 bg-background/60 p-4 text-sm text-muted-foreground">
                        Your ready signal is recorded. Once both players are ready, the app will move back to the live quiz.
                      </div>
                    ) : (
                      <Button variant="arena" className="w-full py-6 text-base" onClick={() => readyMutation.mutate()} disabled={readyMutation.isPending}>
                        {readyMutation.isPending ? "Signing..." : "Ready Up"}
                      </Button>
                    )
                  ) : (
                    <div className="rounded-xl border border-border/60 bg-background/60 p-4 text-sm text-muted-foreground">
                      Only the two quiz participants can signal readiness from this page.
                    </div>
                  )}

                  <Button variant="secondary" className="w-full" onClick={() => navigate(`/room/quiz/${roomId}`)}>
                    Back To Quiz Room
                  </Button>
                </div>
              </div>
            </section>
          </div>
        )}
      </main>
    </div>
  );
};

export default QuizMaterial;
