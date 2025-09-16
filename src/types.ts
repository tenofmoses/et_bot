
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
  // антидубли для текущего матча
  matchProcessing?: boolean;   // простая "блокировка" на время обработки
  matchFinalized?: boolean;    // матч уже подведён к итогу
  p1Rolled?: boolean;
  p2Rolled?: boolean;
  // чтобы выключать кнопку после 1-го клика
  currentPromptMessageId?: number;
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