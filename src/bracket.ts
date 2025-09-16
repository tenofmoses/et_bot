// ВСЁ ПО ТАБЛИЦЕ МАТЧЕЙ
import { Match, Player, Round, TournamentBracket } from "./types";

const DEBUG_BRACKET = true;

/** Вспомогательный логгер для отладки построения сетки. */
function log(...args: unknown[]) {
  if (DEBUG_BRACKET) {
    console.debug("[BRACKET]", ...args);
  }
}

/**
 * createTournamentBracket
 * Строит первый раунд с реальными парами и формирует «каркас» последующих раундов с матчами-заглушками.
 * Одиночные матчи в первом раунде сразу считаются выигранными player1.
 * Если на каком-то шаге остаётся нечётное количество участниц, одна пропускает следующий добавленный раунд
 * и «вклеивается» через раунд: индекс этого раунда добавляется в byeJoinRounds.
 */
export function createTournamentBracket(participants: Map<number, string>): TournamentBracket {
  log("createTournamentBracket: participants =", participants.size);

  const playerList = Array.from(participants.entries()).map(([id, name]) => ({ id, name }));

  // Перемешиваем (Фишер–Йетс), чтобы пары были случайными.
  for (let i = playerList.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [playerList[i], playerList[j]] = [playerList[j], playerList[i]];
  }
  log("createTournamentBracket: shuffled players =", playerList.map(p => p.name));

  // Первый раунд: реальные пары; одиночные матчи сразу закрываем автопобедой player1.
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
        player2: null,
        winner: { id: p1.id, name: p1.name },
        completed: true,
      });
      log(`R1: single = ${p1.name} (автопроход оформлен)`);
    }
  }

  const rounds: Round[] = [{ matches: firstRoundMatches }];

  /**
   * После 1-го раунда дальше идёт ровно столько участниц, сколько матчей в первом раунде.
   * На каждом следующем шаге добавляем раунд с floor(remaining/2) матчами.
   * Если remaining нечётно, одна участница пропускает только что добавленный раунд
   * и присоединяется к следующему — запоминаем индекс ЭТОГО следующего раунда в byeJoinRounds.
   */
  let remaining = firstRoundMatches.length;
  const byeJoinRounds: number[] = [];
  let nextRoundIdx = 1; // индекс добавляемого раунда (0-based в массиве rounds)

  log("Skeleton: after R1 remaining =", remaining);

  while (remaining > 1) {
    const matchesThisRound = Math.floor(remaining / 2);
    const matches: Match[] = Array.from({ length: matchesThisRound }, () => ({
      player1: { id: -1, name: "TBD" },
      player2: { id: -1, name: "TBD" },
      completed: false,
    }));

    rounds.push({ matches });
    log(`Skeleton: add round #${nextRoundIdx + 1} with matches =`, matchesThisRound);

    if (remaining % 2 === 1) {
      // Нечётно: одна участница пропускает ДОБАВЛЕННЫЙ раунд и «вклеится» в СЛЕДУЮЩИЙ.
      const joinRoundIndex = nextRoundIdx + 1; // 0-based
      byeJoinRounds.push(joinRoundIndex);
      log(
        `Skeleton: remaining is odd (${remaining}), bye will JOIN round index = ${joinRoundIndex}`
      );
    }

    remaining = matchesThisRound + (remaining % 2);
    log(`Skeleton: after round #${nextRoundIdx + 1} remaining =`, remaining);

    nextRoundIdx += 1;
  }

  const bracket: TournamentBracket = {
    rounds,
    totalRounds: rounds.length,
    byeJoinRounds,
    byePlayersByJoinRound: new Map<number, Player>(),
  };

  log(
    "createTournamentBracket: totalRounds =",
    bracket.totalRounds,
    "byeJoinRounds =",
    bracket.byeJoinRounds
  );
  return bracket;
}

/**
 * collectWinnersOfRound
 * Возвращает победительниц указанного раунда.
 * Если winner указан — берём его; если матч одиночный и winner не указан, считаем победителем player1.
 */
export function collectWinnersOfRound(round: Round): Player[] {
  const winners: Player[] = [];
  for (const m of round.matches) {
    if (m.winner) {
      winners.push(m.winner);
      log("collectWinners: winner =", m.winner.name);
    } else if (m.player2 === null) {
      winners.push(m.player1);
      log("collectWinners: single auto-advance =", m.player1.name);
    } else {
      log("collectWinners: match has no winner yet");
    }
  }
  log("collectWinners: total winners =", winners.length);
  return winners;
}

