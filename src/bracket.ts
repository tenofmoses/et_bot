// ВСЁ ПО ТАБЛИЦЕ МАТЧЕЙ
import { Match, Player, Round, TournamentBracket } from "./types";

const DEBUG_BRACKET = true;

/**
 * Вспомогательный логгер для отладки построения сетки.
 */
function log(...args: any[]) {
  if (DEBUG_BRACKET) {
    console.debug('[BRACKET]', ...args);
  }
}

/**
 * createTournamentBracket
 * Строит первый раунд с реальными парами и формирует «каркас» последующих раундов с матчами-заглушками.
 * Одиночные матчи в первом раунде сразу помечаются как завершённые, их единственный игрок — победитель.
 * Также вычисляет раунд, в который должен влиться bye-игрок (byeRound), если на входе какого-либо шага остаётся нечётное число участников.
 */
export function createTournamentBracket(participants: Map<number, string>): TournamentBracket {
  log('createTournamentBracket: participants =', participants.size);

  const playerList = Array.from(participants.entries()).map(([id, name]) => ({ id, name }));

  // Перемешиваем участников (Фишер–Йетс), чтобы стартовые пары были случайными.
  for (let i = playerList.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [playerList[i], playerList[j]] = [playerList[j], playerList[i]];
  }
  log('createTournamentBracket: shuffled players =', playerList.map(p => p.name));

  // Первый раунд: собираем реальные пары. Если не хватает второго — создаём одиночный матч.
  // Для одиночного матча сразу выставляем winner = player1 и completed = true (автопроход).
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
      log(`R1: pair = ${p1.name} vs ${p2.name}`);
    } else {
      firstRoundMatches.push({
        player1: { id: p1.id, name: p1.name },
        player2: null,                 // одиночный матч
        winner: { id: p1.id, name: p1.name }, // автопобеда
        completed: true,               // матч сразу закрыт
      });
      log(`R1: single = ${p1.name} (автопроход оформлен)`);
    }
  }

  const rounds: Round[] = [{ matches: firstRoundMatches }];

  /**
   * Сколько участников идёт дальше после 1-го раунда?
   * Ровно столько, сколько матчей в первом раунде, потому что у каждого матча один победитель
   * (для одиночного — уже назначенный победитель).
   */
  let remaining = firstRoundMatches.length;
  log('Skeleton: after R1 remaining =', remaining);

  /**
   * Строим «каркас» следующих раундов.
   * На каждом шаге добавляем раунд с floor(remaining/2) матчами-заглушками.
   * Если remaining нечётно, фиксируем, что один участник пропускает текущий раунд,
   * и должен влиться в следующий — запоминаем индекс этого следующего раунда в byeRound.
   * После этого считаем, сколько участников останется к следующему шагу:
   * winners = matchesThisRound (+1, если был пропуск).
   */
  let byeRound: number | undefined;
  let nextRoundIdx = 1; // индекс добавляемого раунда (после первого)

  while (remaining > 1) {
    const matchesThisRound = Math.floor(remaining / 2);
    const matches: Match[] = Array.from({ length: matchesThisRound }, () => ({
      player1: { id: -1, name: 'TBD' },
      player2: { id: -1, name: 'TBD' },
      completed: false,
    }));

    rounds.push({ matches });
    log(`Skeleton: add round #${nextRoundIdx + 1} with matches =`, matchesThisRound);

    if (remaining % 2 === 1) {
      // Нечётно: одна участница пропускает текущий раунд и «вклеивается» в следующий.
      byeRound = nextRoundIdx + 1;
      log(`Skeleton: remaining is odd (${remaining}), byeRound scheduled for round index = ${byeRound}`);
    }

    remaining = matchesThisRound + (remaining % 2);
    log(`Skeleton: after round #${nextRoundIdx + 1} remaining =`, remaining);

    nextRoundIdx += 1;
  }

  const bracket: TournamentBracket = {
    rounds,
    totalRounds: rounds.length,
    byeRound,
    byePlayer: undefined,
  };

  log('createTournamentBracket: totalRounds =', bracket.totalRounds, 'byeRound =', bracket.byeRound);
  return bracket;
}

/**
 * collectWinnersOfRound
 * Возвращает победителей указанного раунда.
 * Если у матча задан winner — используем его.
 * Если матч одиночный (player2 === null) и winner не задан, считаем победителем player1 (на случай, если одиночный матч был создан без автопометки).
 *
 * @param round — раунд, из которого нужно собрать победителей
 * @returns Player[] — массив победителей
 */
export function collectWinnersOfRound(round: Round): Player[] {
  const winners: Player[] = [];
  for (const m of round.matches) {
    if (m.winner) {
      winners.push(m.winner);
      log('collectWinners: winner =', m.winner.name);
    } else if (m.player2 === null) {
      winners.push(m.player1);
      log('collectWinners: single auto-advance =', m.player1.name);
    } else {
      log('collectWinners: match has no winner yet');
    }
  }
  log('collectWinners: total winners =', winners.length);
  return winners;
}

