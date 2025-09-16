
export interface Tournament {
  messageId: number;
  messageThreadId?: number;
  participants: Set<number>;
  participantNames: Map<number, string>;
  organizerId: number;
  organizerName: string;
  bracket?: TournamentBracket;
  currentRound?: number;
  currentMatch?: number;
  gameState?: 'registration' | 'playing' | 'finished' | 'cancelled';
  startTime?: string;
}

export interface TournamentBracket {
  rounds: Round[];
  totalRounds: number;
  byePlayer?: Player;   // конкретный игрок, назначенный как bye на входе в текущий раунд
  byeRound?: number;    // индекс раунда, куда он "вклеится"
}

export interface Round {
  matches: Match[];
}

export interface Player {
  id: number;
  name: string;
  roll?: number;
}

export interface Match {
  player1: Player;
  player2: Player | null;
  winner?: Player;
  completed: boolean;
}