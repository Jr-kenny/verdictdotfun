import { Link } from "react-router-dom";
import Header from "@/components/Header";
import { Button } from "@/components/ui/button";

const NotFound = () => {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <Header />

      <main className="mx-auto flex min-h-screen max-w-3xl items-center px-6 pt-24">
        <div className="w-full rounded-2xl border border-border/70 bg-card/80 p-10 text-center">
          <p className="text-xs uppercase tracking-[0.28em] text-primary">404</p>
          <h1 className="mt-4 font-heading text-5xl font-black">Route not found</h1>
          <p className="mt-4 text-muted-foreground">
            The route you requested is not part of the current multi-contract Verdict Arena flow.
          </p>
          <div className="mt-8 flex justify-center gap-4">
            <Button asChild variant="arena">
              <Link to="/">Back Home</Link>
            </Button>
            <Button asChild variant="secondary">
              <Link to="/lobby">Open Lobby</Link>
            </Button>
          </div>
        </div>
      </main>
    </div>
  );
};

export default NotFound;
