import { useNavigate } from "react-router-dom";
import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useState } from "react";

interface BackButtonProps {
  isGame?: boolean;
  backTo?: string;
}

const BackButton = ({ isGame = false, backTo = "/lobby" }: BackButtonProps) => {
  const navigate = useNavigate();
  const [showConfirm, setShowConfirm] = useState(false);

  const handleBack = () => {
    if (isGame) {
      setShowConfirm(true);
    } else {
      navigate(backTo);
    }
  };

  const handleForfeit = () => {
    console.log("[Mock] Player forfeited the game");
    navigate("/lobby");
  };

  return (
    <>
      <button
        onClick={handleBack}
        className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
      >
        <ArrowLeft className="w-4 h-4" />
        {isGame ? "Exit Game" : "Back"}
      </button>

      {showConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-sm">
          <div className="rounded-xl border border-border bg-card p-6 max-w-sm w-full mx-4 space-y-4 text-center">
            <h2 className="font-heading text-xl font-bold">Forfeit Game?</h2>
            <p className="text-sm text-muted-foreground">
              Leaving now counts as a loss. You'll lose XP and the match will be recorded as a defeat.
            </p>
            <div className="flex gap-3 justify-center">
              <Button variant="arena" size="sm" onClick={handleForfeit}>
                Forfeit &amp; Leave
              </Button>
              <Button variant="secondary" size="sm" onClick={() => setShowConfirm(false)}>
                Stay
              </Button>
            </div>
          </div>
        </div>
      )}
    </>
  );
};

export default BackButton;
