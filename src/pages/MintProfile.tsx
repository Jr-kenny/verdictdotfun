import { useState } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { motion, AnimatePresence } from "framer-motion";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useArena } from "@/context/ArenaContext";
import { fetchStoredLocalProfileName, getLocalProfileQueryKey, storeLocalProfileName } from "@/lib/localProfile";
import { createArenaProfile, fetchArenaProfile } from "@/lib/profileFactory";
import BackButton from "@/components/BackButton";
import Header from "@/components/Header";

const container = {
  hidden: { opacity: 0 },
  show: { opacity: 1, transition: { staggerChildren: 0.1, delayChildren: 0.2 } },
};

const item = {
  hidden: { opacity: 0, y: 20 },
  show: { opacity: 1, y: 0, transition: { duration: 0.5, ease: [0.16, 1, 0.3, 1] } },
};

const MintProfile = () => {
  const [name, setName] = useState("");
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { walletAddress, walletReady, provider, ensureArenaNetwork, coreContractConfigured } = useArena();

  const profileQuery = useQuery({
    queryKey: ["profile", walletAddress],
    queryFn: () => fetchArenaProfile(walletAddress!),
    enabled: Boolean(walletAddress) && coreContractConfigured,
  });
  const localProfileQuery = useQuery({
    queryKey: getLocalProfileQueryKey(walletAddress),
    queryFn: () => fetchStoredLocalProfileName(walletAddress),
    enabled: Boolean(walletAddress) && !coreContractConfigured,
  });

  const createProfileMutation = useMutation({
    mutationFn: async () => {
      if (!walletAddress || !provider) {
        throw new Error("Connect a wallet before creating a profile.");
      }
      await ensureArenaNetwork();
      return createArenaProfile(walletAddress, provider, name.trim());
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["profile", walletAddress] });
      toast.success("Profile created on VerdictDotFun.");
      navigate("/lobby");
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : "Profile creation failed.");
    },
  });

  const createLocalProfileMutation = useMutation({
    mutationFn: async () => {
      if (!walletAddress) {
        throw new Error("Connect a wallet before creating your studio alias.");
      }

      storeLocalProfileName(walletAddress, name.trim());
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: getLocalProfileQueryKey(walletAddress) });
      toast.success("Local alias saved.");
      navigate("/lobby");
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : "Could not save your local alias.");
    },
  });

  if (!walletReady) {
    return (
      <div className="min-h-screen grid-bg">
        <Header />
        <main className="flex min-h-screen items-center justify-center px-4 pt-20">
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

  if (profileQuery.data) {
    return <Navigate to="/lobby" replace />;
  }
  if (!coreContractConfigured && localProfileQuery.data) {
    return <Navigate to="/lobby" replace />;
  }

  const truncatedWallet = `${walletAddress.slice(0, 6)}...${walletAddress.slice(-4)}`;
  const nameLabel = coreContractConfigured ? "Profile Name" : "Local Alias";
  const pageTitle = coreContractConfigured ? "Create Your VerdictDotFun Profile" : "Create Your Local Alias";
  const pageCopy = coreContractConfigured
    ? "Create your permanent VerdictDotFun profile on GenLayer. It anchors your handle, rank, XP, and season record."
    : "Save a local alias for this wallet so you can still test the game contracts when the core contract is not configured.";
  const actionLabel = coreContractConfigured ? "Create Profile & Enter" : "Save Alias & Enter";
  const isSubmitting = coreContractConfigured ? createProfileMutation.isPending : createLocalProfileMutation.isPending;
  const previewRankLabel = coreContractConfigured ? "Bronze 1" : "Local Test";
  const footerLabel = coreContractConfigured
    ? "Stored on the active GenLayer network"
    : "Stored locally in this browser for the connected wallet";

  const handlePrimaryAction = () => {
    if (coreContractConfigured) {
      createProfileMutation.mutate();
      return;
    }

    createLocalProfileMutation.mutate();
  };

  return (
    <div className="min-h-screen grid-bg">
      <Header />
      <main className="flex items-center justify-center min-h-screen px-4 pt-20">
        <motion.div variants={container} initial="hidden" animate="show" className="max-w-4xl w-full">
          <motion.div variants={item} className="mb-6">
            <BackButton backTo="/" />
          </motion.div>
          <div className="grid md:grid-cols-2 gap-12 items-center">
            <motion.div variants={container} initial="hidden" animate="show">
              <motion.h1 variants={item} className="font-heading text-4xl font-bold mb-3">{pageTitle}</motion.h1>
              <motion.p variants={item} className="text-muted-foreground mb-8">
                {pageCopy}
              </motion.p>
              <motion.div variants={item} className="space-y-4">
                <div>
                  <label className="text-sm text-muted-foreground mb-2 block">{nameLabel}</label>
                  <Input
                    value={name}
                    onChange={(e) => setName(e.target.value.slice(0, 24))}
                    placeholder={coreContractConfigured ? "Enter your profile name" : "Enter your local alias"}
                    className="bg-card border-border text-foreground"
                    maxLength={24}
                  />
                  <span className="text-xs text-muted-foreground mt-1 block text-right">{name.length}/24</span>
                </div>
                <motion.div whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.98 }}>
                  <Button
                    variant="arena"
                    className="w-full py-6"
                    onClick={handlePrimaryAction}
                    disabled={isSubmitting || name.trim().length < 3}
                  >
                    {isSubmitting ? (coreContractConfigured ? "Creating..." : "Saving...") : actionLabel}
                  </Button>
                </motion.div>
                <p className="text-xs text-muted-foreground text-center">{footerLabel}</p>
              </motion.div>
            </motion.div>
            <motion.div
              initial={{ opacity: 0, scale: 0.9, rotateY: -10 }}
              animate={{ opacity: 1, scale: 1, rotateY: 0 }}
              transition={{ delay: 0.4, duration: 0.7, ease: [0.16, 1, 0.3, 1] }}
              className="flex justify-center"
            >
              <motion.div
                animate={{ y: [0, -8, 0] }}
                transition={{ duration: 4, repeat: Infinity, ease: "easeInOut" }}
                className="w-72 rounded-xl border border-border bg-card p-6 glow-red-subtle"
              >
                <div className="aspect-square rounded-lg bg-secondary mb-4 flex items-center justify-center overflow-hidden">
                  <AnimatePresence mode="wait">
                    <motion.span
                      key={name ? name[0] : "?"}
                      initial={{ scale: 0, rotate: -180 }}
                      animate={{ scale: 1, rotate: 0 }}
                      exit={{ scale: 0, rotate: 180 }}
                      transition={{ duration: 0.3 }}
                      className="font-heading text-3xl font-bold text-primary"
                    >
                      {name ? name[0].toUpperCase() : "?"}
                    </motion.span>
                  </AnimatePresence>
                </div>
                <h3 className="font-heading text-xl font-bold mb-1">{name || "Profile Name"}</h3>
                <p className="text-xs text-muted-foreground font-mono mb-3">{truncatedWallet}</p>
                <div className="flex justify-between text-sm">
                  <div>
                    <span className="text-muted-foreground">{coreContractConfigured ? "Rank" : "Mode"}</span>
                    <p className="font-heading font-bold">{previewRankLabel}</p>
                  </div>
                  <div>
                    <span className="text-muted-foreground">{coreContractConfigured ? "XP" : "Wallet"}</span>
                    <p className="font-heading font-bold">{coreContractConfigured ? "0 / 500" : "Ready"}</p>
                  </div>
                </div>
              </motion.div>
            </motion.div>
          </div>
        </motion.div>
      </main>
    </div>
  );
};

export default MintProfile;
