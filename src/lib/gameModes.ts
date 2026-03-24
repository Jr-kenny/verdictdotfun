import type { ArenaMode } from "@/types/arena";

export const ARENA_MODES: ArenaMode[] = ["debate", "convince", "quiz"];

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
    description: "Open a two-sided debate where one player proposes and the other opposes the same prompt.",
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
    description: "Both players try to persuade the contract away from its built-in bias against WhatsApp.",
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
    summary: "Two players answer the same question and the contract scores factual accuracy.",
    description: "Open a head-to-head quiz where the contract judges correctness and completeness.",
    ownerLabel: "Player One",
    opponentLabel: "Player Two",
    promptLabel: "Question",
    submissionLabel: "Your answer",
    promptPlaceholder: "Write the quiz question both players will answer.",
    submissionPlaceholder: "Answer directly and accurately. The contract rewards correctness over confidence.",
    defaultCategory: "History",
    minimumSubmissionLength: 8,
  },
};

export function getArenaMode(value: string | undefined): ArenaMode | null {
  if (value === "debate" || value === "convince" || value === "quiz") {
    return value;
  }

  return null;
}