/**
 * pickByeIfNeeded
 * В «пред-бай» раунде (индекс = byeRound - 1) при нечётном числе входящих победителей выбирает конкретного участника,
 * который пропустит текущий раунд и присоединится в byeRound. По умолчанию берётся последняя из списка.
 * @returns объект с playersToPlace (участники, которых надо раскладывать по матчам) и byePicked (если была выбрана)
 */
export function pickByeIfNeeded(
  winners: Player[], // победители текущего раунда перед раскладкой на следующий
  bracket: TournamentBracket, // турнирная сетка с рассчитанным byeRound
  currentRoundIndex: number // индекс текущего раунда
): { playersToPlace: Player[]; byePicked?: Player } {
  log(`pickByeIfNeeded: winners=${winners.map(w => w.name).join(', ')}, currentRound=${currentRoundIndex}, byeRound=${bracket.byeRound}`);

  const isOdd = winners.length % 2 === 1;
  const isPreByeRound = bracket.byeRound !== undefined && currentRoundIndex === bracket.byeRound - 1;

  if (isOdd && isPreByeRound) {
    const byePicked = winners[winners.length - 1];
    const playersToPlace = winners.slice(0, winners.length - 1);
    log(`pickByeIfNeeded: picked bye = ${byePicked.name}, playersToPlace = ${playersToPlace.map(p => p.name).join(', ')}`);
    return { playersToPlace, byePicked };
  }

  log('pickByeIfNeeded: no bye picked');
  return { playersToPlace: winners };
}

/**
 * addByeIfJoiningThisRound
 * Если текущий раунд совпадает с byeRound, добавляет ранее выбранную bye-участника к списку размещаемых игроков.
 * После использования вызывающий код обычно обнуляет bracket.byePlayer.
 *
 * @returns Player[] — итоговый список участников для раскладки (возможно, с добавленной bye-участника)
 */
export function addByeIfJoiningThisRound(
  playersToPlace: Player[], // список участников для раскладки по матчам текущего раунда
  bracket: TournamentBracket, // турнирная сетка (используем byeRound и byePlayer)
  currentRoundIndex: number // индекс текущего раунда
): Player[] {
  const needJoin = bracket.byeRound !== undefined && currentRoundIndex === bracket.byeRound && !!bracket.byePlayer;
  log(`addByeIfJoiningThisRound: currentRound=${currentRoundIndex}, byeRound=${bracket.byeRound}, join=${needJoin}`);

  if (needJoin) {
    const withBye = [...playersToPlace, bracket.byePlayer!];
    log('addByeIfJoiningThisRound: added bye =', bracket.byePlayer!.name, '→ playersToPlace =', withBye.map(p => p.name));
    return withBye;
  }

  return playersToPlace;
}

/**
 * applyPlayersToRound
 * Раскладывает переданных игроков по матчам раунда, сбрасывая служебные поля (roll, winner, completed).
 * Если не хватает второго игрока, формирует одиночный матч и сразу помечает его как завершённый
 * с победителем player1, если player1 задан (не TBD). Если player1 = TBD — оставляет матч открытым.
 *
 * @param round — мутируемый раунд, в который раскладываем игроков
 * @param players — список игроков для раскладки
 */
export function applyPlayersToRound(round: Round, players: Player[]): void {
  log('applyPlayersToRound: players =', players.map(p => p.name));

  let idx = 0;
  for (let mi = 0; mi < round.matches.length; mi++) {
    const match = round.matches[mi];
    const p1 = players[idx++];
    const p2 = players[idx++];

    if (p1) {
      match.player1 = { id: p1.id, name: p1.name, roll: undefined };
    } else {
      match.player1 = { id: -1, name: 'TBD' };
    }

    if (p2) {
      match.player2 = { id: p2.id, name: p2.name, roll: undefined };
      match.winner = undefined;
      match.completed = false;
      log(`applyPlayersToRound: M${mi + 1} = ${match.player1.name} vs ${match.player2.name}`);
    } else {
      match.player2 = null; // одиночный матч
      // Автопобеда и автозакрытие, если player1 задан (не TBD).
      if (match.player1.id !== -1) {
        match.winner = { id: match.player1.id, name: match.player1.name };
        match.completed = true;
        log(`applyPlayersToRound: M${mi + 1} single → winner = ${match.player1.name} (автопроход)`);
      } else {
        // Если player1 ещё TBD, матч остаётся незавершённым — ждём фактического игрока.
        match.winner = undefined;
        match.completed = false;
        log(`applyPlayersToRound: M${mi + 1} single with TBD → awaiting`);
      }
    }
  }
}

/**
 * isRoundCompleted
 * Проверяет, что все матчи раунда помечены как завершённые (completed = true).
 *
 * @returns boolean — true, если каждый матч завершён
 */
export function isRoundCompleted(round: Round): boolean {
  const done = round.matches.every(m => m.completed);
  log('isRoundCompleted:', done);
  return done;
}
