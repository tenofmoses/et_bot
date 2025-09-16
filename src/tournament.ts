import TelegramBot from 'node-telegram-bot-api';
import {
  createTournamentBracket,
  collectWinnersOfRound,
  pickByeIfNeeded,
  addByeIfJoiningThisRound,
  applyPlayersToRound,
  isRoundCompleted,
} from './bracket';

import {
  sendMessageWithRetry,
  editMessageWithRetry,
  buildTournamentHeader,
  sendTournamentBracket,
  announceRoundTransition,
  announceByeJoins,
  announceAutoAdvance,
  promptMatch,
} from './messaging';

import { Tournament } from './types';

export class TournamentService {
  private bot: TelegramBot;
  private activeTournaments = new Map<number, Tournament>();

  constructor(bot: TelegramBot) {
    this.bot = bot;
  }

  onMessage = (msg: TelegramBot.Message) => {
    const chatId = msg.chat.id;
    const text = msg.text?.toLowerCase().trim();
    if (text === 'турнир') {
      this.startTournament(chatId, msg.from, undefined, msg.message_thread_id);
    }
  };

  onCallback = async (cb: TelegramBot.CallbackQuery) => {
    const chatId = cb.message?.chat.id;
    if (!chatId) return;

    const userId = cb.from.id;
    const data = cb.data;
    const userName = cb.from.username ? `@${cb.from.username}` : cb.from.first_name || 'Неизвестный';

    try {
      if (data === 'join_tournament') {
        const t = this.activeTournaments.get(chatId);
        if (!t) return await this.bot.answerCallbackQuery(cb.id, { text: 'Турнир не найден!' });
        if (t.participants.has(userId)) return await this.bot.answerCallbackQuery(cb.id, { text: 'Вы уже участвуете в турнире!' });

        t.participants.add(userId);
        t.participantNames.set(userId, userName);
        await this.updateTournamentMessage(chatId);
        await this.bot.answerCallbackQuery(cb.id, { text: 'Вы присоединились к турниру!' });

      } else if (data === 'leave_tournament') {
        const t = this.activeTournaments.get(chatId);
        if (!t || !t.participants.has(userId)) return await this.bot.answerCallbackQuery(cb.id, { text: 'Вы не участвуете в турнире!' });
        if (t.gameState === 'playing') return await this.bot.answerCallbackQuery(cb.id, { text: 'Нельзя выйти после старта!' });

        t.participants.delete(userId);
        t.participantNames.delete(userId);
        await this.updateTournamentMessage(chatId);
        await this.bot.answerCallbackQuery(cb.id, { text: 'Вы вышли из турнира!' });

      } else if (data === 'cancel_tournament') {
        const t = this.activeTournaments.get(chatId);
        if (!t) return await this.bot.answerCallbackQuery(cb.id, { text: 'Турнир не найден!' });
        if (t.organizerId !== userId) return await this.bot.answerCallbackQuery(cb.id, { text: 'Только организатор может отменить турнир!' });

        t.gameState = 'cancelled';
        await editMessageWithRetry(this.bot, chatId, t.messageId, '🚫 ТУРНИР ОТМЕНЕН\n\nТурнир был отменен.');
        this.activeTournaments.delete(chatId);
        await this.bot.answerCallbackQuery(cb.id, { text: 'Турнир отменен!' });

      } else if (data === 'start_game') {
        const t = this.activeTournaments.get(chatId);
        if (!t || t.organizerId !== userId) return await this.bot.answerCallbackQuery(cb.id, { text: 'Только организатор может начать турнир!' });
        if (t.participants.size < 1) return await this.bot.answerCallbackQuery(cb.id, { text: 'Нужно минимум 1 участник для начала игры!' });

        await this.startTournamentBracket(chatId);
        await this.bot.answerCallbackQuery(cb.id, { text: 'Турнир начался!' });

      } else if (data === 'throw_dice') {
        const ok = await this.handleDiceThrow(chatId, userId, userName);
        await this.bot.answerCallbackQuery(cb.id, { text: ok ? 'Кубик брошен!' : 'Вы не можете бросить кубик сейчас!' });
      }
    } catch {
      await this.bot.answerCallbackQuery(cb.id, { text: 'Произошла ошибка!' });
    }
  };