/**
 * addByeIfJoiningThisRound
 * Если для currentRoundIndex заранее выбран bye-игрок, добавляет её к списку раскладки.
 * Удаление записи из карты можно делать снаружи после вызова, когда это удобно.
 */
export function addByeIfJoiningThisRound(
  playersToPlace: Player[],
  bracket: TournamentBracket,
  currentRoundIndex: number
): Player[] {
  const bye = bracket.byePlayersByJoinRound.get(currentRoundIndex);
  const needJoin = !!bye;
  log(
    `addByeIfJoiningThisRound: currentRound=${currentRoundIndex}, needJoin=${needJoin}`
  );

  if (bye) {
    const withBye = [...playersToPlace, bye];
    log(
      "addByeIfJoiningThisRound: added bye =",
      bye.name,
      "→ playersToPlace =",
      withBye.map(p => p.name)
    );
    return withBye;
  }

  return playersToPlace;
}

/**
 * pickByeConsideringEntrants
 * Берёт уже сформированный список входящих в ТЕКУЩИЙ раунд (winners + все вклейки этого раунда).
 * Если их число нечётно и на следующий раунд запланирована «вклейка» —
 * вынимает одного участника в bye для следующего раунда.
 */
export function pickByeConsideringEntrants(
  entrants: Player[],
  bracket: TournamentBracket,
  currentRoundIndex: number
): { playersToPlace: Player[]; byePicked?: Player; joinRoundIndex?: number } {
  const nextRoundIndex = currentRoundIndex + 1;
  const joinPlannedNext = bracket.byeJoinRounds.includes(nextRoundIndex);

  log(
    `pickByeConsideringEntrants: entrants=${entrants.map(e => e.name).join(", ")}, currentRound=${currentRoundIndex}, nextRound=${nextRoundIndex}, nextHasJoin=${joinPlannedNext}`
  );

  if (entrants.length % 2 === 1 && joinPlannedNext) {
    const rndIndex = Math.floor(Math.random() * entrants.length);
    const byePicked = entrants[rndIndex];
    const playersToPlace = entrants.slice(0, rndIndex).concat(entrants.slice(rndIndex + 1));
    log(
      `pickByeConsideringEntrants: picked bye = ${byePicked.name}, playersToPlace = ${playersToPlace
        .map(p => p.name)
        .join(", ")}, joinRoundIndex=${nextRoundIndex}`
    );
    return { playersToPlace, byePicked, joinRoundIndex: nextRoundIndex };
  }

  log("pickByeConsideringEntrants: no bye picked");
  return { playersToPlace: entrants };
}

/**
 * applyPlayersToRound
 * Раскладывает игроков по матчам текущего раунда.
 * Сбрасывает служебные поля (roll, winner, completed). Если второго не хватает — одиночный матч.
 * Для одиночного матча, если player1 не TBD, сразу проставляет winner и completed.
 */
export function applyPlayersToRound(round: Round, players: Player[]): void {
  log("applyPlayersToRound: players =", players.map(p => p.name));

  let idx = 0;
  for (let mi = 0; mi < round.matches.length; mi++) {
    const match = round.matches[mi];
    const p1 = players[idx++];
    const p2 = players[idx++];

    if (p1) {
      match.player1 = { id: p1.id, name: p1.name, roll: undefined };
    } else {
      match.player1 = { id: -1, name: "TBD" };
    }

    if (p2) {
      match.player2 = { id: p2.id, name: p2.name, roll: undefined };
      match.winner = undefined;
      match.completed = false;
      log(`applyPlayersToRound: M${mi + 1} = ${match.player1.name} vs ${match.player2.name}`);
    } else {
      match.player2 = null;
      if (match.player1.id !== -1) {
        match.winner = { id: match.player1.id, name: match.player1.name };
        match.completed = true;
        log(
          `applyPlayersToRound: M${mi + 1} single → winner = ${match.player1.name} (автопроход)`
        );
      } else {
        match.winner = undefined;
        match.completed = false;
        log(`applyPlayersToRound: M${mi + 1} single with TBD → awaiting`);
      }
    }
  }
}

/** isRoundCompleted — все матчи раунда закрыты? */
export function isRoundCompleted(round: Round): boolean {
  const done = round.matches.every(m => m.completed);
  log("isRoundCompleted:", done);
  return done;
}
