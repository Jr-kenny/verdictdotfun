import { useEffect, useMemo, useState } from "react";
import { Link, Navigate, useNavigate } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { motion, AnimatePresence } from "framer-motion";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useArena } from "@/context/ArenaContext";
import Header from "@/components/Header";
import { ARGUE_STYLES } from "@/lib/gameModes";
import { fetchStoredLocalProfileName, getLocalProfileQueryKey } from "@/lib/localProfile";
import { fetchArenaProfile } from "@/lib/profileFactory";
import { createRoom, fetchAllRooms, fetchRoom, isEmptyAddress, registerLocalProfile, shouldUseLocalProfileAlias, waitForRoom } from "@/lib/verdictArena";
import type { ArenaMode, ArgueStyle } from "@/types/arena";
import { Puzzle, Radio, Swords } from "lucide-react";
import { toast } from "sonner";

const MODES: { id: ArenaMode; title: string; icon: typeof Swords; desc: string }[] = [
  { id: "argue", title: "Argue", icon: Swords, desc: "Choose debate or convince when you open the room." },
  { id: "riddle", title: "Riddle", icon: Puzzle as typeof Swords, desc: "Three riddles per room. Each guess resolves immediately, with three tries per player per riddle." },
];
const CATEGORY_OPTIONS = ["Tech", "Web3", "Nature", "Culture", "Sports", "History"];

function makeRoomId() {
  return Math.random().toString(36).slice(2, 8).toUpperCase();
}