  private async startTournament(
    chatId: number,
    initiator: TelegramBot.User | undefined,
    startTime?: string,
    messageThreadId?: number
  ) {
    if (!initiator) return;
    if (this.activeTournaments.has(chatId)) {
      await this.bot.sendMessage(chatId, ' В этом чате уже идет турнир! Дождитесь его завершения.', { message_thread_id: messageThreadId });
      return;
    }

    const initiatorName = initiator.username ? `@${initiator.username}` : initiator.first_name || 'Неизвестный';
    let tournamentMessage = ` ТУРНИР НАЧАЛСЯ! \n\nИнициатор: ${initiatorName}`;
    if (startTime) tournamentMessage += `\n Время начала: ${startTime}`;
    tournamentMessage += `\n\n Участники:\n_Пока никого нет_\n\n Нажмите кнопку ниже, чтобы присоединиться!`;

    const keyboard = {
      inline_keyboard: [
        [{ text: ' Участвую!', callback_data: 'join_tournament' }, { text: ' Выйти', callback_data: 'leave_tournament' }],
        [{ text: ' Начать игру', callback_data: 'start_game' }, { text: ' Отменить турнир', callback_data: 'cancel_tournament' }],
      ],
    };

    const sentMessage = await sendMessageWithRetry(this.bot, chatId, tournamentMessage, {
      reply_markup: keyboard,
      message_thread_id: messageThreadId,
    });

    this.activeTournaments.set(chatId, {
      messageId: sentMessage.message_id,
      messageThreadId,
      participants: new Set<number>(),
      participantNames: new Map<number, string>(),
      organizerId: initiator.id,
      organizerName: initiatorName,
      gameState: 'registration',
      startTime,
    });
  }

  private async updateTournamentMessage(chatId: number) {
    const t = this.activeTournaments.get(chatId);
    if (!t) return;

    const buttons: any[] = [];
    if (t.gameState === 'registration') {
      buttons.push([
        { text: '🎮 Участвую!', callback_data: 'join_tournament' },
        { text: '❌ Выйти', callback_data: 'leave_tournament' },
      ]);
      buttons.push([
        { text: '🎲 Начать игру', callback_data: 'start_game' },
        { text: '🚫 Отменить турнир', callback_data: 'cancel_tournament' },
      ]);
    } else if (t.gameState === 'playing' && t.bracket && t.currentRound !== undefined && t.currentMatch !== undefined) {
      const currentMatch = t.bracket.rounds[t.currentRound].matches[t.currentMatch];
      if (!currentMatch.completed && currentMatch.player2) {
        const needP1 = currentMatch.player1.roll === undefined;
        const needP2 = currentMatch.player2.roll === undefined;
        if (needP1 || needP2) {
          buttons.push([{ text: '🎲 Кинуть кубик', callback_data: 'throw_dice' }]);
        }
      }
    }

    const keyboard = { inline_keyboard: buttons };
    await editMessageWithRetry(this.bot, chatId, t.messageId, buildTournamentHeader(t), { reply_markup: keyboard });
  }

  private async startTournamentBracket(chatId: number) {
    const t = this.activeTournaments.get(chatId);
    if (!t) return;

    t.bracket = createTournamentBracket(t.participantNames);
    t.currentRound = 0;
    t.currentMatch = 0;
    t.gameState = 'playing';

    await this.updateTournamentMessage(chatId);
    await this.startNextMatch(chatId);
  }

  private async startNextMatch(chatId: number): Promise<void> {
    const t = this.activeTournaments.get(chatId);
    if (!t || !t.bracket) return;

    const currentRound = t.bracket.rounds[t.currentRound!];
    const currentMatch = currentRound.matches[t.currentMatch!];

    if (!currentMatch || currentMatch.completed) {
      t.currentMatch! += 1;

      if (t.currentMatch! >= currentRound.matches.length) {
        if (!isRoundCompleted(currentRound)) {
          const idx = currentRound.matches.findIndex(m => !m.completed);
          if (idx !== -1) {
            t.currentMatch = idx;
            return this.startNextMatch(chatId);
          }
          return;
        }

        t.currentRound! += 1;
        t.currentMatch = 0;

        if (t.currentRound! >= t.bracket.totalRounds) {
          return this.finishTournament(chatId);
        }

        await this.advanceWinnersToNextRound(chatId);
        return;
      }

      return this.startNextMatch(chatId);
    }

    if (!currentMatch.player2) {
      currentMatch.winner = currentMatch.player1;
      currentMatch.completed = true;

      await announceAutoAdvance(this.bot, chatId, t, currentMatch.player1.name);
      await this.updateTournamentMessage(chatId);
      setTimeout(() => this.startNextMatch(chatId), 600);
      return;
    }

    await promptMatch(this.bot, chatId, t, t.currentMatch! + 1);
  }

  private async handleDiceThrow(chatId: number, userId: number, userName: string): Promise<boolean> {
    const t = this.activeTournaments.get(chatId);
    if (!t || !t.bracket) return false;

    const currentRound = t.bracket.rounds[t.currentRound!];
    const currentMatch = currentRound.matches[t.currentMatch!];

    if (!currentMatch.player2) return false;
    if (currentMatch.player1.id !== userId && currentMatch.player2.id !== userId) return false;

    if (
      (currentMatch.player1.id === userId && currentMatch.player1.roll !== undefined) ||
      (currentMatch.player2.id === userId && currentMatch.player2.roll !== undefined)
    ) return false;

    await this.bot.sendMessage(chatId, `🎲 ${userName} кидает кубик...`, { message_thread_id: t.messageThreadId });
    const diceMessage = await this.bot.sendDice(chatId, { emoji: '🎲', message_thread_id: t.messageThreadId });

    setTimeout(async () => {
      try {
        const roll = diceMessage.dice?.value || Math.floor(Math.random() * 6) + 1;
        if (currentMatch.player1.id === userId) currentMatch.player1.roll = roll;
        else currentMatch.player2!.roll = roll;

        if (currentMatch.player1.roll !== undefined && currentMatch.player2!.roll !== undefined) {
          await this.resolveMatch(chatId);
        } else {
          await this.updateTournamentMessage(chatId);
        }
      } catch { }
    }, 4000);

    return true;
  }

