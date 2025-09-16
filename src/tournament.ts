import TelegramBot from 'node-telegram-bot-api';
import {
  createTournamentBracket,
  collectWinnersOfRound,
  addByeIfJoiningThisRound,
  applyPlayersToRound,
  isRoundCompleted,
  pickByeConsideringEntrants,
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

/**
 * Сервис управления турниром внутри одного чата.
 * Держит состояние турниров по chatId, реагирует на сообщения и callback-клики,
 * запускает сетку, проводит матчи и объявляет результаты.
 */
export class TournamentService {
  private telegramBot: TelegramBot;
  private activeTournamentsByChatId = new Map<number, Tournament>();

  private hasPlayerOneThrownByChatId = new Map<number, boolean>();
  private hasPlayerTwoThrownByChatId = new Map<number, boolean>();

  constructor(bot: TelegramBot) {
    this.telegramBot = bot;
  }

  onMessage = (message: TelegramBot.Message) => {
    const chatId = message.chat.id;
    const messageText = message.text?.toLowerCase().trim();
    if (messageText === 'турнир') {
      this.startTournament(chatId, message.from, undefined, message.message_thread_id);
    }
  };

  /**
   * Обработчик callback_query от инлайн-кнопок.
   * Управляет регистрацией/выходом, стартом/отменой турнира,
   * а также принимает попытки «бросить кубик».
   */
  onCallback = async (callbackQuery: TelegramBot.CallbackQuery) => {
    const chatId = callbackQuery.message?.chat.id;
    if (!chatId) return;

    const telegramUserId = callbackQuery.from.id;
    const callbackData = callbackQuery.data;
    const displayUserName = callbackQuery.from.username
      ? `@${callbackQuery.from.username}`
      : callbackQuery.from.first_name || 'Неизвестный';

    try {
      switch (callbackData) {
        case 'join_tournament': {
          const tournament = this.activeTournamentsByChatId.get(chatId);
          if (!tournament) {
            return await this.telegramBot.answerCallbackQuery(callbackQuery.id, { text: 'Турнир не найден!' });
          }
          if (tournament.participants.has(telegramUserId)) {
            return await this.telegramBot.answerCallbackQuery(callbackQuery.id, { text: 'Вы уже участвуете в турнире!' });
          }

          tournament.participants.add(telegramUserId);
          tournament.participantNames.set(telegramUserId, displayUserName);
          await this.updateTournamentMessage(chatId);
          return await this.telegramBot.answerCallbackQuery(callbackQuery.id, { text: 'Вы присоединились к турниру!' });
        }

        case 'leave_tournament': {
          const tournament = this.activeTournamentsByChatId.get(chatId);
          if (!tournament || !tournament.participants.has(telegramUserId)) {
            return await this.telegramBot.answerCallbackQuery(callbackQuery.id, { text: 'Вы не участвуете в турнире!' });
          }
          if (tournament.gameState === 'playing') {
            return await this.telegramBot.answerCallbackQuery(callbackQuery.id, { text: 'Нельзя выйти после старта!' });
          }

          tournament.participants.delete(telegramUserId);
          tournament.participantNames.delete(telegramUserId);
          await this.updateTournamentMessage(chatId);
          return await this.telegramBot.answerCallbackQuery(callbackQuery.id, { text: 'Вы вышли из турнира!' });
        }

        case 'cancel_tournament': {
          const tournament = this.activeTournamentsByChatId.get(chatId);
          if (!tournament) {
            return await this.telegramBot.answerCallbackQuery(callbackQuery.id, { text: 'Турнир не найден!' });
          }
          if (tournament.organizerId !== telegramUserId) {
            return await this.telegramBot.answerCallbackQuery(callbackQuery.id, { text: 'Только организатор может отменить турнир!' });
          }

          tournament.gameState = 'cancelled';
          await editMessageWithRetry(this.telegramBot, chatId, tournament.messageId, '🚫 ТУРНИР ОТМЕНЕН\n\nТурнир был отменен.');
          this.activeTournamentsByChatId.delete(chatId);
          return await this.telegramBot.answerCallbackQuery(callbackQuery.id, { text: 'Турнир отменен!' });
        }

        case 'start_game': {
          const tournament = this.activeTournamentsByChatId.get(chatId);
          if (!tournament || tournament.organizerId !== telegramUserId) {
            return await this.telegramBot.answerCallbackQuery(callbackQuery.id, { text: 'Только организатор может начать турнир!' });
          }
          if (tournament.participants.size < 1) {
            return await this.telegramBot.answerCallbackQuery(callbackQuery.id, { text: 'Нужно минимум 1 участник для начала игры!' });
          }

          await this.startTournamentBracket(chatId);
          return await this.telegramBot.answerCallbackQuery(callbackQuery.id, { text: 'Турнир начался!' });
        }

        case 'throw_dice': {
          const wasAccepted = await this.handleDiceThrow(chatId, telegramUserId, displayUserName);
          return await this.telegramBot.answerCallbackQuery(callbackQuery.id, {
            text: wasAccepted ? 'Кубик брошен!' : 'Вы не можете бросить кубик сейчас!',
          });
        }

        default: {
          return await this.telegramBot.answerCallbackQuery(callbackQuery.id, { text: 'Неизвестное действие.' });
        }
      }
    } catch {
      await this.telegramBot.answerCallbackQuery(callbackQuery.id, { text: 'Произошла ошибка!' });
    }
  };


  /**
   * Старт регистрации турнира: публикует шапку с кнопками и создаёт пустое состояние.
   */
  private async startTournament(
    chatId: number,
    telegramUser: TelegramBot.User | undefined,
    startTime?: string,
    messageThreadId?: number
  ) {
    if (!telegramUser) return;
    if (this.activeTournamentsByChatId.has(chatId)) {
      await this.telegramBot.sendMessage(
        chatId,
        ' В этом чате уже идет турнир! Дождитесь его завершения.',
        { message_thread_id: messageThreadId }
      );
      return;
    }

    const initiatorDisplayName = telegramUser.username ? `@${telegramUser.username}` : telegramUser.first_name || 'Неизвестный';
    let tournamentHeaderText = ` ТУРНИР НАЧАЛСЯ! \n\nИнициатор: ${initiatorDisplayName}`;
    if (startTime) tournamentHeaderText += `\n Время начала: ${startTime}`;
    tournamentHeaderText += `\n\n Участники:\n_Пока никого нет_\n\n Нажмите кнопку ниже, чтобы присоединиться!`;

    const inlineKeyboard: TelegramBot.InlineKeyboardMarkup = {
      inline_keyboard: [
        [
          { text: '🎮 Участвую!', callback_data: 'join_tournament' },
          { text: '❌ Выйти', callback_data: 'leave_tournament' },
        ],
        [
          { text: '🎲 Начать игру', callback_data: 'start_game' },
          { text: '🚫 Отменить турнир', callback_data: 'cancel_tournament' },
        ],
      ],
    };

    const headerMessage = await sendMessageWithRetry(this.telegramBot, chatId, tournamentHeaderText, {
      reply_markup: inlineKeyboard,
      message_thread_id: messageThreadId,
    });

    this.activeTournamentsByChatId.set(chatId, {
      messageId: headerMessage.message_id,
      messageThreadId,
      participants: new Set<number>(),
      participantNames: new Map<number, string>(),
      organizerId: telegramUser.id,
      organizerName: initiatorDisplayName,
      gameState: 'registration',
      startTime,
    });
  }

  /**
   * Обновляет «шапку» турнира: текст и состояние инлайн-кнопок в зависимости от стадии.
   */
  private async updateTournamentMessage(chatId: number) {
    const tournament = this.activeTournamentsByChatId.get(chatId);
    if (!tournament) return;

    const inlineButtons: TelegramBot.InlineKeyboardButton[][] = [];
    if (tournament.gameState === 'registration') {
      inlineButtons.push([
        { text: '🎮 Участвую!', callback_data: 'join_tournament' },
        { text: '❌ Выйти', callback_data: 'leave_tournament' },
      ]);
      inlineButtons.push([
        { text: '🎲 Начать игру', callback_data: 'start_game' },
        { text: '🚫 Отменить турнир', callback_data: 'cancel_tournament' },
      ]);
    } else if (tournament.gameState === 'playing' && tournament.bracket && tournament.currentRound !== undefined && tournament.currentMatch !== undefined) {
      const currentMatch = tournament.bracket.rounds[tournament.currentRound].matches[tournament.currentMatch];
      if (!currentMatch.completed && currentMatch.player2) {
        const needPlayerOneRoll = currentMatch.player1.roll === undefined;
        const needPlayerTwoRoll = currentMatch.player2.roll === undefined;
        if (needPlayerOneRoll || needPlayerTwoRoll) {
          inlineButtons.push([{ text: '🎲 Кинуть кубик', callback_data: 'throw_dice' }]);
        }
      }
    }

    const inlineKeyboard: TelegramBot.InlineKeyboardMarkup = { inline_keyboard: inlineButtons };
    await editMessageWithRetry(this.telegramBot, chatId, tournament.messageId, buildTournamentHeader(tournament), { reply_markup: inlineKeyboard });
  }

  /**
   * Запускает турнирную сетку: создаёт пары на 1-й раунд и переходит к первому матчу.
   */
  private async startTournamentBracket(chatId: number) {
    const tournament = this.activeTournamentsByChatId.get(chatId);
    if (!tournament) return;

    tournament.bracket = createTournamentBracket(tournament.participantNames);
    tournament.currentRound = 0;
    tournament.currentMatch = 0;
    tournament.gameState = 'playing';

    await this.updateTournamentMessage(chatId);
    await this.startNextMatch(chatId);
  }

  /**
   * Переходит к следующему незавершённому матчу или к следующему раунду.
   * Обрабатывает одиночные матчи (автопроход) и завершение турнира.
   */
  private async startNextMatch(chatId: number): Promise<void> {
    const tournament = this.activeTournamentsByChatId.get(chatId);
    if (!tournament || !tournament.bracket) return;

    // Очистим флаги «нажал кнопку броска» для нового матча
    this.clearCurrentMatchDiceFlags(chatId);

    const currentRound = tournament.bracket.rounds[tournament.currentRound!];
    const currentMatch = currentRound.matches[tournament.currentMatch!];

    // Если текущий индекс указывает не на активный матч — сдвигаем указатель
    if (!currentMatch || currentMatch.completed) {
      tournament.currentMatch! += 1;

      // Дошли до конца раунда
      if (tournament.currentMatch! >= currentRound.matches.length) {
        // Если есть незакрытые матчи — прыгаем на первый незакрытый
        if (!isRoundCompleted(currentRound)) {
          const firstIncompleteIndex = currentRound.matches.findIndex(m => !m.completed);
          if (firstIncompleteIndex !== -1) {
            tournament.currentMatch = firstIncompleteIndex;
            return this.startNextMatch(chatId);
          }
          return;
        }

        // Раунд закрыт — двигаемся дальше
        tournament.currentRound! += 1;
        tournament.currentMatch = 0;

        // Турнир завершён
        if (tournament.currentRound! >= tournament.bracket.totalRounds) {
          return this.finishTournament(chatId);
        }

        // Переносим победителей в следующий раунд
        await this.advanceWinnersToNextRound(chatId);
        return;
      }

      // Рекурсивный шаг на следующий матч
      return this.startNextMatch(chatId);
    }

    // Одиночный матч → автопобеда
    if (!currentMatch.player2) {
      currentMatch.winner = currentMatch.player1;
      currentMatch.completed = true;

      await announceAutoAdvance(this.telegramBot, chatId, tournament, currentMatch.player1.name);
      await this.updateTournamentMessage(chatId);
      setTimeout(() => this.startNextMatch(chatId), 600);
      return;
    }

    // Нормальный матч — публикуем промпт с кнопкой «Кинуть кубик»
    await promptMatch(this.telegramBot, chatId, tournament, tournament.currentMatch! + 1);
  }

  /**
   * Принимает клик «Кинуть кубик».
   * Делает клик идемпотентным для того же участника: флаг ставится до await.
   * Отправляет анимацию кубика, записывает значение и либо ждёт второго броска, либо завершает матч.
   */
  private async handleDiceThrow(chatId: number, telegramUserId: number, displayUserName: string): Promise<boolean> {
    const tournament = this.activeTournamentsByChatId.get(chatId);
    if (!tournament || !tournament.bracket) return false;

    const currentRound = tournament.bracket.rounds[tournament.currentRound!];
    const currentMatch = currentRound.matches[tournament.currentMatch!];

    if (!currentMatch.player2) return false;
    if (currentMatch.completed) return false;

    const isPlayerOne = currentMatch.player1.id === telegramUserId;
    const isPlayerTwo = currentMatch.player2.id === telegramUserId;
    if (!isPlayerOne && !isPlayerTwo) return false;

    // Игрок уже нажимал кнопку в этом матче — отклоняем повторный клик
    if (isPlayerOne && this.hasPlayerOneThrownByChatId.get(chatId)) return false;
    if (isPlayerTwo && this.hasPlayerTwoThrownByChatId.get(chatId)) return false;

    // Перестраховка, если значение уже записано
    if ((isPlayerOne && currentMatch.player1.roll !== undefined) ||
      (isPlayerTwo && currentMatch.player2!.roll !== undefined)) {
      return false;
    }

    // Ставим флаг до любых await — это и блокирует второй клик того же игрока
    if (isPlayerOne) this.hasPlayerOneThrownByChatId.set(chatId, true);
    else this.hasPlayerTwoThrownByChatId.set(chatId, true);

    try {
      await this.telegramBot.sendMessage(chatId, `🎲 ${displayUserName} кидает кубик...`, { message_thread_id: tournament.messageThreadId });
      const diceMessage = await this.telegramBot.sendDice(chatId, { emoji: '🎲', message_thread_id: tournament.messageThreadId });

      // По факту Telegram отдаёт значение кубика с задержкой — читаем через таймер для эффекта
      setTimeout(async () => {
        try {
          const diceValue = diceMessage.dice?.value ?? (Math.floor(Math.random() * 6) + 1);
          if (isPlayerOne) currentMatch.player1.roll = diceValue;
          else currentMatch.player2!.roll = diceValue;

          const bothPlayersRolled = currentMatch.player1.roll !== undefined && currentMatch.player2!.roll !== undefined;

          if (bothPlayersRolled) {
            await this.resolveMatch(chatId);
          } else {
            await this.updateTournamentMessage(chatId);
          }
        } catch {
          // Ошибки в этом окне не откатывают флаг — иначе можно «накликать» повторный бросок.
        }
      }, 4000);

      return true;
    } catch {
      // Если вообще не смогли отправить сообщение/кубик — откатываем флаг, чтобы игрок мог повторить
      if (isPlayerOne) this.hasPlayerOneThrownByChatId.delete(chatId);
      else this.hasPlayerTwoThrownByChatId.delete(chatId);
      return false;
    }
  }

  /**
   * Завершает матч, когда есть оба броска.
   * Обрабатывает ничью (сброс и переигровка) или объявляет победителя и двигается дальше.
   */
  private async resolveMatch(chatId: number) {
    const tournament = this.activeTournamentsByChatId.get(chatId);
    if (!tournament || !tournament.bracket) return;

    const currentRound = tournament.bracket.rounds[tournament.currentRound!];
    const currentMatch = currentRound.matches[tournament.currentMatch!];

    const playerOneRoll = currentMatch.player1.roll!;
    const playerTwoRoll = currentMatch.player2!.roll!;

    if (playerOneRoll === playerTwoRoll) {
      await this.telegramBot.sendMessage(
        chatId,
        `🤝 НИЧЬЯ! (${playerOneRoll} - ${playerTwoRoll})\n\n🔄 Начинаем раунд заново!`,
        { message_thread_id: tournament.messageThreadId }
      );
      currentMatch.player1.roll = undefined;
      currentMatch.player2!.roll = undefined;

      // Снова разрешаем броски обеим участницам
      this.clearCurrentMatchDiceFlags(chatId);

      await promptMatch(this.telegramBot, chatId, tournament, tournament.currentMatch! + 1);
      return;
    }

    currentMatch.winner = playerOneRoll > playerTwoRoll ? currentMatch.player1 : currentMatch.player2!;
    currentMatch.completed = true;

    await sendMessageWithRetry(
      this.telegramBot,
      chatId,
      `🏆 ПОБЕДИТЕЛЬ МАТЧА: ${currentMatch.winner.name}!\n\n${currentMatch.player1.name}: ${playerOneRoll}\n${currentMatch.player2!.name}: ${playerTwoRoll}`,
      { message_thread_id: tournament.messageThreadId }
    );

    // Матч завершён — очищаем флаги
    this.clearCurrentMatchDiceFlags(chatId);

    setTimeout(() => this.startNextMatch(chatId), 800);
  }

  /**
   * Сбрасывает флаги «эти две участницы уже нажимали кнопку» для текущего чата.
   * Вызывается при старте каждого нового матча и после завершения/ничьей.
   */
  private clearCurrentMatchDiceFlags(chatId: number): void {
    this.hasPlayerOneThrownByChatId.delete(chatId);
    this.hasPlayerTwoThrownByChatId.delete(chatId);
  }

  /**
   * Переносит победителей из предыдущего раунда в текущий.
   * При необходимости выбирает bye-игрока и «вклеивает» его в нужный раунд,
   * а затем публикует обновлённую сетку и двигается к следующему матчу.
   */
  private async advanceWinnersToNextRound(chatId: number) {
    const tournament = this.activeTournamentsByChatId.get(chatId);
    if (!tournament || !tournament.bracket) return;

    // Если уже вышли за последний раунд — завершаем турнир
    if (tournament.currentRound! >= tournament.bracket.totalRounds) {
      return this.finishTournament(chatId);
    }

    const previousRound = tournament.bracket.rounds[tournament.currentRound! - 1];
    const currentRound = tournament.bracket.rounds[tournament.currentRound!];
    const currentRoundIndex = tournament.currentRound!;

    // 1) Победитель прошедшего раунда
    const winners = collectWinnersOfRound(previousRound);

    // 2) Сначала присоединяем тех, кому «вклейка» запланирована именно в ЭТОТ раунд
    const entrantsAfterJoin = addByeIfJoiningThisRound(
      winners,
      tournament.bracket,
      currentRoundIndex
    );

    // 3) Если входящих нечётно и на следующий раунд запланирована «вклейка» —
    // снимаем одного участника в bye на следующий раунд
    const { playersToPlace, byePicked, joinRoundIndex } = pickByeConsideringEntrants(
      entrantsAfterJoin,
      tournament.bracket,
      currentRoundIndex
    );
    if (byePicked !== undefined && joinRoundIndex !== undefined) {
      tournament.bracket.byePlayersByJoinRound.set(joinRoundIndex, byePicked);
    }

    await announceRoundTransition(this.telegramBot, chatId, tournament);

    // Сообщаем о «вклейке», если в этот раунд действительно кто-то присоединился
    if (tournament.bracket.byePlayersByJoinRound.has(currentRoundIndex)) {
      await announceByeJoins(this.telegramBot, chatId, tournament);
    }

    // 4) Раскладываем игроков по матчам текущего раунда
    applyPlayersToRound(currentRound, playersToPlace);

    await sendTournamentBracket(this.telegramBot, chatId, tournament);
    await this.updateTournamentMessage(chatId);
    setTimeout(() => this.startNextMatch(chatId), 600);
  }

  /**
   * Завершает турнир: объявляет чемпиона, выводит финальную таблицу
   * и очищает состояние турнира для данного чата.
   */
  private async finishTournament(chatId: number) {
    const tournament = this.activeTournamentsByChatId.get(chatId);
    if (!tournament || !tournament.bracket) return;

    const { rounds, totalRounds, byePlayersByJoinRound } = tournament.bracket;

    const finalRound = rounds[totalRounds - 1];
    const finalMatch = finalRound.matches[0];
    const championPlayer = finalMatch.winner ?? finalMatch.player1;

    tournament.gameState = 'finished';
    await this.updateTournamentMessage(chatId);

    let resultsText = `🎉 ТУРНИР ЗАВЕРШЕН! 🎉\n\n👑 ЧЕМПИОН: ${championPlayer.name}! 👑\n\n`;
    resultsText += '🏆 ФИНАЛЬНАЯ ТУРНИРНАЯ ТАБЛИЦА 🏆\n\n';

    // Выведем все фактически состоявшиеся «вклейки» bye в порядке номеров раундов
    if (byePlayersByJoinRound && byePlayersByJoinRound.size > 0) {
      const byeLines = Array.from(byePlayersByJoinRound.entries())
        .sort(([a], [b]) => a - b)
        .map(([joinRoundIndex, player]) => `🎯 ${player.name} присоединился в раунде ${joinRoundIndex + 1}`);
      resultsText += byeLines.join('\n') + '\n\n';
    }

    resultsText += rounds
      .map((round, roundIndex) => {
        const lines = round.matches.map(match => {
          const status = '✅';
          if (match.player1.name === 'TBD' || (match.player2 && match.player2.name === 'TBD')) {
            return `${status} Ожидание участников`;
          }
          if (!match.player2) {
            return `${status} ${match.player1.name} (одиночный)` + (match.winner ? ` → 🏆 ${match.winner.name}` : '');
          }
          return `${status} ${match.player1.name} vs ${match.player2.name}` + (match.winner ? ` → 🏆 ${match.winner.name}` : '');
        });
        return `Раунд ${roundIndex + 1}:\n${lines.join('\n')}`;
      })
      .join('\n\n');

    await this.telegramBot.sendMessage(chatId, resultsText, { message_thread_id: tournament.messageThreadId });

    setTimeout(() => {
      this.activeTournamentsByChatId.delete(chatId);
    }, 800);
  }

}
