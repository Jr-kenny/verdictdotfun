export type ArenaMode = "debate" | "convince" | "quiz";

export type ArenaRoomStatus = "waiting" | "active" | "resolved";

export interface ArenaProfile {
  tokenId: number;
  name: string;
  xp: number;
  wins: number;
  losses: number;
  level: number;
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
}
