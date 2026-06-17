import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { finishPersuading, submitTurn } from "@/lib/verdictArena";
import type { PlayProps } from "./types";

const MAX_TURNS = 5;

function Meter({ label, value, turns, done }: { label: string; value: number; turns: number; done: boolean }) {
  const pct = Math.max(0, Math.min(100, value));
  return (
    <div className="rounded-2xl border border-border/70 bg-background/50 p-4">
      <div className="flex items-center justify-between text-xs uppercase tracking-[0.18em] text-muted-foreground">
        <span>{label}</span>
        <span>{turns}/{MAX_TURNS} turns{done ? " · done" : ""}</span>
      </div>
      <div className="mt-3 h-3 w-full overflow-hidden rounded-full bg-border/50">
        <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${pct}%` }} />
      </div>
      <p className="mt-2 font-heading text-2xl font-black">{pct}/100</p>
    </div>
  );
}

function Transcript({ text }: { text: string }) {
  if (!text) {
    return <p className="text-sm text-muted-foreground">No messages yet. Make your opening case.</p>;
  }
  const lines = text.split("\n").filter(Boolean);
  return (
    <div className="space-y-2">
      {lines.map((line, index) => {
        const isPlayer = line.startsWith("PLAYER:");
        const body = line.replace(/^(PLAYER:|CHARACTER:)\s*/, "");
        return (
          <div
            key={index}
            className={`max-w-[85%] rounded-2xl px-4 py-2 text-sm ${
              isPlayer ? "ml-auto bg-primary/15 text-foreground" : "mr-auto border border-border/60 bg-background/60 text-foreground/90"
            }`}
          >
            <span className="mr-2 text-[10px] uppercase tracking-[0.2em] text-muted-foreground">{isPlayer ? "You" : "Character"}</span>
            {body}
          </div>
        );
      })}
    </div>
  );
}

const PersuadePlay = ({ room, mode, amOwner, amOpponent, prepare, refresh }: PlayProps) => {
  const [message, setMessage] = useState("");
  const isParticipant = amOwner || amOpponent;

  const myTranscript = amOwner ? room.ownerTranscript ?? "" : room.opponentTranscript ?? "";
  const myMeter = amOwner ? room.ownerMeter ?? 0 : room.opponentMeter ?? 0;
  const myTurns = amOwner ? room.ownerTurns ?? 0 : room.opponentTurns ?? 0;
  const myDone = amOwner ? Boolean(room.ownerDone) : Boolean(room.opponentDone);

  const turnMutation = useMutation({
    mutationFn: async () => {
      const { account, provider } = await prepare();
      return submitTurn(mode, account, provider, room.id, message.trim());
    },
    onSuccess: async () => {
      setMessage("");
      await refresh();
      toast.success("Message sent. The character is responding on-chain.");
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : "Could not send your message."),
  });

  const finishMutation = useMutation({
    mutationFn: async () => {
      const { account, provider } = await prepare();
      return finishPersuading(mode, account, provider, room.id);
    },
    onSuccess: async () => {
      await refresh();
      toast.success("You finished your attempt. The match resolves once both players are done.");
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : "Could not finish your attempt."),
  });

  const canPlay = room.status === "active" && isParticipant && !myDone && myTurns < MAX_TURNS;

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-border/70 bg-background/50 p-5">
        <p className="text-xs uppercase tracking-[0.22em] text-muted-foreground">The character</p>
        <p className="mt-2 text-sm text-foreground/90">{room.prompt || "Character pending"}</p>
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        <Meter label={room.ownerName || "Owner"} value={room.ownerMeter ?? 0} turns={room.ownerTurns ?? 0} done={Boolean(room.ownerDone)} />
        <Meter label={room.opponentName || "Opponent"} value={room.opponentMeter ?? 0} turns={room.opponentTurns ?? 0} done={Boolean(room.opponentDone)} />
      </div>

      {isParticipant && (
        <div className="rounded-2xl border border-border/70 bg-background/40 p-4">
          <p className="mb-3 text-xs uppercase tracking-[0.2em] text-muted-foreground">Your conversation</p>
          <Transcript text={myTranscript} />
        </div>
      )}

      {canPlay && (
        <div className="space-y-3">
          <textarea
            value={message}
            onChange={(event) => setMessage(event.target.value.slice(0, 600))}
            placeholder="Make your case to the character…"
            rows={3}
            className="w-full rounded-xl border border-border bg-background/70 p-4 text-sm outline-none transition focus:border-primary/60"
          />
          <div className="flex flex-col gap-2 sm:flex-row">
            <Button
              variant="arena"
              className="flex-1 py-6 text-base"
              disabled={turnMutation.isPending || message.trim().length < 4}
              onClick={() => turnMutation.mutate()}
            >
              {turnMutation.isPending ? "Sending…" : `Send (turn ${myTurns + 1}/${MAX_TURNS})`}
            </Button>
            <Button
              variant="secondary"
              className="py-6 text-base"
              disabled={finishMutation.isPending || myTurns === 0}
              onClick={() => finishMutation.mutate()}
            >
              {finishMutation.isPending ? "Finishing…" : "Finish attempt"}
            </Button>
          </div>
        </div>
      )}

      {isParticipant && myDone && room.status === "active" && (
        <p className="rounded-xl border border-border/60 bg-background/60 p-4 text-sm text-muted-foreground">
          You finished your attempt. Waiting for your opponent — the match resolves when both are done.
        </p>
      )}
      {isParticipant && !myDone && myTurns >= MAX_TURNS && room.status === "active" && (
        <p className="rounded-xl border border-border/60 bg-background/60 p-4 text-sm text-muted-foreground">
          You have used all {MAX_TURNS} turns. The match resolves once both players are done.
        </p>
      )}
    </div>
  );
};

export default PersuadePlay;
