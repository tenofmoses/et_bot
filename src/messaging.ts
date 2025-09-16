// ВСЁ ПРО СООБЩЕНИЯ: отправка/редактирование с ретраями + генерация текстов
import TelegramBot from 'node-telegram-bot-api';
import { Tournament } from './types';

export async function sendMessageWithRetry(
  bot: TelegramBot,
  chatId: number,
  text: string,
  options: any = {},
  maxRetries = 3
): Promise<any> {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const result = await bot.sendMessage(chatId, text, options);
      return result;
    } catch (error: any) {
      if (error.response?.body?.error_code === 429) {
        const retryAfter = error.response?.body?.parameters?.retry_after || 5;
        await new Promise(res => setTimeout(res, retryAfter * 1000));
      } else if (attempt < maxRetries) {
        const delay = Math.pow(2, attempt) * 1000;
        await new Promise(res => setTimeout(res, delay));
      } else {
        throw error;
      }
    }
  }
}

export async function editMessageWithRetry(
  bot: TelegramBot,
  chatId: number,
  messageId: number,
  text: string,
  options: any = {},
  maxRetries = 3
): Promise<any> {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const result = await bot.editMessageText(text, {
        chat_id: chatId,
        message_id: messageId,
        ...options,
      });
      return result;
    } catch (error: any) {
      if (error.response?.body?.description?.includes('message is not modified')) {
        return null;
      }
      if (error.response?.body?.error_code === 429) {
        const retryAfter = error.response?.body?.parameters?.retry_after || 5;
        await new Promise(res => setTimeout(res, retryAfter * 1000));
      } else if (attempt < maxRetries) {
        const delay = Math.pow(2, attempt) * 1000;
        await new Promise(res => setTimeout(res, delay));
      } else {
        throw error;
      }
    }
  }
}

// Красивый текст сетки
export function buildBracketText(tournament: Tournament): string {
  if (!tournament.bracket) return '';
  let txt = '🏆 ТУРНИРНАЯ СЕТКА 🏆\n\n';

  if (tournament.bracket.byePlayer && tournament.bracket.byeRound !== undefined) {
    txt += `🎯 ${tournament.bracket.byePlayer.name} присоединится в раунде ${tournament.bracket.byeRound + 1}\n\n`;
  }

  tournament.bracket.rounds.forEach((round, roundIndex) => {
    txt += `Раунд ${roundIndex + 1}:\n`;
    round.matches.forEach((match) => {
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

// Обновлённый главный текст для «шапки» турнира
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
    if (t.bracket.byePlayer && t.bracket.byeRound !== undefined) {
      msg += `🎯 ${t.bracket.byePlayer.name} присоединится в раунде ${t.bracket.byeRound + 1}\n\n`;
    }
    t.bracket.rounds.forEach((round, roundIndex) => {
      msg += `Раунд ${roundIndex + 1}:\n`;
      round.matches.forEach((match) => {
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
      const cr = t.bracket.rounds[t.currentRound];
      const cm = cr.matches[t.currentMatch];
      msg += `🎯 ТЕКУЩИЙ МАТЧ (Раунд ${t.currentRound + 1}):\n`;
      if (!cm.player2) msg += `${cm.player1.name} (одиночный матч)`;
      else msg += `${cm.player1.name} vs ${cm.player2.name}`;

      if (cm.player1.roll !== undefined || (cm.player2 && cm.player2.roll !== undefined)) {
        msg += '\n\n📊 Результаты:\n';
        if (cm.player1.roll !== undefined) msg += `${cm.player1.name}: ${cm.player1.roll}\n`;
        if (cm.player2 && cm.player2.roll !== undefined) msg += `${cm.player2.name}: ${cm.player2.roll}\n`;
      }
    }
  } else {
    msg += '\n\n🎯 Нажмите кнопку ниже, чтобы присоединиться или выйти!';
  }

  return msg;
}

export async function sendTournamentBracket(bot: TelegramBot, chatId: number, t: Tournament) {
  const text = buildBracketText(t);
  if (!text) return;
  await sendMessageWithRetry(bot, chatId, text, { message_thread_id: t.messageThreadId });
}

// Утилиты для стандартных уведомлений
export async function announceRoundTransition(bot: TelegramBot, chatId: number, t: Tournament) {
  await sendMessageWithRetry(
    bot,
    chatId,
    `🔄 ПЕРЕХОД К РАУНДУ ${t.currentRound! + 1}`,
    { message_thread_id: t.messageThreadId }
  );
}

export async function announceByeJoins(bot: TelegramBot, chatId: number, t: Tournament) {
  await sendMessageWithRetry(
    bot,
    chatId,
    `🎯 Игрок с bye присоединяется к этому раунду`,
    { message_thread_id: t.messageThreadId }
  );
}

export async function announceAutoAdvance(bot: TelegramBot, chatId: number, t: Tournament, playerName: string) {
  await sendMessageWithRetry(
    bot,
    chatId,
    `🎯 ${playerName} проходит дальше (одиночный матч).`,
    { message_thread_id: t.messageThreadId }
  );
}

export async function promptMatch(bot: TelegramBot, chatId: number, t: Tournament, matchNumber: number) {
  const cr = t.currentRound!;
  const cm = t.bracket!.rounds[cr].matches[t.currentMatch!];
  const text = `🎯 МАТЧ ${matchNumber} (Раунд ${cr + 1})\n\n${cm.player1.name} vs ${cm.player2!.name}\n\nВы должны бросить кубик!`;
  const keyboard = { inline_keyboard: [[{ text: '🎲 Кинуть кубик', callback_data: 'throw_dice' }]] };
  await sendMessageWithRetry(bot, chatId, text, {
    reply_markup: keyboard,
    message_thread_id: t.messageThreadId
  });
}
