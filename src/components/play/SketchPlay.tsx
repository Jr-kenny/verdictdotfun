import { useRef, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { pinImage, submitDrawing, submitGuess } from "@/lib/verdictArena";
import type { PlayProps } from "./types";

const GATEWAY = "https://ipfs.io/ipfs/";

function DrawingPad({ onExport, busy }: { onExport: (dataUrl: string) => void; busy: boolean }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const drawing = useRef(false);

  function pos(event: React.PointerEvent<HTMLCanvasElement>) {
    const canvas = canvasRef.current!;
    const rect = canvas.getBoundingClientRect();
    return {
      x: ((event.clientX - rect.left) / rect.width) * canvas.width,
      y: ((event.clientY - rect.top) / rect.height) * canvas.height,
    };
  }

  function start(event: React.PointerEvent<HTMLCanvasElement>) {
    const ctx = canvasRef.current!.getContext("2d")!;
    drawing.current = true;
    const { x, y } = pos(event);
    ctx.beginPath();
    ctx.moveTo(x, y);
  }

  function move(event: React.PointerEvent<HTMLCanvasElement>) {
    if (!drawing.current) return;
    const ctx = canvasRef.current!.getContext("2d")!;
    const { x, y } = pos(event);
    ctx.lineTo(x, y);
    ctx.lineWidth = 4;
    ctx.lineCap = "round";
    ctx.strokeStyle = "#111111";
    ctx.stroke();
  }

  function end() {
    drawing.current = false;
  }

  function clear() {
    const canvas = canvasRef.current!;
    const ctx = canvas.getContext("2d")!;
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }

  function ensureWhite() {
    const canvas = canvasRef.current!;
    const ctx = canvas.getContext("2d")!;
    // Paint a white background once (canvas starts transparent).
    if (!canvas.dataset.init) {
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      canvas.dataset.init = "1";
    }
  }

  return (
    <div className="space-y-3">
      <canvas
        ref={(node) => {
          canvasRef.current = node;
          if (node) ensureWhite();
        }}
        width={480}
        height={320}
        onPointerDown={start}
        onPointerMove={move}
        onPointerUp={end}
        onPointerLeave={end}
        className="w-full touch-none rounded-xl border border-border bg-white"
        style={{ aspectRatio: "3 / 2" }}
      />
      <div className="flex gap-2">
        <Button type="button" variant="secondary" onClick={clear} disabled={busy}>
          Clear
        </Button>
        <Button
          type="button"
          variant="arena"
          className="flex-1"
          disabled={busy}
          onClick={() => onExport(canvasRef.current!.toDataURL("image/png"))}
        >
          {busy ? "Pinning & submitting…" : "Submit drawing"}
        </Button>
      </div>
    </div>
  );
}

const SketchPlay = ({ room, mode, amOwner, amOpponent, prepare, refresh }: PlayProps) => {
  const isParticipant = amOwner || amOpponent;
  const [guess, setGuess] = useState("");
  const [manualCid, setManualCid] = useState("");
  const [showManual, setShowManual] = useState(false);

  const myDrawing = amOwner ? room.ownerDrawing ?? "" : room.opponentDrawing ?? "";
  const theirDrawing = amOwner ? room.opponentDrawing ?? "" : room.ownerDrawing ?? "";
  const myGuess = amOwner ? room.ownerSubmission : room.opponentSubmission;

  const drawingMutation = useMutation({
    mutationFn: async (cid: string) => {
      const { account, provider } = await prepare();
      return submitDrawing(mode, account, provider, room.id, cid);
    },
    onSuccess: async () => {
      setManualCid("");
      setShowManual(false);
      await refresh();
      toast.success("Drawing submitted.");
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : "Could not submit your drawing."),
  });

  const pinAndSubmit = useMutation({
    mutationFn: async (dataUrl: string) => {
      const cid = await pinImage(dataUrl);
      const { account, provider } = await prepare();
      return submitDrawing(mode, account, provider, room.id, cid);
    },
    onSuccess: async () => {
      await refresh();
      toast.success("Drawing pinned to IPFS and submitted.");
    },
    onError: (error) => {
      setShowManual(true);
      toast.error(error instanceof Error ? error.message : "Pinning failed — paste a CID manually.");
    },
  });

  const guessMutation = useMutation({
    mutationFn: async () => {
      const { account, provider } = await prepare();
      return submitGuess(mode, account, provider, room.id, guess.trim());
    },
    onSuccess: async () => {
      setGuess("");
      await refresh();
      toast.success("Guess submitted.");
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : "Could not submit your guess."),
  });

  const busy = pinAndSubmit.isPending || drawingMutation.isPending;

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-border/70 bg-background/50 p-5">
        <p className="text-xs uppercase tracking-[0.22em] text-muted-foreground">Drawing theme</p>
        <h3 className="mt-2 font-heading text-xl font-bold">{room.prompt || "Theme pending"}</h3>
      </div>

      {/* Drawing phase */}
      {room.status === "drawing" && isParticipant && !myDrawing && (
        <div className="space-y-3">
          <p className="text-sm text-muted-foreground">Draw something that fits the theme. Your opponent will try to guess it.</p>
          <DrawingPad onExport={(dataUrl) => pinAndSubmit.mutate(dataUrl)} busy={busy} />
          {showManual && (
            <div className="space-y-2 rounded-xl border border-border/70 bg-background/60 p-3">
              <p className="text-xs text-muted-foreground">Auto-pinning is unavailable. Pin your image to IPFS and paste the CID:</p>
              <input
                value={manualCid}
                onChange={(event) => setManualCid(event.target.value.trim())}
                placeholder="bare IPFS CID"
                className="w-full rounded-lg border border-border/70 bg-background/60 p-2 font-mono text-xs outline-none focus:border-primary/50"
              />
              <Button
                className="w-full"
                disabled={drawingMutation.isPending || manualCid.length < 16}
                onClick={() => drawingMutation.mutate(manualCid)}
              >
                {drawingMutation.isPending ? "Submitting…" : "Submit CID"}
              </Button>
            </div>
          )}
        </div>
      )}

      {room.status === "drawing" && isParticipant && myDrawing && (
        <p className="rounded-xl border border-border/60 bg-background/60 p-4 text-sm text-muted-foreground">
          Your drawing is in. Waiting for your opponent to draw…
        </p>
      )}

      {/* Guessing phase */}
      {room.status === "guessing" && isParticipant && (
        <div className="space-y-3">
          <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">Your opponent's drawing</p>
          {theirDrawing ? (
            <img
              src={GATEWAY + theirDrawing}
              alt="Opponent's drawing"
              className="w-full rounded-xl border border-border bg-white"
              style={{ aspectRatio: "3 / 2", objectFit: "contain" }}
            />
          ) : (
            <p className="text-sm text-muted-foreground">Loading drawing…</p>
          )}
          {myGuess ? (
            <p className="rounded-xl border border-border/60 bg-background/60 p-4 text-sm text-muted-foreground">
              Your guess is in. Waiting for the vision judge…
            </p>
          ) : (
            <>
              <input
                value={guess}
                onChange={(event) => setGuess(event.target.value.slice(0, 200))}
                placeholder="What did your opponent draw?"
                className="w-full rounded-xl border border-border bg-background/70 p-4 text-sm outline-none transition focus:border-primary/60"
              />
              <Button
                variant="arena"
                className="w-full py-6 text-base"
                disabled={guessMutation.isPending || guess.trim().length < 2}
                onClick={() => guessMutation.mutate()}
              >
                {guessMutation.isPending ? "Submitting…" : "Submit guess"}
              </Button>
            </>
          )}
        </div>
      )}

      {!isParticipant && (
        <p className="text-sm text-muted-foreground">Join the room to draw and guess.</p>
      )}
    </div>
  );
};

export default SketchPlay;
