import { Match, Player, Round, TournamentBracket } from "./types";

// Создание начальной сетки + планирование раундов и byeRound (без выбора конкретного игрока)
export function createTournamentBracket(participants: Map<number, string>): TournamentBracket {
  const playerList = Array.from(participants.entries()).map(([id, name]) => ({ id, name }));

  // Перемешаем список
  for (let i = playerList.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [playerList[i], playerList[j]] = [playerList[j], playerList[i]];
  }

  // Первый раунд — реальные пары; если нечётно — одиночный матч (автопроход позже)
  const firstRoundMatches: Match[] = [];
  for (let i = 0; i < playerList.length; i += 2) {
    const p1 = playerList[i];
    const p2 = playerList[i + 1];
    if (p2) {
      firstRoundMatches.push({
        player1: { id: p1.id, name: p1.name },
        player2: { id: p2.id, name: p2.name },
        completed: false,
      });
    } else {
      firstRoundMatches.push({
        player1: { id: p1.id, name: p1.name },
        player2: null,
        completed: false,
      });
    }
  }

  const rounds: Round[] = [{ matches: firstRoundMatches }];

  // Сколько игроков идёт дальше после 1-го раунда (у каждого матча — один победитель)
  let remaining = firstRoundMatches.length;

  // Строим «каркас» последующих раундов; отмечаем, что если где-то остаётся нечётно,
  // то следующий раунд после текущего — byeRound (туда «вклеится» bye-игрок)
  let byeRound: number | undefined;
  let nextRoundIdx = 1;
  while (remaining > 1) {
    const matchesThisRound = Math.floor(remaining / 2);
    const matches: Match[] = Array.from({ length: matchesThisRound }, () => ({
      player1: { id: -1, name: 'TBD' },
      player2: { id: -1, name: 'TBD' },
      completed: false,
    }));
    rounds.push({ matches });

    if (remaining % 2 === 1) {
      byeRound = nextRoundIdx + 1; // следующий после текущего
    }

    remaining = matchesThisRound + (remaining % 2);
    nextRoundIdx += 1;
  }

  return {
    rounds,
    totalRounds: rounds.length,
    byeRound,
    byePlayer: undefined,
  };
}

// Подсчёт победителей раунда (с учётом одиночных матчей = автопроход)
export function collectWinnersOfRound(round: Round): Player[] {
  const winners: Player[] = [];
  for (const m of round.matches) {
    if (m.winner) {
      winners.push(m.winner);
    } else if (m.player2 === null) {
      // одиночный матч: проходит player1
      winners.push(m.player1);
    }
  }
  return winners;
}

// Выбор bye-игрока в «пред-бай» раунде (если нечётно)
// Возвращает массив игроков, за вычетом выбранного bye (если был выбран), и выбранного bye.
export function pickByeIfNeeded(
  winners: Player[],
  bracket: TournamentBracket,
  currentRoundIndex: number
): { playersToPlace: Player[]; byePicked?: Player } {
  if (
    winners.length % 2 === 1 &&
    bracket.byeRound !== undefined &&
    currentRoundIndex === bracket.byeRound - 1
  ) {
    const byePicked = winners[winners.length - 1]; // стратегия выбора — последний
    const playersToPlace = winners.slice(0, winners.length - 1);
    return { playersToPlace, byePicked };
  }
  return { playersToPlace: winners };
}

// Если текущий раунд — это byeRound, добавляем byePlayer к размещаемым
export function addByeIfJoiningThisRound(
  playersToPlace: Player[],
  bracket: TournamentBracket,
  currentRoundIndex: number
): Player[] {
  if (
    bracket.byeRound !== undefined &&
    currentRoundIndex === bracket.byeRound &&
    bracket.byePlayer
  ) {
    return [...playersToPlace, bracket.byePlayer];
  }
  return playersToPlace;
}

// Применяем раскладку игроков в матчи раунда (мутируем round), обнуляем служебные поля
export function applyPlayersToRound(round: Round, players: Player[]): void {
  let idx = 0;
  for (const match of round.matches) {
    const p1 = players[idx++];
    const p2 = players[idx++];

    if (p1) {
      match.player1 = { id: p1.id, name: p1.name, roll: undefined };
    } else {
      match.player1 = { id: -1, name: 'TBD' };
    }

    if (p2) {
      match.player2 = { id: p2.id, name: p2.name, roll: undefined };
    } else {
      // безопасная деградация — одиночный матч
      match.player2 = null;
    }

    match.winner = undefined;
    match.completed = false;
  }
}

// Вспомогательная проверка: все матчи в раунде завершены?
export function isRoundCompleted(round: Round): boolean {
  return round.matches.every(m => m.completed);
}
