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
  return typeof e === 'object' && e !== null && ('message' in e || 'response' in e);
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
        const retryAfter = error.response?.body?.parameters?.retry_after ?? 5;
        log(`rate limited: sleep ${retryAfter}s`);
        await new Promise(res => setTimeout(res, retryAfter * 1000));
      } else if (attempt < maxRetries) {
        const delay = Math.pow(2, attempt) * 1000;
        log(`backoff: sleep ${delay}ms`);
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
        const retryAfter = error.response?.body?.parameters?.retry_after ?? 5;
        log(`rate limited: sleep ${retryAfter}s`);
        await new Promise(res => setTimeout(res, retryAfter * 1000));
      } else if (attempt < maxRetries) {
        const delay = Math.pow(2, attempt) * 1000;
        log(`backoff: sleep ${delay}ms`);
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
export function buildTournamentHeader(t: Tournament): string {
  const participantsList =
    t.participants.size > 0
      ? Array.from(t.participantNames.values()).map((name, i) => `${i + 1}. ${name}`).join('\n')
      : '_Пока никого нет_';

  let msg = `🏆 ТУРНИР 🏆\n\n👑 Организатор: ${t.organizerName}`;
  if (t.startTime) msg += `\n⏰ Время начала: ${t.startTime}`;
  msg += `\n\n👥 Участники (${t.participants.size}):\n${participantsList}`;

  if (t.gameState === 'playing' && t.bracket) {
    msg += '\n\n🏆 ТУРНИРНАЯ СЕТКА 🏆\n\n';

    // План/факт «вклеек» bye: если игрок уже определён — показываем имя, иначе «Игрок с bye»
    if (Array.isArray(t.bracket.byeJoinRounds) && t.bracket.byeJoinRounds.length > 0) {
      const byeLines = [...t.bracket.byeJoinRounds]
        .sort((a, b) => a - b)
        .map((joinIdx) => {
          const p = t.bracket!.byePlayersByJoinRound?.get(joinIdx);
          const who = p ? p.name : 'Игрок с bye';
          return `🎯 ${who} присоединится в раунде ${joinIdx + 1}`;
        });
      if (byeLines.length) msg += byeLines.join('\n') + '\n\n';
    }

    t.bracket.rounds.forEach((round: Round, roundIndex: number) => {
      msg += `Раунд ${roundIndex + 1}:\n`;
      round.matches.forEach((match: Match) => {
        const status = match.completed ? '✅' : '⏳';
        if (match.player1.name === 'TBD' || (match.player2 && match.player2.name === 'TBD')) {
          msg += `${status} Ожидание участников\n`;
        } else if (!match.player2) {
          msg += `${status} ${match.player1.name} (одиночный)`;
          if (match.winner) msg += ` → ${match.winner.name}`;
          msg += '\n';
        } else {
          msg += `${status} ${match.player1.name} vs ${match.player2.name}`;
          if (match.winner) msg += ` → ${match.winner.name}`;
          msg += '\n';
        }
      });
      msg += '\n';
    });

    if (t.currentRound !== undefined && t.currentMatch !== undefined) {
      const cur = safeGetCurrentMatch(t);
      if (cur) {
        const { match, roundIndex } = cur;
        msg += `🎯 ТЕКУЩИЙ МАТЧ (Раунд ${roundIndex + 1}):\n`;
        if (!match.player2) msg += `${match.player1.name} (одиночный матч)`;
        else msg += `${match.player1.name} vs ${match.player2.name}`;

        if (match.player1.roll !== undefined || (match.player2 && match.player2.roll !== undefined)) {
          msg += '\n\n📊 Результаты:\n';
          if (match.player1.roll !== undefined) msg += `${match.player1.name}: ${match.player1.roll}\n`;
          if (match.player2 && match.player2.roll !== undefined) msg += `${match.player2.name}: ${match.player2.roll}\n`;
        }
      }
    }
  } else {
    msg += '\n\n🎯 Нажмите кнопку ниже, чтобы присоединиться или выйти!';
  }

  return msg;
}

/** Отправляем сетку отдельным сообщением (если она есть) */
export async function sendTournamentBracket(bot: TelegramBot, chatId: number, t: Tournament) {
  const text = buildBracketText(t);
  if (!text) {
    log('sendTournamentBracket: no bracket text, skip');
    return;
  }
  log('sendTournamentBracket: sending bracket');
  await sendMessageWithRetry(
    bot,
    chatId,
    text,
    { message_thread_id: t.messageThreadId } as TelegramBot.SendMessageOptions
  );
}

/** Служебные уведомления — переход/вклейка/автопроход */
export async function announceRoundTransition(bot: TelegramBot, chatId: number, t: Tournament) {
  log('announceRoundTransition:', { nextRound: (t.currentRound ?? 0) + 1 });
  await sendMessageWithRetry(
    bot,
    chatId,
    `🔄 ПЕРЕХОД К РАУНДУ ${(t.currentRound ?? 0) + 1}`,
    { message_thread_id: t.messageThreadId } as TelegramBot.SendMessageOptions
  );
}

export async function announceByeJoins(bot: TelegramBot, chatId: number, t: Tournament) {
  log('announceByeJoins');
  await sendMessageWithRetry(
    bot,
    chatId,
    `🎯 Игрок с bye присоединяется к этому раунду`,
    { message_thread_id: t.messageThreadId } as TelegramBot.SendMessageOptions
  );
}

export async function announceAutoAdvance(bot: TelegramBot, chatId: number, t: Tournament, playerName: string) {
  log('announceAutoAdvance:', playerName);
  await sendMessageWithRetry(
    bot,
    chatId,
    `🎯 ${playerName} проходит дальше (одиночный матч).`,
    { message_thread_id: t.messageThreadId } as TelegramBot.SendMessageOptions
  );
}

/**
 * Промпт текущего матча: выводит текст и кнопку «Кинуть кубик».
 * Сбрасывает антидубли-флаги и запоминает id сообщения промпта.
 */
export async function promptMatch(bot: TelegramBot, chatId: number, t: Tournament, matchNumber: number) {
  const cur = safeGetCurrentMatch(t);
  if (!cur || !cur.match.player2) {
    log('promptMatch: no current match or single match — skip prompt');
    return;
  }

  // сброс флагов для идемпотентности
  t.matchProcessing = false;
  t.matchFinalized = false;
  t.p1Rolled = false;
  t.p2Rolled = false;
  t.currentPromptMessageId = undefined;

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
      message_thread_id: t.messageThreadId,
    } as TelegramBot.SendMessageOptions
  );

  t.currentPromptMessageId = sent?.message_id;
}

/**
 * Безопасно достаёт текущий раунд/матч из состояния турнира.
 * Возвращает null, если индексы «уехали».
 */
export function safeGetCurrentMatch(
  t: Tournament
): { round: Round; match: Match; roundIndex: number; matchIndex: number } | null {
  const bracket = t.bracket;
  const rIdx = t.currentRound;
  const mIdx = t.currentMatch;
  if (!bracket || rIdx == null || mIdx == null) return null;
  if (rIdx < 0 || rIdx >= bracket.totalRounds) return null;

  const round: Round | undefined = bracket.rounds[rIdx];
  if (!round) return null;
  if (mIdx < 0 || mIdx >= round.matches.length) return null;

  const match: Match = round.matches[mIdx];
  return { round, match, roundIndex: rIdx, matchIndex: mIdx };
}