const Lobby = () => {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { walletAddress, walletReady, provider, ensureArenaNetwork, readyModes, gameContracts } = useArena();
  const [selectedMode, setSelectedMode] = useState<ArenaMode>("argue");
  const [argueStyle, setArgueStyle] = useState<ArgueStyle>("debate");
  const [joinCode, setJoinCode] = useState("");
  const [showJoinInput, setShowJoinInput] = useState(false);
  const [category, setCategory] = useState("Tech");

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

  const roomsQuery = useQuery({
    queryKey: ["rooms", readyModes.join(",")],
    queryFn: () => fetchAllRooms(readyModes),
    enabled: readyModes.length > 0,
    refetchInterval: 3_000,
  });

  useEffect(() => {
    if (readyModes.length === 0) {
      return;
    }
    if (!readyModes.includes(selectedMode)) {
      setSelectedMode(readyModes[0]);
    }
  }, [readyModes, selectedMode]);

  const visibleRooms = useMemo(() => {
    return [...(roomsQuery.data ?? [])]
      .filter((room) => room.mode === selectedMode)
      .filter((room) => room.status !== "resolved")
      .sort((left, right) => right.id.localeCompare(left.id))
      .slice(0, 8);
  }, [roomsQuery.data, selectedMode]);

  const activeIdentity = profileQuery.data?.profileAddress ?? walletAddress ?? null;

  const battleHistory = useMemo(() => {
    if (!activeIdentity) {
      return [];
    }

    const normalizedIdentity = activeIdentity.toLowerCase();

    return [...(roomsQuery.data ?? [])]
      .filter((room) => room.status === "resolved")
      .filter((room) => room.owner.toLowerCase() === normalizedIdentity || room.opponent.toLowerCase() === normalizedIdentity)
      .sort((left, right) => right.id.localeCompare(left.id))
      .slice(0, 7);
  }, [activeIdentity, roomsQuery.data]);

  const currentMode = MODES.find((m) => m.id === selectedMode);
  const activeProfileName = profileQuery.data?.name ?? (shouldUseLocalProfileAlias() ? localProfileQuery.data ?? null : null);

  const createRoomMutation = useMutation({
    mutationFn: async () => {
      if (!walletAddress || !provider) {
        throw new Error("Connect a wallet before creating rooms.");
      }
      if (!activeProfileName) {
        throw new Error("Create your player profile before opening a room.");
      }

      const roomId = makeRoomId();
      await ensureArenaNetwork();

      if (shouldUseLocalProfileAlias()) {
        await registerLocalProfile(selectedMode, walletAddress, provider, activeProfileName);
      }

      await createRoom(selectedMode, walletAddress, provider, {
        roomId,
        category: category.trim(),
        argueStyle,
        profileAddress: profileQuery.data?.profileAddress ?? null,
      });
      await waitForRoom(selectedMode, roomId, 60, 2_500);
      return { roomId, mode: selectedMode };
    },
    onSuccess: async ({ roomId, mode }) => {
      await queryClient.invalidateQueries({ queryKey: ["rooms"] });
      navigate(`/room/${mode}/${roomId}`);
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : "Room creation failed.");
    },
  });

  if (!walletReady) {
    return (
      <div className="min-h-screen grid-bg">
        <Header centered />
        <main className="mx-auto flex min-h-screen max-w-4xl items-center justify-center px-4 pt-24">
          <div className="rounded-xl border border-border bg-card/70 px-6 py-5 text-sm text-muted-foreground">
            Restoring wallet session...
          </div>
        </main>
      </div>
    );
  }

  if (!walletAddress) {
    return <Navigate to="/" replace />;
  }

  if (!activeProfileName && !profileQuery.isLoading && !localProfileQuery.isLoading) {
    return <Navigate to="/mint" replace />;
  }

  if (readyModes.length === 0) {
    return <Navigate to="/" replace />;
  }

  const handleCreateRoom = () => {
    if (!selectedMode || !category.trim()) {
      return;
    }
    createRoomMutation.mutate();
  };

  const handleJoinRoom = async () => {
    const normalizedRoomId = joinCode.trim().toUpperCase();

    if (!normalizedRoomId) {
      return;
    }

    const modeOrder = [selectedMode, ...readyModes.filter((mode) => mode !== selectedMode)];
    let hadLookupError = false;

    for (const mode of modeOrder) {
      try {
        const room = await fetchRoom(mode, normalizedRoomId);
        if (room) {
          navigate(`/room/${room.mode}/${normalizedRoomId}`);
          return;
        }
      } catch {
        hadLookupError = true;
      }
    }

    toast.error(
      hadLookupError
        ? "The room lookup hit a temporary network error. Try the code again."
        : "No live room was found for that code on the connected contracts.",
    );
  };

  return (
    <div className="min-h-screen grid-bg">
      <Header centered />
      <main className="pt-24 pb-12 px-4 max-w-6xl mx-auto grid md:grid-cols-5 gap-8">
        <motion.div
          initial={{ opacity: 0, x: -30 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
          className="md:col-span-3 space-y-8"
        >
          <div>
            <motion.span
              initial={{ opacity: 0, x: -10 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: 0.2 }}
              className="text-xs font-heading tracking-[0.3em] text-primary font-bold uppercase"
            >
              Game Select
            </motion.span>
            <motion.h1
              initial={{ opacity: 0, y: 15 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.3, duration: 0.6 }}
              className="font-heading text-3xl md:text-4xl font-bold mt-2 leading-tight"
            >
              Pick the game,
              <br />
              <span className="text-primary">then open the room.</span>
            </motion.h1>
          </div>

          <div className="space-y-3">
            {MODES.map((mode, i) => {
              const live = gameContracts[mode.id].status === "ready";
              return (
                <motion.button
                  key={mode.id}
                  initial={{ opacity: 0, x: -20 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: 0.4 + i * 0.1, duration: 0.5 }}
                  whileHover={live ? { scale: 1.01, x: 4 } : {}}
                  whileTap={live ? { scale: 0.99 } : {}}
                  onClick={() => live && setSelectedMode(mode.id)}
                  className={`w-full text-left p-4 rounded-lg border transition-all ${
                    selectedMode === mode.id && live
                      ? "border-primary glow-red-subtle bg-card"
                      : "border-border bg-card/50 hover:border-border hover:bg-card"
                  } ${live ? "" : "opacity-50 cursor-not-allowed"}`}
                >
                  <div className="flex items-center gap-3 mb-1">
                    <mode.icon className={`w-5 h-5 ${selectedMode === mode.id ? "text-primary" : "text-muted-foreground"}`} />
                    <span className="font-heading font-bold text-lg">{mode.title}</span>
                    <span className={`ml-auto flex items-center gap-1 text-xs ${live ? "text-victory" : "text-defeat"}`}>
                      <Radio className="w-3 h-3" /> {live ? "LIVE" : "OFFLINE"}
                    </span>
                  </div>
                  <p className="text-sm text-muted-foreground ml-8">{mode.desc}</p>
                </motion.button>
              );
            })}
          </div>

          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.8 }}>
            <h3 className="text-sm text-muted-foreground font-heading tracking-wider uppercase mb-3">Battle History</h3>
            <div className="space-y-2 max-h-72 overflow-y-auto pr-2">
              {battleHistory.length === 0 && (
                <div className="text-sm py-3 px-3 rounded bg-card/50 border border-border/50 text-muted-foreground">
                  No completed matches yet.
                </div>
              )}
              {battleHistory.map((room, i) => {
                const label = MODES.find((mode) => mode.id === room.mode)?.title ?? room.mode;
                const isOwner = activeIdentity ? room.owner.toLowerCase() === activeIdentity.toLowerCase() : false;
                const opponentName = isOwner ? room.opponentName : room.ownerName;
                const isTie = isEmptyAddress(room.winner);
                const didWin = !isTie && activeIdentity ? room.winner.toLowerCase() === activeIdentity.toLowerCase() : false;
                const resultLabel = isTie ? "Tie" : didWin ? "Victory" : "Defeat";
                const resultClass = isTie ? "text-muted-foreground font-semibold" : didWin ? "text-victory font-semibold" : "text-defeat font-semibold";

                return (
                  <motion.div
                    key={`${room.mode}:${room.id}`}
                    initial={{ opacity: 0, x: -10 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: 0.9 + i * 0.05 }}
                    className="text-sm py-3 px-3 rounded bg-card/50 border border-border/50"
                  >
                    You took a{" "}
                    <span className={resultClass}>
                      [{resultLabel}]
                    </span>{" "}
                    against {opponentName || "Unknown"} in{" "}
                    <span className="text-label-blue font-semibold">[{label}]</span>.
                    <div className="text-xs text-muted-foreground mt-1">
                      {room.prompt} <span className="ml-2 uppercase">{room.id}</span>
                    </div>
                  </motion.div>
                );
              })}
            </div>
            <p className="text-xs text-muted-foreground mt-2">Showing your last 7 completed matches.</p>
          </motion.div>

        </motion.div>

        <motion.div
          initial={{ opacity: 0, x: 30 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ delay: 0.3, duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
          className="md:col-span-2"
        >
          <div className="sticky top-24 rounded-xl border border-border bg-card p-6 space-y-6">
            <AnimatePresence mode="wait">
              {currentMode ? (
                <motion.div
                  key={currentMode.id}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -10 }}
                  transition={{ duration: 0.3 }}
                  className="space-y-6"
                >
                  <div>
                    <div className="flex items-center gap-2 mb-2">
                      <currentMode.icon className="w-5 h-5 text-primary" />
                      <h2 className="font-heading text-2xl font-bold">{currentMode.title}</h2>
                    </div>
                    <p className="text-sm text-muted-foreground">{currentMode.desc}</p>
                  </div>

                  <div className="space-y-3">
                    <p className="text-sm text-muted-foreground">
                      Choose a category.
                    </p>
                    {selectedMode === "argue" && (
                      <div className="space-y-2">
                        <p className="text-sm text-muted-foreground">Create room</p>
                        <div className="relative grid grid-cols-2 rounded-full border border-amber-400/25 bg-card/70 p-1">
                          <div
                            aria-hidden="true"
                            className={`absolute bottom-1 top-1 w-[calc(50%-0.25rem)] rounded-full bg-gradient-to-r from-amber-400 to-orange-500 shadow-[0_0_18px_rgba(249,115,22,0.28)] transition-transform duration-300 ease-out ${
                              argueStyle === "convince" ? "translate-x-full" : "translate-x-0"
                            } left-1`}
                          />
                          {ARGUE_STYLES.map((style) => (
                            <button
                              key={style}
                              type="button"
                              onClick={() => setArgueStyle(style)}
                              className={`relative z-10 rounded-full px-4 py-2.5 text-sm font-heading tracking-wide transition-colors ${
                                argueStyle === style ? "text-black" : "text-amber-100/80 hover:text-amber-50"
                              }`}
                            >
                              {style === "debate" ? "Debate" : "Convince Me"}
                            </button>
                          ))}
                        </div>
                      </div>
                    )}
                    <div className="flex flex-wrap gap-2">
                      {CATEGORY_OPTIONS.map((option) => (
                        <button
                          key={option}
                          type="button"
                          onClick={() => setCategory(option)}
                          className={`px-4 py-2 rounded-full text-sm font-medium transition-all ${
                            category === option
                              ? "bg-primary text-primary-foreground glow-red-subtle"
                              : "bg-card border border-border text-muted-foreground hover:border-primary/50"
                          }`}
                        >
                          {option}
                        </button>
                      ))}
                    </div>
                  </div>

                  <motion.div whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.98 }}>
                    <Button
                      variant="arena"
                      className="w-full py-5"
                      onClick={handleCreateRoom}
                      disabled={createRoomMutation.isPending || !category.trim()}
                    >
                      {createRoomMutation.isPending ? "Creating..." : "Create Room"}
                    </Button>
                  </motion.div>

                  <AnimatePresence mode="wait">
                    {showJoinInput ? (
                      <motion.div
                        key="input"
                        initial={{ opacity: 0, height: 0 }}
                        animate={{ opacity: 1, height: "auto" }}
                        exit={{ opacity: 0, height: 0 }}
                        className="flex gap-2 overflow-hidden"
                      >
                        <Input
                          value={joinCode}
                          onChange={(e) => setJoinCode(e.target.value.toUpperCase())}
                          placeholder="ROOM CODE"
                          className="bg-secondary border-border font-mono tracking-widest uppercase"
                          maxLength={6}
                        />
                        <Button variant="secondary" onClick={() => void handleJoinRoom()} disabled={!joinCode.trim()}>
                          Join
                        </Button>
                      </motion.div>
                    ) : (
                      <motion.div key="button" whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.98 }}>
                        <Button variant="secondary" className="w-full py-5" onClick={() => setShowJoinInput(true)}>
                          Join Room
                        </Button>
                      </motion.div>
                    )}
                  </AnimatePresence>
                  <p className="text-xs text-muted-foreground text-center">Create or join from this game.</p>

                  <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.45 }}>
                    <h3 className="text-sm text-muted-foreground font-heading tracking-wider uppercase mb-3">Live Rooms</h3>
                    <div className="space-y-2 max-h-72 overflow-y-auto pr-2">
                      {visibleRooms.length === 0 && (
                        <div className="text-sm py-3 px-3 rounded bg-card/50 border border-border/50 text-muted-foreground">
                          No live rooms yet.
                        </div>
                      )}
                      {visibleRooms.map((room, i) => {
                        const label = MODES.find((mode) => mode.id === room.mode)?.title ?? room.mode;
                        return (
                          <motion.div
                            key={`${room.mode}:${room.id}`}
                            initial={{ opacity: 0, x: -10 }}
                            animate={{ opacity: 1, x: 0 }}
                            transition={{ delay: 0.5 + i * 0.05 }}
                            className="text-sm py-2 px-3 rounded bg-card/50 border border-border/50"
                          >
                            <Link to={`/room/${room.mode}/${room.id}`} className="block">
                              <span className="text-label-blue font-semibold">[{label}]</span>{" "}
                              {room.mode === "argue" ? (
                                <span className="text-xs uppercase tracking-wide text-primary/80">[{room.argueStyle === "convince" ? "Convince" : "Debate"}]</span>
                              ) : null}{" "}
                              {room.prompt || (room.mode === "argue" ? "Prompt pending until the room starts." : "Riddle loading...")}
                              <span className="text-muted-foreground ml-2 text-xs">{room.id}</span>
                            </Link>
                          </motion.div>
                        );
                      })}
                    </div>
                    <p className="text-xs text-muted-foreground mt-2">Showing the latest contract-backed rooms.</p>
                  </motion.div>
                </motion.div>
              ) : (
                <motion.div key="empty" initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="text-center py-12">
                  <p className="text-muted-foreground">Select a game mode to continue</p>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </motion.div>
      </main>
    </div>
  );
};

export default Lobby;