  private async resolveMatch(chatId: number) {
    const t = this.activeTournaments.get(chatId);
    if (!t || !t.bracket) return;

    const currentRound = t.bracket.rounds[t.currentRound!];
    const currentMatch = currentRound.matches[t.currentMatch!];

    const roll1 = currentMatch.player1.roll!;
    const roll2 = currentMatch.player2!.roll!;

    if (roll1 === roll2) {
      await this.bot.sendMessage(
        chatId,
        `🤝 НИЧЬЯ! (${roll1} - ${roll2})\n\n🔄 Начинаем раунд заново!`,
        { message_thread_id: t.messageThreadId }
      );
      currentMatch.player1.roll = undefined;
      currentMatch.player2!.roll = undefined;
      await promptMatch(this.bot, chatId, t, t.currentMatch! + 1);
      return;
    }

    currentMatch.winner = roll1 > roll2 ? currentMatch.player1 : currentMatch.player2!;
    currentMatch.completed = true;

    await sendMessageWithRetry(
      this.bot,
      chatId,
      `🏆 ПОБЕДИТЕЛЬ МАТЧА: ${currentMatch.winner.name}!\n\n${currentMatch.player1.name}: ${roll1}\n${currentMatch.player2!.name}: ${roll2}`,
      { message_thread_id: t.messageThreadId }
    );

    setTimeout(() => this.startNextMatch(chatId), 800);
  }

  private async advanceWinnersToNextRound(chatId: number) {
    const t = this.activeTournaments.get(chatId);
    if (!t || !t.bracket) return;

    if (t.currentRound! >= t.bracket.totalRounds) {
      return this.finishTournament(chatId);
    }

    const prevRound = t.bracket.rounds[t.currentRound! - 1];
    const currentRound = t.bracket.rounds[t.currentRound!];

    const winners = collectWinnersOfRound(prevRound);
    const picked = pickByeIfNeeded(winners, t.bracket, t.currentRound!);
    if (picked.byePicked) t.bracket.byePlayer = picked.byePicked;

    let playersToPlace = addByeIfJoiningThisRound(picked.playersToPlace, t.bracket, t.currentRound!);

    await announceRoundTransition(this.bot, chatId, t);
    if (t.bracket.byeRound !== undefined && t.currentRound! === t.bracket.byeRound && t.bracket.byePlayer) {
      await announceByeJoins(this.bot, chatId, t);
    }

    applyPlayersToRound(currentRound, playersToPlace);

    await sendTournamentBracket(this.bot, chatId, t);
    await this.updateTournamentMessage(chatId);
    setTimeout(() => this.startNextMatch(chatId), 600);
  }

  private async finishTournament(chatId: number) {
    const t = this.activeTournaments.get(chatId);
    if (!t || !t.bracket) return;

    const finalRound = t.bracket.rounds[t.bracket.totalRounds - 1];
    const finalMatch = finalRound.matches[0];
    const champion = finalMatch.winner ?? finalMatch.player1;

    t.gameState = 'finished';
    await this.updateTournamentMessage(chatId);

    let results = `🎉 ТУРНИР ЗАВЕРШЕН! 🎉\n\n👑 ЧЕМПИОН: ${champion.name}! 👑\n\n`;
    results += '🏆 ФИНАЛЬНАЯ ТУРНИРНАЯ ТАБЛИЦА 🏆\n\n';
    if (t.bracket.byePlayer && t.bracket.byeRound !== undefined) {
      results += `🎯 ${t.bracket.byePlayer.name} присоединился в раунде ${t.bracket.byeRound + 1}\n\n`;
    }
    results += t.bracket.rounds
      .map((round, i) => {
        const lines = round.matches.map(m => {
          const status = '✅';
          if (m.player1.name === 'TBD' || (m.player2 && m.player2.name === 'TBD')) return `${status} Ожидание участников`;
          if (!m.player2) return `${status} ${m.player1.name} (одиночный)` + (m.winner ? ` → 🏆 ${m.winner.name}` : '');
          return `${status} ${m.player1.name} vs ${m.player2.name}` + (m.winner ? ` → 🏆 ${m.winner.name}` : '');
        });
        return `Раунд ${i + 1}:\n${lines.join('\n')}`;
      })
      .join('\n\n');

    await this.bot.sendMessage(chatId, results, { message_thread_id: t.messageThreadId });

    setTimeout(() => {
      this.activeTournaments.delete(chatId);
    }, 800);
  }
}
