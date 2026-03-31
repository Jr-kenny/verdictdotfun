export type ArenaMode = "argue" | "riddle";
export type ArgueStyle = "debate" | "convince";

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
  argueStyle?: ArgueStyle;
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
  revealedAnswer?: string;
}
