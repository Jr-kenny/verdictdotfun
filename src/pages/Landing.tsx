import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import { Gavel, Gem, Scale, Swords, Zap } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useArena } from "@/context/ArenaContext";
import Header from "@/components/Header";

const FEATURES = [
  { icon: Scale, title: "On-chain judge", body: "A GenLayer contract is the referee. Every verdict is reached and recorded on-chain, with no off-chain trust." },
  { icon: Swords, title: "Real-stakes duels", body: "Debate and riddle rooms with credits on the line. Winner takes the pot, settled by the verdict." },
  { icon: Gem, title: "The Verdict Stone", body: "A living reputation relic that levels up with your deeds, never falls, and trades with its rank intact." },
];

const Landing = () => {
  const { walletAddress, openWalletModal } = useArena();
  const navigate = useNavigate();
  const [pendingEnter, setPendingEnter] = useState(false);

  useEffect(() => {
    if (!pendingEnter || !walletAddress) {
      return;
    }
    setPendingEnter(false);
    navigate("/lobby");
  }, [navigate, pendingEnter, walletAddress]);

  const handleEnter = async () => {
    if (!walletAddress) {
      setPendingEnter(true);
      openWalletModal();
      return;
    }
    navigate("/lobby");
  };

  return (
    <div className="min-h-screen grid-bg noise-bg relative overflow-hidden">
      <Header />

      <motion.div
        className="absolute top-1/2 left-1/2 w-[640px] h-[640px] rounded-full bg-primary/10 blur-[140px]"
        animate={{ scale: [1, 1.2, 1], opacity: [0.3, 0.55, 0.3] }}
        transition={{ duration: 7, repeat: Infinity, ease: "easeInOut" }}
        style={{ x: "-50%", y: "-50%" }}
      />
      <motion.div
        className="absolute top-1/3 right-1/4 w-[300px] h-[300px] rounded-full bg-primary/5 blur-[100px]"
        animate={{ x: [0, 30, 0], y: [0, -20, 0], opacity: [0.2, 0.4, 0.2] }}
        transition={{ duration: 9, repeat: Infinity, ease: "easeInOut" }}
      />

      <main className="relative z-10 flex flex-col items-center justify-center min-h-screen px-4 text-center pt-20 pb-16">
        <motion.p
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6 }}
          className="mb-5 flex items-center gap-2 font-heading text-xs font-semibold uppercase tracking-[0.4em] text-primary"
        >
          <Gavel className="h-4 w-4" /> Verdict // On-Chain Arena
        </motion.p>

        <motion.h1
          initial={{ opacity: 0, y: 30 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1] }}
          className="font-heading text-5xl md:text-7xl font-black tracking-tight leading-[1.05] mb-5"
        >
          Play On-Chain Games.
          <br />
          <motion.span
            className="text-gradient-red inline-block"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.8, delay: 0.3, ease: [0.16, 1, 0.3, 1] }}
          >
            Get Judged On-Chain.
          </motion.span>
        </motion.h1>

        <motion.p
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.6, duration: 0.6 }}
          className="text-muted-foreground text-lg md:text-xl max-w-xl mb-10 leading-relaxed"
        >
          Argue and solve riddles head-to-head. A GenLayer contract delivers the verdict, the pot goes to
          the winner, and your wins forge a living <span className="text-foreground">Verdict Stone</span>.
        </motion.p>

        <motion.div
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ delay: 0.8, duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
          className="flex flex-wrap items-center justify-center gap-3"
        >
          <Button variant="arena" size="lg" className="px-10 py-6 text-lg" onClick={() => void handleEnter()}>
            <Zap className="mr-2 h-5 w-5" /> Enter the Arena
          </Button>
          <Link to="/market">
            <Button
              variant="outline"
              size="lg"
              className="border-border/70 bg-card/50 px-8 py-6 text-base font-heading uppercase tracking-[0.16em] hover:border-primary/50"
            >
              <Gem className="mr-2 h-4 w-4 text-primary" /> Stone Market
            </Button>
          </Link>
        </motion.div>

        <div className="mt-20 grid w-full max-w-4xl grid-cols-1 gap-4 md:grid-cols-3">
          {FEATURES.map(({ icon: Icon, title, body }, i) => (
            <motion.div
              key={title}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 1 + i * 0.12, duration: 0.45 }}
              whileHover={{ y: -4 }}
              className="group relative overflow-hidden rounded-2xl border border-border/70 bg-card/50 p-6 text-left backdrop-blur-sm transition hover:border-primary/40"
            >
              <div className="pointer-events-none absolute -right-8 -top-8 h-24 w-24 rounded-full bg-primary/20 opacity-40 blur-2xl transition group-hover:opacity-70" />
              <Icon className="relative h-6 w-6 text-primary" />
              <h3 className="relative mt-4 font-heading text-lg font-bold">{title}</h3>
              <p className="relative mt-2 text-sm leading-relaxed text-muted-foreground">{body}</p>
            </motion.div>
          ))}
        </div>
      </main>
    </div>
  );
};

export default Landing;
