import { useEffect, useMemo, useState } from "react";
import { Link, Navigate, useNavigate } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { motion } from "framer-motion";
import { Plus, RefreshCw, Swords } from "lucide-react";
import { toast } from "sonner";
import Header from "@/components/Header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useArena } from "@/context/ArenaContext";
import { ARENA_MODES, GAME_MODE_META } from "@/lib/gameModes";
import { fetchProfileNft } from "@/lib/profileNft";
import { createRoom, fetchAllRooms, isEmptyAddress } from "@/lib/verdictArena";
import type { ArenaMode } from "@/types/arena";

function makeRoomId() {
  return Math.random().toString(36).slice(2, 8).toUpperCase();
}

const Lobby = () => {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { walletAddress, provider, ensureArenaNetwork, readyModes, gameContracts } = useArena();

  const [mode, setMode] = useState<ArenaMode>("debate");
  const [category, setCategory] = useState(GAME_MODE_META.debate.defaultCategory);
  const [prompt, setPrompt] = useState("");

  useEffect(() => {
    if (readyModes.length === 0) {
      return;
    }

    if (!readyModes.includes(mode)) {
      const nextMode = readyModes[0];
      setMode(nextMode);
      setCategory(GAME_MODE_META[nextMode].defaultCategory);
    }
  }, [mode, readyModes]);

  const profileQuery = useQuery({
    queryKey: ["profile-nft", walletAddress],
    queryFn: () => fetchProfileNft(walletAddress!),
    enabled: Boolean(walletAddress),
  });

  const roomsQuery = useQuery({
    queryKey: ["rooms", readyModes.join(",")],
    queryFn: () => fetchAllRooms(readyModes),
    enabled: readyModes.length > 0,
    refetchInterval: 7_500,
  });

  const visibleRooms = useMemo(() => {
    return [...(roomsQuery.data ?? [])].sort((left, right) => {
      if (left.mode === right.mode) {
        return right.id.localeCompare(left.id);
      }

      return left.mode.localeCompare(right.mode);
    });
  }, [roomsQuery.data]);

  const createRoomMutation = useMutation({
    mutationFn: async () => {
      if (!walletAddress || !provider) {
        throw new Error("Connect a wallet before creating rooms.");
      }

      const roomId = makeRoomId();
      await ensureArenaNetwork();
      await createRoom(mode, walletAddress, provider, {
        roomId,
        category: category.trim(),
        prompt: prompt.trim(),
      });

      return { roomId, mode };
    },
    onSuccess: async ({ roomId, mode: createdMode }) => {
      await queryClient.invalidateQueries({ queryKey: ["rooms"] });
      toast.success("Room created successfully.");
      navigate(`/room/${createdMode}/${roomId}`);
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : "Room creation failed.");
    },
  });

  if (!walletAddress) {
    return <Navigate to="/" replace />;
  }

  if (readyModes.length === 0) {
    return (
      <div className="min-h-screen bg-background text-foreground">
        <Header />
        <main className="mx-auto flex min-h-screen max-w-3xl items-center px-6 pt-24">
          <div className="w-full rounded-2xl border border-defeat/30 bg-card/80 p-8">
            <h1 className="font-heading text-3xl font-black">Game contracts not ready</h1>
            <p className="mt-3 text-muted-foreground">
              The lobby now depends on separate GenLayer contracts for debate, convince-me, and quiz. Finish deploying
              them and set the per-mode addresses first.
            </p>
          </div>
        </main>
      </div>
    );
  }

  if (!profileQuery.data && !profileQuery.isLoading) {
    return <Navigate to="/mint" replace />;
  }

  const modeMeta = GAME_MODE_META[mode];

  return (
    <div className="min-h-screen bg-background text-foreground">
      <Header />

      <main className="mx-auto max-w-6xl px-6 pb-12 pt-28">
        <div className="mb-10 flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className="text-xs uppercase tracking-[0.28em] text-primary">Multi-contract lobby</p>
            <h1 className="mt-2 font-heading text-4xl font-black">Create rooms, inspect contracts, and join live matches.</h1>
            {profileQuery.data && (
              <p className="mt-3 text-muted-foreground">
                Signed in as <span className="text-foreground">{profileQuery.data.name}</span> with {profileQuery.data.xp} XP
                at level {profileQuery.data.level}.
              </p>
            )}
          </div>
          <Button variant="secondary" onClick={() => roomsQuery.refetch()} disabled={roomsQuery.isFetching}>
            <RefreshCw className={`h-4 w-4 ${roomsQuery.isFetching ? "animate-spin" : ""}`} />
            Refresh Rooms
          </Button>
        </div>

        <div className="grid gap-8 lg:grid-cols-[0.95fr_1.05fr]">
          <section className="rounded-2xl border border-border/70 bg-card/80 p-6">
            <div className="mb-6 flex items-center gap-3">
              <Plus className="h-5 w-5 text-primary" />
              <h2 className="font-heading text-2xl font-bold">Open a new room</h2>
            </div>

            <div className="space-y-4">
              <div className="grid gap-3">
                {ARENA_MODES.map((entry) => {
                  const contract = gameContracts[entry];
                  const disabled = contract.status !== "ready";
                  const meta = GAME_MODE_META[entry];

                  return (
                    <button
                      key={entry}
                      type="button"
                      onClick={() => {
                        if (disabled) {
                          return;
                        }

                        setMode(entry);
                        setCategory(GAME_MODE_META[entry].defaultCategory);
                      }}
                      disabled={disabled}
                      className={`rounded-2xl border p-4 text-left transition ${
                        mode === entry && !disabled
                          ? "border-primary bg-primary/10 shadow-[0_0_24px_rgba(255,68,68,0.14)]"
                          : "border-border/70 bg-background/50"
                      } ${disabled ? "cursor-not-allowed opacity-50" : ""}`}
                    >
                      <p className="font-heading text-lg font-bold">{meta.title}</p>
                      <p className="mt-2 text-sm text-muted-foreground">{meta.summary}</p>
                      <p className={`mt-2 text-xs ${disabled ? "text-defeat" : "text-victory"}`}>
                        {disabled ? contract.error ?? "This contract is not live yet." : "Contract schema is loaded."}
                      </p>
                    </button>
                  );
                })}
              </div>

              <div className="grid gap-4">
                <div>
                  <label className="mb-2 block text-sm text-muted-foreground">Category</label>
                  <Input value={category} onChange={(event) => setCategory(event.target.value)} className="h-11" />
                </div>
                <div>
                  <label className="mb-2 block text-sm text-muted-foreground">{modeMeta.promptLabel}</label>
                  <textarea
                    value={prompt}
                    onChange={(event) => setPrompt(event.target.value)}
                    placeholder={modeMeta.promptPlaceholder}
                    className="min-h-32 w-full rounded-md border border-border bg-background/70 p-3 text-sm outline-none transition focus:border-primary/60"
                  />
                </div>
                {mode === "convince" && (
                  <div className="rounded-xl border border-border/60 bg-background/60 p-4 text-sm text-muted-foreground">
                    Convince Me uses the contract's built-in house stance. Players are trying to move it away from that
                    position, not establish neutral ground.
                  </div>
                )}
              </div>

              <Button
                variant="arena"
                className="w-full py-6 text-base"
                disabled={
                  createRoomMutation.isPending ||
                  gameContracts[mode].status !== "ready" ||
                  prompt.trim().length < 12
                }
                onClick={() => createRoomMutation.mutate()}
              >
                {createRoomMutation.isPending ? "Submitting Transaction..." : `Create ${modeMeta.title} Room`}
              </Button>
            </div>
          </section>

          <section className="rounded-2xl border border-border/70 bg-card/80 p-6">
            <div className="mb-6 flex items-center gap-3">
              <Swords className="h-5 w-5 text-primary" />
              <h2 className="font-heading text-2xl font-bold">Live rooms</h2>
            </div>

            <div className="space-y-4">
              {visibleRooms.length === 0 && (
                <div className="rounded-2xl border border-dashed border-border/70 bg-background/50 p-6 text-sm text-muted-foreground">
                  No rooms found yet. Create the first contract-backed match from the form on the left.
                </div>
              )}

              {visibleRooms.map((room, index) => {
                const meta = GAME_MODE_META[room.mode];
                const participantLabel =
                  room.owner.toLowerCase() === walletAddress.toLowerCase() || !isEmptyAddress(room.opponent)
                    ? "Open Room"
                    : "Join Room";

                return (
                  <motion.div
                    key={`${room.mode}:${room.id}`}
                    initial={{ opacity: 0, y: 12 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: index * 0.04 }}
                    className="rounded-2xl border border-border/70 bg-background/60 p-5"
                  >
                    <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
                      <div className="space-y-3">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="rounded-full border border-primary/30 bg-primary/10 px-3 py-1 text-xs uppercase tracking-[0.24em] text-primary">
                            {meta.title}
                          </span>
                          <span className="rounded-full border border-border px-3 py-1 text-xs text-muted-foreground">
                            {room.category}
                          </span>
                          <span className="rounded-full border border-border px-3 py-1 text-xs text-muted-foreground">
                            {room.id}
                          </span>
                        </div>
                        <p className="max-w-2xl text-sm text-foreground">{room.prompt}</p>
                        {room.houseStance && (
                          <p className="text-sm italic text-muted-foreground">House stance: "{room.houseStance}"</p>
                        )}
                        <p className="text-xs text-muted-foreground">
                          {room.ownerName || meta.ownerLabel} vs {room.opponentName || `Waiting for ${meta.opponentLabel.toLowerCase()}`}
                        </p>
                      </div>

                      <div className="flex min-w-44 flex-col gap-3">
                        <span
                          className={`rounded-full px-3 py-1 text-center text-xs uppercase tracking-[0.22em] ${
                            room.status === "resolved"
                              ? "bg-victory/15 text-victory"
                              : room.status === "active"
                                ? "bg-primary/15 text-primary"
                                : "bg-border/40 text-muted-foreground"
                          }`}
                        >
                          {room.status}
                        </span>
                        <Button asChild variant="secondary">
                          <Link to={`/room/${room.mode}/${room.id}`}>{participantLabel}</Link>
                        </Button>
                      </div>
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

export default Lobby;
