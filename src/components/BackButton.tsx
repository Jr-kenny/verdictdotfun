import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

interface BackButtonProps {
  isGame?: boolean;
  backTo?: string;
  confirmTitle?: string;
  confirmDescription?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  pendingLabel?: string;
  onConfirm?: () => Promise<void> | void;
  disabled?: boolean;
}

const BackButton = ({
  isGame = false,
  backTo = "/lobby",
  confirmTitle = "Quit Match?",
  confirmDescription = "Leaving now will resolve the other player as the winner.",
  confirmLabel = "Yes, Quit",
  cancelLabel = "No",
  pendingLabel = "Signing...",
  onConfirm,
  disabled = false,
}: BackButtonProps) => {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);

  const requiresConfirm = isGame && typeof onConfirm === "function";

  const handleBack = () => {
    if (disabled || pending) {
      return;
    }

    if (requiresConfirm) {
      setOpen(true);
      return;
    }

    navigate(backTo);
  };

  const handleConfirm = async () => {
    if (!onConfirm) {
      navigate(backTo);
      return;
    }

    try {
      setPending(true);
      await onConfirm();
      setOpen(false);
    } finally {
      setPending(false);
    }
  };

  return (
    <>
      <button
        onClick={handleBack}
        disabled={disabled || pending}
        className="flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground disabled:cursor-not-allowed disabled:opacity-60"
      >
        <ArrowLeft className="h-4 w-4" />
        {isGame ? "Exit Match" : "Back"}
      </button>

      <AlertDialog open={open} onOpenChange={setOpen}>
        <AlertDialogContent className="border-border/70 bg-card/95">
          <AlertDialogHeader>
            <AlertDialogTitle className="font-heading text-xl font-bold">{confirmTitle}</AlertDialogTitle>
            <AlertDialogDescription>{confirmDescription}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={pending}>{cancelLabel}</AlertDialogCancel>
            <Button variant="arena" onClick={() => void handleConfirm()} disabled={pending}>
              {pending ? pendingLabel : confirmLabel}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
};

export default BackButton;
