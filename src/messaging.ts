// ВСЁ ПРО СООБЩЕНИЯ: отправка/редактирование с ретраями + генерация текстов
import TelegramBot from 'node-telegram-bot-api';
import { Tournament, TournamentBracket, Round, Match } from './types';

const DEBUG_MSG = true;

function log(...args: unknown[]) {
  if (DEBUG_MSG) {
    console.debug('[MSG]', ...args);
  }
}

type TelegramApiError = {
  response?: {
    body?: {
      error_code?: number;
      description?: string;
      parameters?: { retry_after?: number };
    };
  };
  message?: string;
};

function isTelegramApiError(e: unknown): e is TelegramApiError {
  return !!e && typeof e === 'object' &&
    ('message' in e || ('response' in e && typeof (e as any).response === 'object'));
}

/**
 * Универсальная отправка сообщений с ретраями.
 * Особые случаи:
 *  - 429 (rate limit): ждём указанный Telegram retry_after (или 5с).
 *  - другие ошибки: экспоненциальный backoff (2^attempt секунд).
 */
export async function sendMessageWithRetry(
  bot: TelegramBot,
  chatId: number,
  text: string,
  options: TelegramBot.SendMessageOptions = {},
  maxRetries = 3
): Promise<TelegramBot.Message> {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      log(`sendMessage attempt #${attempt}`, { chatId, textPreview: text.slice(0, 60) });
      const result = await bot.sendMessage(chatId, text, options);
      log('sendMessage ok', { messageId: result.message_id });
      return result;
    } catch (error: unknown) {
      const code = isTelegramApiError(error) ? error.response?.body?.error_code : undefined;
      const desc =
        (isTelegramApiError(error) && (error.response?.body?.description || error.message)) ||
        'Unknown error';
      log('sendMessage failed', { attempt, code, desc });

      if (code === 429 && isTelegramApiError(error)) {
        const retryAfterSec = error.response?.body?.parameters?.retry_after ?? 5;
        const jitterMs = Math.floor(Math.random() * 500); // +0..500ms
        const delayMs = retryAfterSec * 1000 + jitterMs;
        log(`rate limited: sleep ${delayMs}ms (retry_after=${retryAfterSec}s, jitter=${jitterMs}ms)`);
        await new Promise(res => setTimeout(res, delayMs));
      } else if (attempt < maxRetries) {
        // Full Jitter: sleep in [0, base], где base = 2^attempt * 1000
        const base = Math.pow(2, attempt) * 1000;
        const delay = Math.floor(Math.random() * base);
        log(`backoff with jitter: base=${base}ms, sleep ${delay}ms`);
        await new Promise(res => setTimeout(res, delay));
      } else {
        log('sendMessage giving up');
        throw error;
      }
    }
  }
  // недостижимо, но для TS
  throw new Error('sendMessageWithRetry: exhausted retries');
}

/**
 * Редактирование сообщений с ретраями.
 * Спец-кейс: "message is not modified" — просто выходим без ошибки.
 */
export async function editMessageWithRetry(
  bot: TelegramBot,
  chatId: number,
  messageId: number,
  text: string,
  options: TelegramBot.EditMessageTextOptions = {},
  maxRetries = 3
): Promise<TelegramBot.Message | boolean | null> {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      log(`editMessage attempt #${attempt}`, { chatId, messageId, textPreview: text.slice(0, 60) });
      const result = await bot.editMessageText(text, {
        chat_id: chatId,
        message_id: messageId,
        ...options,
      });
      log('editMessage ok');
      return result;
    } catch (error: unknown) {
      const desc =
        (isTelegramApiError(error) && (error.response?.body?.description || error.message)) || '';
      const code = isTelegramApiError(error) ? error.response?.body?.error_code : undefined;

      if (typeof desc === 'string' && desc.includes('message is not modified')) {
        log('editMessage skipped: not modified');
        return null;
      }

      log('editMessage failed', { attempt, code, desc });

      if (code === 429 && isTelegramApiError(error)) {
        const retryAfterSec = error.response?.body?.parameters?.retry_after ?? 5;
        const jitterMs = Math.floor(Math.random() * 500); // +0..500ms
        const delayMs = retryAfterSec * 1000 + jitterMs;
        log(`rate limited: sleep ${delayMs}ms (retry_after=${retryAfterSec}s, jitter=${jitterMs}ms)`);
        await new Promise(res => setTimeout(res, delayMs));
      } else if (attempt < maxRetries) {
        const base = Math.pow(2, attempt) * 1000;
        const delay = Math.floor(Math.random() * base); // full jitter
        log(`backoff with jitter: base=${base}ms, sleep ${delay}ms`);
        await new Promise(res => setTimeout(res, delay));
      } else {
        log('editMessage giving up');
        throw error;
      }
    }
  }
  throw new Error('editMessageWithRetry: exhausted retries');
}

/**
 * Генерация человекочитаемого текста турнирной сетки для отдельного сообщения.
 */
