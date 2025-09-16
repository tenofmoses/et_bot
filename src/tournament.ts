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
  private static readonly DICE_ANIMATION_MS = 3500;
  private static readonly NEXT_MATCH_DELAY_MS = 1000;
  private static readonly AFTER_RESULT_DELAY_MS = 1000;
  private static readonly UPDATE_THROTTLE_MS = 900; // на практике 600–1200мс оптимально
  private pendingHeaderEditTimerByChatId = new Map<number, ReturnType<typeof setTimeout>>();

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
          await this.updateTournamentMessageThrottled(chatId);
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
          await this.updateTournamentMessageThrottled(chatId);
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
  private async updateTournamentMessageImmediate(chatId: number) {
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
    } else if (
      tournament.gameState === 'playing' &&
      tournament.bracket &&
      tournament.currentRound !== undefined &&
      tournament.currentMatch !== undefined
    ) {
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
    await editMessageWithRetry(
      this.telegramBot,
      chatId,
      tournament.messageId,
      buildTournamentHeader(tournament),
      { reply_markup: inlineKeyboard }
    );
  }

  private updateTournamentMessageThrottled(chatId: number): void {
    const existing = this.pendingHeaderEditTimerByChatId.get(chatId);
    if (existing) clearTimeout(existing);

    const timer = setTimeout(() => {
      this.pendingHeaderEditTimerByChatId.delete(chatId);
      // fire-and-forget: нам не важно ждать завершения UI-апдейта
      this.updateTournamentMessageImmediate(chatId).catch(() => { });
    }, TournamentService.UPDATE_THROTTLE_MS);

    this.pendingHeaderEditTimerByChatId.set(chatId, timer);
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

    await this.updateTournamentMessageThrottled(chatId);
    await this.startNextMatch(chatId);
  }

  /**
   * Переходит к следующему незавершённому матчу или к следующему раунду.
   * Обрабатывает одиночные матчи (автопроход) и завершение турнира.
   */
  private async startNextMatch(chatId: number): Promise<void> {
    const tournament = this.activeTournamentsByChatId.get(chatId);
    if (!tournament || !tournament.bracket) return;
    tournament.matchFinalized = false;

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
      await this.updateTournamentMessageThrottled(chatId);
      setTimeout(() => this.startNextMatch(chatId), TournamentService.NEXT_MATCH_DELAY_MS);
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

    const roundIdxAtClick = tournament.currentRound!;
    const matchIdxAtClick = tournament.currentMatch!;
    const currentRound = tournament.bracket.rounds[roundIdxAtClick];
    const currentMatch = currentRound?.matches[matchIdxAtClick];
    if (!currentMatch) return false;

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

    // Ставим флаг до await — блокируем двойной клик одного игрока
    if (isPlayerOne) this.hasPlayerOneThrownByChatId.set(chatId, true);
    else this.hasPlayerTwoThrownByChatId.set(chatId, true);

    try {
      await this.telegramBot.sendMessage(chatId, `🎲 ${displayUserName} кидает кубик...`, { message_thread_id: tournament.messageThreadId });
      const diceMessage = await this.telegramBot.sendDice(chatId, { emoji: '🎲', message_thread_id: tournament.messageThreadId });

      // По факту Telegram отдаёт значение кубика с задержкой — читаем через таймер для эффекта
      setTimeout(async () => {
        try {
          // Если матч уже сменился/закрылся — игнорируем просроченный таймер
          const t = this.activeTournamentsByChatId.get(chatId);
          if (!t || !t.bracket) return;
          if (t.currentRound !== roundIdxAtClick || t.currentMatch !== matchIdxAtClick) return;

          const roundNow = t.bracket.rounds[roundIdxAtClick];
          const matchNow = roundNow?.matches[matchIdxAtClick];
          if (!matchNow || matchNow.completed) return;

          const diceValue = diceMessage.dice?.value ?? (Math.floor(Math.random() * 6) + 1);
          if (isPlayerOne) matchNow.player1.roll = diceValue;
          else matchNow.player2!.roll = diceValue;

          const bothPlayersRolled = matchNow.player1.roll !== undefined && matchNow.player2!.roll !== undefined;
          if (bothPlayersRolled) {
            await this.tryResolveCurrentMatch(chatId, roundIdxAtClick, matchIdxAtClick);
          } else {
            await this.updateTournamentMessageThrottled(chatId);
          }
        } catch {
          // Ошибки в таймере игнорируем — флаги не откатываем, чтобы не было двойных бросков.
        }
      }, TournamentService.DICE_ANIMATION_MS);

      return true;
    } catch {
      // Если не отправили — откатываем флаг, чтобы игрок мог повторить
      if (isPlayerOne) this.hasPlayerOneThrownByChatId.delete(chatId);
      else this.hasPlayerTwoThrownByChatId.delete(chatId);
      return false;
    }
  }

  /**
   * Завершает матч, когда есть оба броска.
   * Обрабатывает ничью (сброс и переигровка) или объявляет победителя и двигается дальше.
   */
  private async tryResolveCurrentMatch(chatId: number, roundIdx: number, matchIdx: number) {
    const tournament = this.activeTournamentsByChatId.get(chatId);
    if (!tournament || !tournament.bracket) return;

    // Проверяем, что речь всё ещё о том же матче
    if (tournament.currentRound !== roundIdx || tournament.currentMatch !== matchIdx) return;

    const round = tournament.bracket.rounds[roundIdx];
    const match = round.matches[matchIdx];

    // Уже финализирован кем-то ещё? — выходим
    if (tournament.matchFinalized || match.completed) return;

    // «Замок» на время подведения итогов
    tournament.matchFinalized = true;

    try {
      const r1 = match.player1.roll;
      const r2 = match.player2?.roll;
      if (r1 === undefined || r2 === undefined) {
        // Не оба бросили — снимаем «замок», ждём
        tournament.matchFinalized = false;
        return;
      }

      if (r1 === r2) {
        await this.telegramBot.sendMessage(
          chatId,
          `🤝 НИЧЬЯ! (${r1} - ${r2})\n\n🔄 Бросаем заново!`,
          { message_thread_id: tournament.messageThreadId }
        );

        // Сброс значений и флагов — разрешаем снова кликать
        match.player1.roll = undefined;
        match.player2!.roll = undefined;
        this.clearCurrentMatchDiceFlags(chatId);

        // Этот матч ещё НЕ финализирован (повторная попытка)
        tournament.matchFinalized = false;

        await promptMatch(this.telegramBot, chatId, tournament, matchIdx + 1);
        return;
      }

      match.winner = r1 > r2 ? match.player1 : match.player2!;
      match.completed = true;

      await sendMessageWithRetry(
        this.telegramBot,
        chatId,
        `🏆 ПОБЕДИТЕЛЬ МАТЧА: ${match.winner.name}!\n\n${match.player1.name}: ${r1}\n${match.player2!.name}: ${r2}`,
        { message_thread_id: tournament.messageThreadId }
      );

      this.clearCurrentMatchDiceFlags(chatId);

      setTimeout(() => this.startNextMatch(chatId), TournamentService.AFTER_RESULT_DELAY_MS);
    } finally {
      // На случай исключений не оставляем вечный «замок»,
      // но если матч завершён — это уже не важно.
      if (!match.completed) {
        tournament.matchFinalized = false;
      }
    }
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
    await this.updateTournamentMessageThrottled(chatId);
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
    await this.updateTournamentMessageThrottled(chatId);

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
