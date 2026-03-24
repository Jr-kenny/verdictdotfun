import { Gavel } from "lucide-react";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { useArena } from "@/context/ArenaContext";

function shortenAddress(address: string | null) {
  if (!address) {
    return "Not connected";
  }

  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

const Header = ({ centered = false }: { centered?: boolean }) => {
  const { walletAddress, connectWallet, chain, walletArenaStatus, walletProfileStatus, readyModes } = useArena();

  return (
    <header className="fixed inset-x-0 top-0 z-50 border-b border-border/60 bg-background/85 backdrop-blur-md">
      <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
        <Link
          to="/"
          className={`flex items-center gap-3 ${centered ? "absolute left-1/2 -translate-x-1/2" : ""}`}
        >
          <span className="flex h-10 w-10 items-center justify-center rounded-full border border-primary/40 bg-primary/10">
            <Gavel className="h-5 w-5 text-primary" />
          </span>
          <span>
            <span className="block font-heading text-lg font-bold tracking-[0.24em]">VERDICT ARENA</span>
            <span className="block text-xs text-muted-foreground">
              {chain} / {walletArenaStatus === "ready" ? "bradbury ready" : "switch bradbury"} /{" "}
              {walletProfileStatus === "ready" ? "profile chain ready" : "switch profile chain"} / {readyModes.length}/3
              modes live
            </span>
          </span>
        </Link>

        <div className="ml-auto flex items-center gap-3">
          <span className="hidden rounded-full border border-border bg-card/80 px-3 py-1 text-xs text-muted-foreground md:inline-flex">
            {shortenAddress(walletAddress)}
          </span>
          <Button variant={walletAddress ? "secondary" : "wallet"} size="sm" onClick={() => void connectWallet()}>
            {walletAddress ? "Switch Wallet" : "Connect Wallet"}
          </Button>
        </div>
      </div>
    </header>
  );
};

export default Header;