export function buildBracketText(tournament: Tournament): string {
  if (!tournament.bracket) return '';
  const bracket: TournamentBracket = tournament.bracket;

  let txt = '🏆 ТУРНИРНАЯ СЕТКА 🏆\n\n';

  // Вывести план/факт «вклеек» bye по раундам (0-based -> +1 для человека)
  if (Array.isArray(bracket.byeJoinRounds) && bracket.byeJoinRounds.length > 0) {
    const lines = [...bracket.byeJoinRounds]
      .sort((a, b) => a - b)
      .map((joinIdx) => {
        const p = bracket.byePlayersByJoinRound?.get(joinIdx);
        const who = p ? p.name : 'Игрок с bye';
        return `🎯 ${who} присоединится в раунде ${joinIdx + 1}`;
      });
    if (lines.length) {
      txt += lines.join('\n') + '\n\n';
    }
  }

  bracket.rounds.forEach((round: Round, roundIndex: number) => {
    txt += `Раунд ${roundIndex + 1}:\n`;
    round.matches.forEach((match: Match) => {
      const status = match.completed ? '✅' : '⏳';
      if (match.player1.name === 'TBD' || (match.player2 && match.player2.name === 'TBD')) {
        txt += `${status} Ожидание участников\n`;
      } else if (!match.player2) {
        txt += `${status} ${match.player1.name} (одиночный)`;
        if (match.winner) txt += ` → ${match.winner.name}`;
        txt += '\n';
      } else {
        txt += `${status} ${match.player1.name} vs ${match.player2.name}`;
        if (match.winner) txt += ` → ${match.winner.name}`;
        txt += '\n';
      }
    });
    txt += '\n';
  });

  return txt;
}


/**
 * Генерация «шапки» турнира для закреплённого/главного сообщения.
 * Если турнир в процессе — дополнительно показываем сетку и текущий матч.
 */
export function buildTournamentHeader(tournament: Tournament): string {
  const participantsList =
    tournament.participants.size > 0
      ? Array.from(tournament.participantNames.values()).map((name, i) => `${i + 1}. ${name}`).join('\n')
      : 'Пока никого нет...';

  let msg = `🏆 ТУРНИР 🏆\n\n👑 Организатор: ${tournament.organizerName}`;
  if (tournament.startTime) msg += `\n⏰ Время начала: ${tournament.startTime}`;
  msg += `\n\n👥 Участники (${tournament.participants.size}):\n${participantsList}`;

  // Если турнир ещё не идёт — показываем призыв и выходим
  if (tournament.gameState !== 'playing' || !tournament.bracket) {
    return msg + '\n\n🎯 Нажмите кнопку ниже, чтобы присоединиться или выйти!';
  }

  const { bracket } = tournament;
  msg += `\n\n🏆 ТУРНИРНАЯ СЕТКА 🏆\n\n`;

  // Блок про «вклейки» bye
  msg += renderByeSummary(bracket);

  // Все раунды
  for (let roundIndex = 0; roundIndex < bracket.rounds.length; roundIndex++) {
    const round = bracket.rounds[roundIndex];
    msg += `Раунд ${roundIndex + 1}:\n`;
    msg += round.matches.map(renderMatchLine).join('\n');
    msg += '\n\n';
  }

  // Текущий матч (если есть валидные индексы)
  const cur = tournament.currentRound !== undefined &&
    tournament.currentMatch !== undefined
    ? safeGetCurrentMatch(tournament)
    : null;

  if (cur) {
    const { match, roundIndex } = cur;
    msg += `🎯 ТЕКУЩИЙ МАТЧ (Раунд ${roundIndex + 1}):\n`;
    msg += renderMatchLine(match);

    const hasAnyRoll =
      match.player1.roll !== undefined ||
      (match.player2 && match.player2.roll !== undefined);

    if (hasAnyRoll) {
      msg += `\n\n📊 Результаты:\n`;
      if (match.player1.roll !== undefined) msg += `${match.player1.name}: ${match.player1.roll}\n`;
      if (match.player2 && match.player2.roll !== undefined) msg += `${match.player2.name}: ${match.player2.roll}\n`;
    }
  }

  return msg;
}


/** Короткий свод по запланированным/назначенным bye-вклейкам. */
function renderByeSummary(bracket: TournamentBracket): string {
  if (!Array.isArray(bracket.byeJoinRounds) || bracket.byeJoinRounds.length === 0) return '';
  const lines = [...bracket.byeJoinRounds]
    .sort((a, b) => a - b)
    .map((joinIdx) => {
      const picked = bracket.byePlayersByJoinRound?.get(joinIdx);
      const who = picked ? picked.name : 'Кому-то повезет и он';
      return `🎯 ${who} присоединится в раунде ${joinIdx + 1}`;
    });
  return lines.length ? lines.join('\n') + '\n\n' : '';
}

