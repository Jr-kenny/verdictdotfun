import { useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import { toast } from "sonner";
import { Award, Radio, Zap } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useArena } from "@/context/ArenaContext";
import Header from "@/components/Header";

const Landing = () => {
  const { walletAddress, connectWallet } = useArena();
  const navigate = useNavigate();

  const handleEnter = async () => {
    try {
      if (!walletAddress) {
        await connectWallet();
      }
      navigate("/lobby");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Wallet connection failed.");
    }
  };

  return (
    <div className="min-h-screen grid-bg noise-bg relative overflow-hidden">
      <Header />

      <motion.div
        className="absolute top-1/2 left-1/2 w-[600px] h-[600px] rounded-full bg-primary/5 blur-[120px]"
        animate={{ scale: [1, 1.2, 1], opacity: [0.3, 0.5, 0.3] }}
        transition={{ duration: 6, repeat: Infinity, ease: "easeInOut" }}
        style={{ x: "-50%", y: "-50%" }}
      />
      <motion.div
        className="absolute top-1/3 right-1/4 w-[300px] h-[300px] rounded-full bg-primary/3 blur-[100px]"
        animate={{ x: [0, 30, 0], y: [0, -20, 0], opacity: [0.2, 0.4, 0.2] }}
        transition={{ duration: 8, repeat: Infinity, ease: "easeInOut" }}
      />

      <main className="relative z-10 flex flex-col items-center justify-center min-h-screen px-4 text-center pt-16">
        <motion.h1
          initial={{ opacity: 0, y: 30 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1] }}
          className="font-heading text-5xl md:text-7xl font-black tracking-tight leading-tight mb-4"
        >
          Where Arguments
          <br />
          <motion.span
            className="text-primary inline-block"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.8, delay: 0.3, ease: [0.16, 1, 0.3, 1] }}
          >
            Get Judged On-Chain
          </motion.span>
        </motion.h1>

        <motion.p
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.6, duration: 0.6 }}
          className="text-muted-foreground text-lg md:text-xl max-w-md mb-10"
        >
          Two players. One contract. No mercy.
        </motion.p>

        <motion.div
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ delay: 0.8, duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
          whileHover={{ scale: 1.05 }}
          whileTap={{ scale: 0.97 }}
        >
          <Button variant="arena" size="lg" className="px-10 py-6 text-lg" onClick={() => void handleEnter()}>
            Enter the Arena
          </Button>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 1.1, duration: 0.6 }}
          className="flex flex-wrap items-center justify-center gap-4 mt-16"
        >
          {[
            { icon: Zap, label: "AI Judge" },
            { icon: Award, label: "NFT Rank" },
            { icon: Radio, label: "Live Rooms" },
          ].map(({ icon: Icon, label }, i) => (
            <motion.div
              key={label}
              initial={{ opacity: 0, y: 15 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 1.2 + i * 0.15, duration: 0.4 }}
              whileHover={{ y: -3, borderColor: "hsl(1 77% 55% / 0.5)" }}
              className="flex items-center gap-2 px-4 py-2 rounded-full border border-border bg-card/50 text-sm text-muted-foreground transition-colors"
            >
              <Icon className="w-4 h-4 text-primary" />
              {label}
            </motion.div>
          ))}
        </motion.div>
      </main>
    </div>
  );
};

export default Landing;
