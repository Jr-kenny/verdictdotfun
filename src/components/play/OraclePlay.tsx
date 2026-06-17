import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { resolveRoom } from "@/lib/verdictArena";
import type { PlayProps } from "./types";

const OraclePlay = ({ room, mode, amOwner, amOpponent, prepare, refresh }: PlayProps) => {
  const isParticipant = amOwner || amOpponent;
  const mySide = amOwner ? "YES" : amOpponent ? "NO" : null;

  const resolveMutation = useMutation({
    mutationFn: async () => {
      const { account, provider } = await prepare();
      return resolveRoom(mode, account, provider, room.id);
    },
    onSuccess: async () => {
      await refresh();
      toast.success("Resolving from the source on-chain. The oracle is reading the outcome.");
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : "Could not resolve yet — the source may not settle it."),
  });

  const canResolve = room.status === "active";
  const outcome = (room.outcome || "").toLowerCase();

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-border/70 bg-background/50 p-5">
        <p className="text-xs uppercase tracking-[0.22em] text-muted-foreground">Forecast question</p>
        <h3 className="mt-2 font-heading text-xl font-bold">{room.prompt || "Question pending"}</h3>
        {room.source && (
          <a
            href={room.source}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-3 inline-block break-all text-sm text-primary underline underline-offset-4"
          >
            Resolution source ↗
          </a>
        )}
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        <div className={`rounded-2xl border p-4 ${mySide === "YES" ? "border-primary/40 bg-primary/5" : "border-border/70 bg-background/50"}`}>
          <p className="text-xs uppercase tracking-[0.22em] text-muted-foreground">{room.ownerName || "Owner"}</p>
          <p className="mt-2 font-heading text-2xl font-black text-victory">Backs YES</p>
        </div>
        <div className={`rounded-2xl border p-4 ${mySide === "NO" ? "border-primary/40 bg-primary/5" : "border-border/70 bg-background/50"}`}>
          <p className="text-xs uppercase tracking-[0.22em] text-muted-foreground">{room.opponentName || "Opponent"}</p>
          <p className="mt-2 font-heading text-2xl font-black text-primary">Backs NO</p>
        </div>
      </div>

      {mySide && (
        <p className="text-sm text-muted-foreground">
          You are backing <span className="font-semibold text-foreground">{mySide}</span>. After the event, anyone can
          resolve the room: the contract fetches the source and an LLM reads the outcome. The matching side wins.
        </p>
      )}

      {outcome && (
        <div className="rounded-xl border border-victory/30 bg-victory/10 p-4 text-sm">
          <span className="text-muted-foreground">Resolved outcome: </span>
          <span className="font-heading text-lg font-bold uppercase text-victory">{outcome}</span>
        </div>
      )}

      {canResolve && (
        <Button
          variant="arena"
          className="w-full py-6 text-base"
          disabled={resolveMutation.isPending || !isParticipant}
          onClick={() => resolveMutation.mutate()}
        >
          {resolveMutation.isPending ? "Reading the source…" : "Resolve from source"}
        </Button>
      )}
      {canResolve && !isParticipant && (
        <p className="text-center text-xs text-muted-foreground">Join the room to resolve it.</p>
      )}
    </div>
  );
};

export default OraclePlay;
