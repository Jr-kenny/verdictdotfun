import type { ArenaMode, ArgueStyle } from "@/types/arena";

export const ARENA_MODES: ArenaMode[] = ["argue", "riddle", "bluff", "prompt_duel", "sketch"];
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
  bluff: {
    title: "Bluff",
    summary: "Both players defend the same wild claim — out-bluff your rival.",
    description: "Open a bluff room and the contract generates one hard-to-defend claim. Both players argue it is true, and the judge scores persuasiveness only, ignoring whether the claim is actually true.",
    ownerLabel: "Player One",
    opponentLabel: "Player Two",
    promptLabel: "Room claim",
    submissionLabel: "Your case",
    promptPlaceholder: "The contract generates the claim after the room owner starts the match.",
    submissionPlaceholder: "Write a clear, persuasive case that the claim is true.",
    defaultCategory: "Tech",
    minimumSubmissionLength: 40,
  },
  prompt_duel: {
    title: "Prompt Duel",
    summary: "Write the prompt that best recreates a hidden target — shortest wins ties.",
    description: "Open a prompt duel room and the contract generates one hidden target output. Both players write a prompt designed to make a language model reproduce it, and the judge scores how closely each prompt's output would match. Ties are broken by prompt brevity.",
    ownerLabel: "Player One",
    opponentLabel: "Player Two",
    promptLabel: "Target output",
    submissionLabel: "Your prompt",
    promptPlaceholder: "The contract generates the target after the room owner starts the match.",
    submissionPlaceholder: "Write the prompt you think will most closely reproduce the target.",
    defaultCategory: "Tech",
    minimumSubmissionLength: 3,
  },
  sketch: {
    title: "Sketch & Guess",
    summary: "Draw your theme, then guess what your rival drew — the vision judge calls it.",
    description: "Open a sketch room and the contract generates a drawing theme. Each player uploads a drawing that fits the theme, then guesses what their opponent drew. A vision model judges whether each guess matches the image; more correct guesses wins.",
    ownerLabel: "Player One",
    opponentLabel: "Player Two",
    promptLabel: "Drawing theme",
    submissionLabel: "Your guess",
    promptPlaceholder: "The contract generates the theme after the room owner starts the match.",
    submissionPlaceholder: "Guess what your opponent drew.",
    defaultCategory: "Nature",
    minimumSubmissionLength: 2,
  },
};

export function getArenaMode(value: string | undefined): ArenaMode | null {
  if (value === "argue" || value === "riddle" || value === "bluff" || value === "prompt_duel" || value === "sketch") {
    return value;
  }

  return null;
}
