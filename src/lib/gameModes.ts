import type { ArenaMode, ArgueStyle } from "@/types/arena";

export const ARENA_MODES: ArenaMode[] = ["argue", "riddle"];
export const ARGUE_STYLES: ArgueStyle[] = ["debate", "convince"];

export const GAME_MODE_META: Record<
  ArenaMode,
  {
    title: string;
    summary: string;
    description: string;
    ownerLabel: string;
    opponentLabel: string;
    promptLabel: string;
    submissionLabel: string;
    promptPlaceholder: string;
    submissionPlaceholder: string;
    defaultCategory: string;
    minimumSubmissionLength: number;
  }
> = {
  argue: {
    title: "Argue",
    summary: "One contract, two room styles. Pick debate or convince when you open the room.",
    description: "Open an argue room, choose whether it should generate a debate motion or a convince-me scenario, and let the contract judge the stronger case.",
    ownerLabel: "Player One",
    opponentLabel: "Player Two",
    promptLabel: "Room prompt",
    submissionLabel: "Your argument",
    promptPlaceholder: "The contract generates the exact prompt after you choose the argue style.",
    submissionPlaceholder: "Write a clear, structured argument that directly addresses the generated prompt.",
    defaultCategory: "Tech",
    minimumSubmissionLength: 40,
  },
  riddle: {
    title: "Riddle",
    summary: "The contract generates three riddles, checks each guess immediately, and the fastest correct solver wins the round.",
    description: "Open a three-round riddle match where every guess is checked on-chain immediately, each player gets up to three tries per riddle, and tied scorelines resolve as a draw.",
    ownerLabel: "Player One",
    opponentLabel: "Player Two",
    promptLabel: "Riddle clue",
    submissionLabel: "Your guess",
    promptPlaceholder: "The contract generates the clue from the chosen category.",
    submissionPlaceholder: "Guess the object, animal, idea, or thing the clue points to. Each riddle gives you up to three tries.",
    defaultCategory: "Culture",
    minimumSubmissionLength: 2,
  },
};

export function getArenaMode(value: string | undefined): ArenaMode | null {
  if (value === "argue" || value === "riddle") {
    return value;
  }

  return null;
}
