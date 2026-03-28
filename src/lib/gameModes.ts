import type { ArenaMode } from "@/types/arena";

export const ARENA_MODES: ArenaMode[] = ["debate", "convince", "quiz", "riddle"];

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
  debate: {
    title: "Debate",
    summary: "Proposer versus opposer. The contract rewards the stronger case, not objective truth.",
    description: "Open a two-sided debate where the contract generates the proposition and one player proposes while the other opposes.",
    ownerLabel: "Proposer",
    opponentLabel: "Opposer",
    promptLabel: "Debate prompt",
    submissionLabel: "Your debate case",
    promptPlaceholder: "State the exact proposition both players will argue over.",
    submissionPlaceholder: "Write a structured case with claims, support, and direct engagement with the prompt.",
    defaultCategory: "Tech",
    minimumSubmissionLength: 40,
  },
  convince: {
    title: "Convince Me",
    summary: "The contract starts from a hostile stance and picks who moved it the furthest.",
    description: "Both players try to persuade the contract away from the room-specific stance it generates.",
    ownerLabel: "Player One",
    opponentLabel: "Player Two",
    promptLabel: "Scenario",
    submissionLabel: "Your persuasion case",
    promptPlaceholder: "Describe the angle or scenario the players should use to challenge the contract's stance.",
    submissionPlaceholder: "Make the strongest case for why the contract should soften or reverse its starting position.",
    defaultCategory: "Social",
    minimumSubmissionLength: 40,
  },
  quiz: {
    title: "Quiz",
    summary: "The contract generates study material, then both players race through the same eleven-question quiz.",
    description: "Open a head-to-head quiz where the opponent accepts, the owner starts generation, both players study the same note, and the contract runs a shared-question race to six.",
    ownerLabel: "Player One",
    opponentLabel: "Player Two",
    promptLabel: "Quiz set",
    submissionLabel: "Your answer",
    promptPlaceholder: "The contract generates the quiz title and source material from the category.",
    submissionPlaceholder: "Pick one of the five options. Fastest confirmed answer gets first shot.",
    defaultCategory: "History",
    minimumSubmissionLength: 1,
  },
  riddle: {
    title: "Riddle",
    summary: "The contract generates five riddles and the first player to solve three wins the room.",
    description: "Open a five-round riddle match where both players lock one guess per riddle and the contract advances until someone reaches three correct answers.",
    ownerLabel: "Player One",
    opponentLabel: "Player Two",
    promptLabel: "Riddle clue",
    submissionLabel: "Your guess",
    promptPlaceholder: "The contract generates the clue from the chosen category.",
    submissionPlaceholder: "Guess the object, animal, idea, or thing the clue points to.",
    defaultCategory: "Culture",
    minimumSubmissionLength: 2,
  },
};

export function getArenaMode(value: string | undefined): ArenaMode | null {
  if (value === "debate" || value === "convince" || value === "quiz" || value === "riddle") {
    return value;
  }

  return null;
}
