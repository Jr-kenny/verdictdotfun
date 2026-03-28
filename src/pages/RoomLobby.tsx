import { useEffect, useMemo, useState } from "react";
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
  acceptQuizRoom,
  fetchQuizPlayerState,
  fetchQuizQuestion,
  fetchRoom,
  forfeitRoom,
  isEmptyAddress,
  joinRoom,
  registerLocalProfile,
  resolveRoom,
  shouldUseLocalProfileAlias,
  startQuiz,
  submitEntry,
  submitQuizAnswer,
  waitForRoomState,
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

function getWinnerLabel(
  winner: string,
  owner: string,
  opponent: string,
  ownerName: string,
  opponentName: string,
) {
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
  const [selectedQuizOption, setSelectedQuizOption] = useState<number | null>(null);

  const roomQuery = useQuery({
    queryKey: ["room", mode, roomId],
    queryFn: () => fetchRoom(mode!, roomId!),
    enabled: Boolean(roomId && mode) && gameContracts[mode ?? "debate"].status === "ready",
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
  const modeMeta = mode ? GAME_MODE_META[mode] : null;
  const isQuizMode = mode === "quiz";
  const isRiddleMode = mode === "riddle";
  const activeIdentity = profileQuery.data?.profileAddress ?? walletAddress ?? null;
  const normalizedActiveIdentity = activeIdentity?.toLowerCase() ?? null;
  const quizPlayerStateQuery = useQuery({
    queryKey: ["quiz-player-state", roomId, activeIdentity],
    queryFn: () => fetchQuizPlayerState(roomId!, activeIdentity! as `0x${string}`),
    enabled: Boolean(
      activeIdentity &&
        roomId &&
        room &&
        isQuizMode &&
        (room.owner.toLowerCase() === activeIdentity.toLowerCase() ||
          room.opponent.toLowerCase() === activeIdentity.toLowerCase()),
    ),
    refetchInterval: 3_000,
  });
  const quizQuestionQuery = useQuery({
    queryKey: ["quiz-question", roomId, room?.currentQuestionIndex],
    queryFn: () => fetchQuizQuestion(roomId!),
    enabled: Boolean(roomId && room && isQuizMode && room.status === "active" && (room.questionCount ?? 0) > 0),
    refetchInterval: 3_000,
  });

  const quizPlayerState = quizPlayerStateQuery.data;
  const quizQuestion = quizQuestionQuery.data;
  const showResolvedSubmissions = room?.status === "resolved";
  const activeProfileName = profileQuery.data?.name ?? (shouldUseLocalProfileAlias() ? localProfileQuery.data ?? null : null);
  const missingProfileError = shouldUseLocalProfileAlias()
    ? "Create your player profile before interacting with rooms."
    : "Create your transferable profile before interacting with rooms.";

  const amOwner = useMemo(() => {
    return Boolean(activeIdentity && room && room.owner.toLowerCase() === activeIdentity.toLowerCase());
  }, [activeIdentity, room]);

  const amOpponent = useMemo(() => {
    return Boolean(activeIdentity && room && room.opponent.toLowerCase() === activeIdentity.toLowerCase());
  }, [activeIdentity, room]);

  const isParticipant = amOwner || amOpponent;
  const canJoin = Boolean(walletAddress && room && !amOwner && isEmptyAddress(room.opponent));
  const canAcceptQuiz = Boolean(isQuizMode && walletAddress && room && room.status === "pending_accept" && amOpponent);
  const canStartQuiz = Boolean(isQuizMode && walletAddress && room && room.status === "ready_to_start" && amOwner);
  const canSubmitQuiz = Boolean(
    isQuizMode &&
      walletAddress &&
      room &&
      room.status === "active" &&
      isParticipant &&
      quizPlayerState?.canAnswer &&
      quizQuestion &&
      selectedQuizOption !== null,
  );
  const canSubmitStandard =
    !isQuizMode &&
    !isRiddleMode &&
    Boolean(walletAddress && room && room.status !== "resolved" && (amOwner || amOpponent)) &&
    ((amOwner && !room.ownerSubmission) || (amOpponent && !room.opponentSubmission));
  const canSubmitRiddle =
    isRiddleMode &&
    Boolean(walletAddress && room && room.status === "active" && isParticipant) &&
    ((amOwner && !room.ownerSubmission) || (amOpponent && !room.opponentSubmission));
  const canResolveQuiz = Boolean(
    isQuizMode &&
      walletAddress &&
      room &&
      room.status !== "resolved" &&
      isParticipant &&
      (room.questionCount ?? 0) > 0 &&
      (room.currentQuestionIndex ?? 0) > (room.questionCount ?? 0),
  );
  const canResolveStandard =
    !isQuizMode &&
    !isRiddleMode &&
    Boolean(walletAddress && room && room.status !== "resolved" && room.ownerSubmission && room.opponentSubmission) &&
    isParticipant;
  const canResolve = canResolveQuiz || canResolveStandard;
  const canForfeit =
    Boolean(walletAddress && room && room.status !== "resolved" && isParticipant) &&
    !isEmptyAddress(room?.opponent ?? "");
  const quizTurnIsMine =
    isQuizMode &&
    room &&
    room.status === "active" &&
    (room.currentTurn ? room.currentTurn.toLowerCase() === normalizedActiveIdentity : true);
  useEffect(() => {
    setSelectedQuizOption(null);
  }, [room?.currentQuestionIndex, room?.status]);

  async function invalidateRoomState() {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["room", mode, roomId] }),
      queryClient.invalidateQueries({ queryKey: ["rooms"] }),
      queryClient.invalidateQueries({ queryKey: ["quiz-player-state", roomId, activeIdentity] }),
      queryClient.invalidateQueries({ queryKey: ["quiz-question", roomId] }),
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
      toast.success(isQuizMode ? "Joined the quiz room. Accept it to continue." : "Joined room successfully.");
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : "Could not join room.");
    },
  });

  const acceptMutation = useMutation({
    mutationFn: async () => {
      if (!walletAddress || !provider || !roomId) {
        throw new Error("Wallet, provider, or room is missing.");
      }

      await ensureArenaNetwork();
      return acceptQuizRoom(walletAddress, provider, roomId);
    },
    onSuccess: async () => {
      await invalidateRoomState();
      toast.success("Quiz room accepted.");
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : "Could not accept the room.");
    },
  });

  const startQuizMutation = useMutation({
    mutationFn: async () => {
      if (!walletAddress || !provider || !roomId) {
        throw new Error("Wallet, provider, or room is missing.");
      }

      await ensureArenaNetwork();
      return startQuiz(walletAddress, provider, roomId);
    },
    onSuccess: async () => {
      await invalidateRoomState();
      toast.success("Quiz generated. Read the material and ready up.");
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : "Could not start the quiz.");
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

      if (isQuizMode) {
        if (!quizQuestion || selectedQuizOption === null) {
          throw new Error("Choose one of the five options first.");
        }

        await submitQuizAnswer(walletAddress, provider, roomId, quizQuestion.questionIndex, selectedQuizOption);
        return { awaitedResolution: false };
      }

      await submitEntry(mode, walletAddress, provider, roomId, submission.trim());
      const awaitedResolution =
        !isRiddleMode &&
        Boolean(room) &&
        ((amOwner && Boolean(room.opponentSubmission)) || (amOpponent && Boolean(room.ownerSubmission)));

      return { awaitedResolution };
    },
    onSuccess: async (result) => {
      if (isQuizMode) {
        setSelectedQuizOption(null);
      } else {
        setSubmission("");
      }

      if (result?.awaitedResolution && roomId && mode) {
        await waitForRoomState(mode, roomId, (nextRoom) => nextRoom.status === "resolved");
      }

      await invalidateRoomState();
      toast.success(
        isQuizMode
          ? "Answer submitted to the contract."
          : result?.awaitedResolution
            ? "Submission accepted and verdict finalized on-chain."
            : "Submission accepted.",
      );
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
      toast.success("Verdict finalized on-chain.");
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

  if (isQuizMode && room && room.status === "studying" && isParticipant) {
    return <Navigate to={`/room/quiz/${room.id}/material`} replace />;
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
                    <span className="rounded-full border border-border px-3 py-1 text-xs text-muted-foreground">
                      {room.category}
                    </span>
                    <span className="rounded-full border border-border px-3 py-1 text-xs text-muted-foreground">
                      Room {room.id}
                    </span>
                  </div>

                  <div>
                    <h1 className="font-heading text-3xl font-black md:text-4xl">
                      {room.prompt || (isQuizMode ? "Quiz room awaiting generation" : "Match prompt pending")}
                    </h1>
                    {room.houseStance && (
                      <p className="mt-3 max-w-2xl italic text-muted-foreground">
                        {isQuizMode ? room.houseStance : `House stance: "${room.houseStance}"`}
                      </p>
                    )}
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
                    {isQuizMode && room.ownerReady && <p className="mt-2 text-xs uppercase tracking-[0.2em] text-victory">Ready</p>}
                  </div>

                  <div className="rounded-2xl border border-border/70 bg-background/50 p-4">
                    <p className="text-xs uppercase tracking-[0.22em] text-muted-foreground">{modeMeta.opponentLabel}</p>
                    <p className="mt-2 font-heading text-xl font-bold">
                      {room.opponentName || (isEmptyAddress(room.opponent) ? `Waiting for ${modeMeta.opponentLabel.toLowerCase()}` : "Unknown player")}
                    </p>
                    <p className="mt-2 break-all text-xs text-muted-foreground">
                      {isEmptyAddress(room.opponent) ? "Open slot" : room.opponent}
                    </p>
                    {isQuizMode && room.opponentReady && <p className="mt-2 text-xs uppercase tracking-[0.2em] text-victory">Ready</p>}
                  </div>

                  {canJoin && (
                    <Button variant="arena" className="w-full py-6 text-base" onClick={() => joinMutation.mutate()} disabled={joinMutation.isPending}>
                      {joinMutation.isPending ? "Joining..." : "Join Room"}
                    </Button>
                  )}

                  {canAcceptQuiz && (
                    <Button
                      variant="arena"
                      className="w-full py-6 text-base"
                      onClick={() => acceptMutation.mutate()}
                      disabled={acceptMutation.isPending}
                    >
                      {acceptMutation.isPending ? "Accepting..." : "Accept Quiz"}
                    </Button>
                  )}

                  {canStartQuiz && (
                    <Button
                      variant="arena"
                      className="w-full py-6 text-base"
                      onClick={() => startQuizMutation.mutate()}
                      disabled={startQuizMutation.isPending}
                    >
                      {startQuizMutation.isPending ? "Generating..." : "Start Quiz"}
                    </Button>
                  )}

                  {isQuizMode && room.status === "studying" && (
                    <Button variant="secondary" className="w-full py-6 text-base" onClick={() => navigate(`/room/quiz/${room.id}/material`)}>
                      Open Study Material
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
                          <p className="text-muted-foreground">{room.ownerName || modeMeta.ownerLabel} {isQuizMode ? "questions" : isRiddleMode ? "riddles" : "score"}</p>
                          <p className="mt-2 font-heading text-3xl font-black">{room.ownerScore}</p>
                        </div>
                        <div className="rounded-xl border border-border/60 bg-background/60 p-4 text-sm">
                          <p className="text-muted-foreground">{room.opponentName || modeMeta.opponentLabel} {isQuizMode ? "questions" : isRiddleMode ? "riddles" : "score"}</p>
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
                  {isQuizMode ? (
                    <>
                      <div className="grid gap-4 md:grid-cols-2">
                        <div className="rounded-2xl border border-border/70 bg-background/50 p-4">
                          <p className="text-xs uppercase tracking-[0.22em] text-muted-foreground">
                            {room.ownerName || modeMeta.ownerLabel}
                          </p>
                          <p className="mt-3 font-heading text-2xl font-bold">{room.ownerQuestionsSecured ?? 0} secured</p>
                          <p className="mt-2 text-sm text-muted-foreground">
                            Attempts used on this question: {room.ownerAttemptsUsed ?? 0} / 2
                          </p>
                        </div>
                        <div className="rounded-2xl border border-border/70 bg-background/50 p-4">
                          <p className="text-xs uppercase tracking-[0.22em] text-muted-foreground">
                            {room.opponentName || modeMeta.opponentLabel}
                          </p>
                          <p className="mt-3 font-heading text-2xl font-bold">{room.opponentQuestionsSecured ?? 0} secured</p>
                          <p className="mt-2 text-sm text-muted-foreground">
                            Attempts used on this question: {room.opponentAttemptsUsed ?? 0} / 2
                          </p>
                        </div>
                      </div>

                      {room.revealedAnswer && (
                        <div className="rounded-xl border border-primary/20 bg-primary/5 p-4 text-sm text-foreground/90">
                          Revealed answer from the previous question: <span className="font-semibold">{room.revealedAnswer}</span>
                        </div>
                      )}

                      {room.status === "active" && quizQuestion && (
                        <div className="space-y-4 rounded-2xl border border-border/70 bg-background/50 p-5">
                          <div>
                            <div className="flex flex-wrap items-center gap-2 text-xs uppercase tracking-[0.22em] text-muted-foreground">
                              <span>Question {quizQuestion.questionIndex}</span>
                              <span>{quizQuestion.questionIndex} / {room.questionCount ?? 11}</span>
                              <span>Race to 6</span>
                            </div>
                            <h3 className="mt-2 font-heading text-2xl font-bold">{quizQuestion.question}</h3>
                          </div>

                          {room.currentTurn && !isEmptyAddress(room.currentTurn) && quizPlayerState && (
                            <div className="rounded-xl border border-border/60 bg-background/70 p-4 text-sm text-muted-foreground">
                              {quizTurnIsMine
                                ? `Your follow-up attempt is live. You have ${quizPlayerState.attemptsRemaining} attempt${quizPlayerState.attemptsRemaining === 1 ? "" : "s"} left on this question.`
                                : "The contract handed this question to the other player after your miss. Wait for their attempt to settle."}
                            </div>
                          )}

                          <div className="grid gap-3">
                            {quizQuestion.options.map((option, index) => {
                              const selected = selectedQuizOption === index;

                              return (
                                <button
                                  type="button"
                                  key={`${quizQuestion.questionIndex}-${index}`}
                                  onClick={() => setSelectedQuizOption(index)}
                                  className={`rounded-xl border px-4 py-4 text-left text-sm transition ${
                                    selected
                                      ? "border-primary bg-primary/10 text-foreground"
                                      : "border-border bg-card/60 text-muted-foreground hover:border-primary/30 hover:text-foreground"
                                  }`}
                                >
                                  <span className="font-semibold text-foreground">{String.fromCharCode(65 + index)}.</span> {option}
                                </button>
                              );
                            })}
                          </div>

                          <Button
                            variant="arena"
                            className="w-full py-6 text-base"
                            disabled={!canSubmitQuiz || submitMutation.isPending}
                            onClick={() => submitMutation.mutate()}
                          >
                            {submitMutation.isPending ? "Submitting..." : "Lock Answer"}
                          </Button>
                        </div>
                      )}
                    </>
                  ) : isRiddleMode ? (
                    <>
                      <div className="grid gap-4 md:grid-cols-2">
                        <div className="rounded-2xl border border-border/70 bg-background/50 p-4">
                          <p className="text-xs uppercase tracking-[0.22em] text-muted-foreground">
                            {room.ownerName || modeMeta.ownerLabel}
                          </p>
                          <p className="mt-3 font-heading text-2xl font-bold">{room.ownerScore} solved</p>
                          <p className="mt-2 text-sm text-muted-foreground">Race target: 3 correct riddles</p>
                        </div>
                        <div className="rounded-2xl border border-border/70 bg-background/50 p-4">
                          <p className="text-xs uppercase tracking-[0.22em] text-muted-foreground">
                            {room.opponentName || modeMeta.opponentLabel}
                          </p>
                          <p className="mt-3 font-heading text-2xl font-bold">{room.opponentScore} solved</p>
                          <p className="mt-2 text-sm text-muted-foreground">Round {room.currentQuestionIndex ?? 1} of {room.questionCount ?? 5}</p>
                        </div>
                      </div>

                      {room.revealedAnswer && (
                        <div className="rounded-xl border border-primary/20 bg-primary/5 p-4 text-sm text-foreground/90">
                          Revealed answer from the last riddle: <span className="font-semibold">{room.revealedAnswer}</span>
                        </div>
                      )}

                      <div className="rounded-2xl border border-border/70 bg-background/50 p-5">
                        <div className="flex flex-wrap items-center gap-2 text-xs uppercase tracking-[0.22em] text-muted-foreground">
                          <span>Riddle {room.currentQuestionIndex ?? 1}</span>
                          <span>{room.currentQuestionIndex ?? 1} / {room.questionCount ?? 5}</span>
                        </div>
                        <h3 className="mt-2 font-heading text-2xl font-bold">{room.prompt}</h3>
                      </div>

                      <div className="grid gap-4 md:grid-cols-2">
                        <div className="rounded-2xl border border-border/70 bg-background/50 p-4">
                          <p className="text-xs uppercase tracking-[0.22em] text-muted-foreground">
                            {room.ownerName || modeMeta.ownerLabel}
                          </p>
                          <p className="mt-3 text-sm text-muted-foreground">
                            {room.ownerSubmission ? "Guess locked for this riddle." : "No guess submitted yet."}
                          </p>
                        </div>
                        <div className="rounded-2xl border border-border/70 bg-background/50 p-4">
                          <p className="text-xs uppercase tracking-[0.22em] text-muted-foreground">
                            {room.opponentName || modeMeta.opponentLabel}
                          </p>
                          <p className="mt-3 text-sm text-muted-foreground">
                            {room.opponentSubmission ? "Guess locked for this riddle." : "No guess submitted yet."}
                          </p>
                        </div>
                      </div>

                      {room.status === "active" && isParticipant && !canSubmitRiddle && (
                        <div className="rounded-xl border border-border/60 bg-background/60 p-4 text-sm text-muted-foreground">
                          Your guess is locked for this riddle. Waiting for the other player to answer.
                        </div>
                      )}

                      {canSubmitRiddle && (
                        <div className="space-y-3">
                          <label className="block text-sm text-muted-foreground">{modeMeta.submissionLabel}</label>
                          <textarea
                            value={submission}
                            onChange={(event) => setSubmission(event.target.value)}
                            placeholder={modeMeta.submissionPlaceholder}
                            className="min-h-32 w-full rounded-xl border border-border bg-background/70 p-4 text-sm outline-none transition focus:border-primary/60"
                          />
                          <Button
                            variant="arena"
                            className="w-full py-6 text-base"
                            disabled={submitMutation.isPending || submission.trim().length < modeMeta.minimumSubmissionLength}
                            onClick={() => submitMutation.mutate()}
                          >
                            {submitMutation.isPending ? "Submitting..." : "Lock Guess"}
                          </Button>
                        </div>
                      )}
                    </>
                  ) : (
                    <>
                      <div className="grid gap-4 md:grid-cols-2">
                        <div className="rounded-2xl border border-border/70 bg-background/50 p-4">
                          <p className="text-xs uppercase tracking-[0.22em] text-muted-foreground">
                            {room.ownerName || modeMeta.ownerLabel} submission
                          </p>
                          <p className="mt-3 text-sm text-muted-foreground">
                            {getSubmissionPreview(room.ownerSubmission, showResolvedSubmissions)}
                          </p>
                        </div>
                        <div className="rounded-2xl border border-border/70 bg-background/50 p-4">
                          <p className="text-xs uppercase tracking-[0.22em] text-muted-foreground">
                            {room.opponentName || modeMeta.opponentLabel} submission
                          </p>
                          <p className="mt-3 text-sm text-muted-foreground">
                            {getSubmissionPreview(room.opponentSubmission, showResolvedSubmissions)}
                          </p>
                        </div>
                      </div>

                      {canSubmitStandard && (
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
                    </>
                  )}

                  {canResolve && (
                    <div className="rounded-xl border border-border/60 bg-background/60 p-4 text-sm text-muted-foreground">
                      {resolveMutation.isPending
                        ? isQuizMode
                          ? "The quiz reached its finish condition. Finalizing the winner on-chain now."
                          : "Retrying verdict resolution on-chain now."
                        : isQuizMode
                          ? "If the quiz already exhausted its questions but did not finalize, retry the on-chain resolution below."
                          : "The second submission should resolve the room in the same transaction. If it stalled, retry manually below."}
                    </div>
                  )}

                  {canResolve && !resolveMutation.isPending && (
                    <Button variant="secondary" className="w-full py-6 text-base" onClick={() => resolveMutation.mutate()}>
                      {isQuizMode ? "Finalize Quiz Winner" : "Retry Verdict Resolution"}
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