/** Рендер одной строки матча без вложенных условий. */
function renderMatchLine(match: Match): string {
  const status = match.completed ? '✅' : '⏳';

  // Ожидание, если кто-то из игроков ещё TBD
  const isWaiting =
    match.player1.name === 'TBD' ||
    (match.player2 && match.player2.name === 'TBD');

  if (isWaiting) return `${status} Ожидание участников`;

  // Одиночный матч
  if (!match.player2) {
    const base = `${status} ${match.player1.name} (одиночный)`;
    return match.winner ? `${base} → ${match.winner.name}` : base;
  }

  // Обычный матч
  const base = `${status} ${match.player1.name} vs ${match.player2.name}`;
  return match.winner ? `${base} → ${match.winner.name}` : base;
}


/** Отправляем сетку отдельным сообщением (если она есть) */
export async function sendTournamentBracket(bot: TelegramBot, chatId: number, tournament: Tournament) {
  const text = buildBracketText(tournament);
  if (!text) {
    log('sendTournamentBracket: no bracket text, skip');
    return;
  }
  log('sendTournamentBracket: sending bracket');
  await sendMessageWithRetry(
    bot,
    chatId,
    text,
    { message_thread_id: tournament.messageThreadId } as TelegramBot.SendMessageOptions
  );
}

/** Служебные уведомления — переход/вклейка/автопроход */
export async function announceRoundTransition(bot: TelegramBot, chatId: number, tournament: Tournament) {
  log('announceRoundTransition:', { nextRound: (tournament.currentRound ?? 0) + 1 });
  await sendMessageWithRetry(
    bot,
    chatId,
    `🔄 ПЕРЕХОД К РАУНДУ ${(tournament.currentRound ?? 0) + 1}`,
    { message_thread_id: tournament.messageThreadId } as TelegramBot.SendMessageOptions
  );
}

export async function announceByeJoins(bot: TelegramBot, chatId: number, tournament: Tournament) {
  log('announceByeJoins');
  await sendMessageWithRetry(
    bot,
    chatId,
    `🎯 Игрок с bye присоединяется к этому раунду`,
    { message_thread_id: tournament.messageThreadId } as TelegramBot.SendMessageOptions
  );
}

export async function announceAutoAdvance(bot: TelegramBot, chatId: number, tournament: Tournament, playerName: string) {
  log('announceAutoAdvance:', playerName);
  await sendMessageWithRetry(
    bot,
    chatId,
    `🎯 ${playerName} проходит дальше (одиночный матч).`,
    { message_thread_id: tournament.messageThreadId } as TelegramBot.SendMessageOptions
  );
}

/**
 * Промпт текущего матча: выводит текст и кнопку «Кинуть кубик».
 * Сбрасывает антидубли-флаги и запоминает id сообщения промпта.
 */
export async function promptMatch(bot: TelegramBot, chatId: number, tournament: Tournament, matchNumber: number) {
  const cur = safeGetCurrentMatch(tournament);
  if (!cur || !cur.match.player2) {
    log('promptMatch: no current match or single match — skip prompt');
    return;
  }

  // сброс флагов для идемпотентности
  tournament.matchProcessing = false;
  tournament.matchFinalized = false;
  tournament.p1Rolled = false;
  tournament.p2Rolled = false;
  tournament.currentPromptMessageId = undefined;

  const text = `🎯 МАТЧ ${matchNumber} (Раунд ${cur.roundIndex + 1})\n\n${cur.match.player1.name} vs ${cur.match.player2!.name}\n\nВы должны бросить кубик!`;
  const keyboard: TelegramBot.InlineKeyboardMarkup = {
    inline_keyboard: [[{ text: '🎲 Кинуть кубик', callback_data: 'throw_dice' }]],
  };
  log('promptMatch:', { round: cur.roundIndex + 1, match: matchNumber, p1: cur.match.player1.name, p2: cur.match.player2?.name });

  const sent = await sendMessageWithRetry(
    bot,
    chatId,
    text,
    {
      reply_markup: keyboard,
      message_thread_id: tournament.messageThreadId,
    } as TelegramBot.SendMessageOptions
  );

  tournament.currentPromptMessageId = sent?.message_id;
}

/**
 * Безопасно достаёт текущий раунд/матч из состояния турнира.
 * Возвращает null, если индексы «уехали».
 */
export function safeGetCurrentMatch(
  tournament: Tournament
): { round: Round; match: Match; roundIndex: number; matchIndex: number } | null {
  const bracket = tournament.bracket;
  const rIdx = tournament.currentRound;
  const mIdx = tournament.currentMatch;
  if (!bracket || rIdx == null || mIdx == null) return null;
  if (rIdx < 0 || rIdx >= bracket.totalRounds) return null;

  const round: Round | undefined = bracket.rounds[rIdx];
  if (!round) return null;
  if (mIdx < 0 || mIdx >= round.matches.length) return null;

  const match: Match = round.matches[mIdx];
  return { round, match, roundIndex: rIdx, matchIndex: mIdx };
}
