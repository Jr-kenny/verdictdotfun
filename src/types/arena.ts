export type ArenaMode = "debate" | "convince" | "quiz" | "riddle";

export type ArenaRoomStatus =
  | "waiting"
  | "pending_accept"
  | "ready_to_start"
  | "studying"
  | "active"
  | "resolved";

export interface ArenaProfile {
  profileAddress: string;
  owner: string;
  name: string;
  seasonId: number;
  currentSeasonId: number;
  pendingReset: boolean;
  rankTier: number;
  rankTierName: string;
  rankDivision: number;
  rankLabel: string;
  xp: number;
  xpRequired: number;
  xpToNext: number;
  totalXp: number;
  wins: number;
  losses: number;
  lifetimeWins: number;
  lifetimeLosses: number;
}

export interface LeaderboardEntry {
  position: number;
  profile: ArenaProfile;
}

export interface VerdictBadge {
  tokenId: string;
  profileAddress: string;
  owner: string;
  handle: string;
  permanentXp: number;
  level: number;
  linked: boolean;
}

export interface ArenaRoom {
  id: string;
  mode: ArenaMode;
  owner: string;
  ownerName: string;
  opponent: string;
  opponentName: string;
  category: string;
  prompt: string;
  houseStance: string;
  ownerSubmission: string;
  opponentSubmission: string;
  status: ArenaRoomStatus;
  winner: string;
  ownerScore: number;
  opponentScore: number;
  verdictReasoning: string;
  materialBody?: string;
  questionCount?: number;
  currentQuestionIndex?: number;
  ownerQuestionsSecured?: number;
  opponentQuestionsSecured?: number;
  ownerAttemptsUsed?: number;
  opponentAttemptsUsed?: number;
  ownerReady?: boolean;
  opponentReady?: boolean;
  currentTurn?: string;
  revealedAnswer?: string;
  accepted?: boolean;
  ownerLastResult?: string;
  opponentLastResult?: string;
}

export interface QuizPlayerState {
  role: "owner" | "opponent";
  ready: boolean;
  questionsSecured: number;
  attemptsUsed: number;
  attemptsRemaining: number;
  totalQuestions: number;
  questionIndex: number;
  status: ArenaRoomStatus;
  latestSubmission: string;
  waitingOnOther: boolean;
  canAnswer: boolean;
}

export interface QuizQuestionState {
  questionIndex: number;
  question: string;
  options: string[];
  revealedAnswer: string;
  currentTurn: string;
}
