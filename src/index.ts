import TelegramBot from 'node-telegram-bot-api';
import * as dotenv from 'dotenv';

// Load environment variables
dotenv.config();

const token = process.env.TELEGRAM_BOT_TOKEN;

if (!token) {
    console.error('TELEGRAM_BOT_TOKEN is not set in environment variables');
    process.exit(1);
}

// Create a bot that uses 'polling' to fetch new updates
const bot = new TelegramBot(token, { polling: true });

// Store active tournaments by chat ID
interface Tournament {
    messageId: number;
    participants: Set<number>;
    participantNames: Map<number, string>;
    bracket?: TournamentBracket;
    currentRound?: number;
    currentMatch?: number;
    gameState?: 'registration' | 'playing' | 'finished';
}

interface TournamentBracket {
    rounds: Round[];
    totalRounds: number;
}

interface Round {
    matches: Match[];
}

interface Match {
    player1: { id: number; name: string; roll?: number };
    player2: { id: number; name: string; roll?: number };
    winner?: { id: number; name: string };
    completed: boolean;
}

const activeTournaments = new Map<number, Tournament>();

console.log('🎲 Dice Bot started successfully!');

// Listen for any kind of message
bot.on('message', (msg) => {
    const chatId = msg.chat.id;
    const messageText = msg.text;

    console.log(`Received message from ${msg.from?.username || msg.from?.first_name}: ${messageText}`);

    // Handle /start command
    if (messageText === '/start') {
        const welcomeText = msg.chat.type === 'private' 
            ? '🎲 Привет! Я бот для игры в кубики и турниров!\n\nИспользуй команды:\n/dice - бросить кубик\n/help - показать помощь\n\nДобавь меня в группу и напиши "турнир" чтобы начать турнир!'
            : '🎲 Привет! Я готов к турнирам!\n\nНапишите "турнир" чтобы начать турнир с участниками группы!';
        
        bot.sendMessage(chatId, welcomeText);
        return;
    }

    // Handle /help command
    if (messageText === '/help') {
        const helpText = msg.chat.type === 'private'
            ? '🎲 Доступные команды:\n\n/dice - бросить кубик (1-6)\n/start - начать работу с ботом\n/help - показать эту справку\n\nВ группах:\n"турнир" - начать турнир'
            : '🎲 Доступные команды в группе:\n\n/dice - бросить кубик\n"турнир" - начать турнир\n/help - показать эту справку';
        
        bot.sendMessage(chatId, helpText);
        return;
    }

    // Handle tournament trigger
    if (messageText?.toLowerCase().includes('турнир')) {
        startTournament(chatId, msg.from);
        return;
    }

    // Handle /dice command
    if (messageText === '/dice') {
        // Send dice emoji using Telegram's built-in dice feature
        bot.sendDice(chatId, { emoji: '🎲' })
            .then(() => {
                console.log(`Sent dice to chat ${chatId}`);
            })
            .catch((error) => {
                console.error('Error sending dice:', error);
                bot.sendMessage(chatId, '❌ Произошла ошибка при броске кубика');
            });
        return;
    }

    // Handle unknown commands
    if (messageText?.startsWith('/')) {
        bot.sendMessage(chatId, '❓ Неизвестная команда. Используй /help для списка доступных команд.');
        return;
    }
});

// Function to start a tournament
async function startTournament(chatId: number, initiator: TelegramBot.User | undefined) {
    if (!initiator) return;
    
    // Check if there's already an active tournament
    if (activeTournaments.has(chatId)) {
        bot.sendMessage(chatId, '⚠️ В этом чате уже идет турнир! Дождитесь его завершения.');
        return;
    }

    const initiatorName = initiator.username ? `@${initiator.username}` : (initiator.first_name || 'Неизвестный');
    
    const tournamentMessage = `🏆 **ТУРНИР НАЧАЛСЯ!** 🏆\n\nИнициатор: ${initiatorName}\n\n👥 **Участники:**\n_Пока никого нет_\n\n🎯 Нажмите кнопку ниже, чтобы присоединиться!`;
    
    const keyboard = {
        inline_keyboard: [[
            { text: '🎮 Участвую!', callback_data: 'join_tournament' },
            { text: '🎲 Начать игру', callback_data: 'start_game' }
        ]]
    };

    try {
        const sentMessage = await bot.sendMessage(chatId, tournamentMessage, {
            parse_mode: 'Markdown',
            reply_markup: keyboard
        });

        // Store tournament data
        activeTournaments.set(chatId, {
            messageId: sentMessage.message_id,
            participants: new Set(),
            participantNames: new Map(),
            gameState: 'registration'
        });

        console.log(`Tournament started in chat ${chatId} by ${initiatorName}`);
    } catch (error) {
        console.error('Error starting tournament:', error);
        bot.sendMessage(chatId, '❌ Произошла ошибка при создании турнира');
    }
}

// Function to update tournament message
async function updateTournamentMessage(chatId: number) {
    const tournament = activeTournaments.get(chatId);
    if (!tournament) return;

    const participantsList = tournament.participants.size > 0 
        ? Array.from(tournament.participantNames.values()).map((name, index) => `${index + 1}. ${name}`).join('\n')
        : '_Пока никого нет_';

    const updatedMessage = `🏆 **ТУРНИР** 🏆\n\n👥 **Участники (${tournament.participants.size}):**\n${participantsList}\n\n🎯 Нажмите кнопку ниже, чтобы присоединиться!`;
    
    const keyboard = {
        inline_keyboard: [[
            { text: '🎮 Участвую!', callback_data: 'join_tournament' },
            { text: '🎲 Начать игру', callback_data: 'start_game' }
        ]]
    };

    try {
        await bot.editMessageText(updatedMessage, {
            chat_id: chatId,
            message_id: tournament.messageId,
            parse_mode: 'Markdown',
            reply_markup: keyboard
        });
    } catch (error) {
        console.error('Error updating tournament message:', error);
    }
}

// Handle callback queries (button presses)
bot.on('callback_query', async (callbackQuery) => {
    const chatId = callbackQuery.message?.chat.id;
    const userId = callbackQuery.from.id;
    const data = callbackQuery.data;
    const userName = callbackQuery.from.username ? `@${callbackQuery.from.username}` : (callbackQuery.from.first_name || 'Неизвестный');

    if (!chatId) return;

    try {
        if (data === 'join_tournament') {
            const tournament = activeTournaments.get(chatId);
            if (!tournament) {
                await bot.answerCallbackQuery(callbackQuery.id, { text: 'Турнир не найден!' });
                return;
            }

            if (tournament.participants.has(userId)) {
                await bot.answerCallbackQuery(callbackQuery.id, { text: 'Вы уже участвуете в турнире!' });
                return;
            }

            // Add participant
            tournament.participants.add(userId);
            tournament.participantNames.set(userId, userName);
            
            await updateTournamentMessage(chatId);
            await bot.answerCallbackQuery(callbackQuery.id, { text: 'Вы присоединились к турниру!' });
            
            console.log(`${userName} joined tournament in chat ${chatId}`);
        } else if (data === 'start_game') {
            const tournament = activeTournaments.get(chatId);
            if (!tournament) {
                await bot.answerCallbackQuery(callbackQuery.id, { text: 'Турнир не найден!' });
                return;
            }

            if (tournament.participants.size < 2) {
                await bot.answerCallbackQuery(callbackQuery.id, { text: 'Нужно минимум 2 участника для начала игры!' });
                return;
            }

            // Start the tournament bracket
            await startTournamentBracket(chatId);
            await bot.answerCallbackQuery(callbackQuery.id, { text: 'Турнир начался!' });
        } else if (data === 'throw_dice') {
            await handleDiceThrow(chatId, userId, userName);
            await bot.answerCallbackQuery(callbackQuery.id, { text: 'Кубик брошен!' });
        }
    } catch (error) {
        console.error('Error handling callback query:', error);
        await bot.answerCallbackQuery(callbackQuery.id, { text: 'Произошла ошибка!' });
    }
});

// Function to create tournament bracket
function createTournamentBracket(participants: Map<number, string>): TournamentBracket {
    const playerList = Array.from(participants.entries()).map(([id, name]) => ({ id, name }));
    
    // Shuffle participants randomly
    for (let i = playerList.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [playerList[i], playerList[j]] = [playerList[j], playerList[i]];
    }
    
    // Calculate total rounds needed
    const totalRounds = Math.ceil(Math.log2(playerList.length));
    const rounds: Round[] = [];
    
    // Create first round matches
    const firstRoundMatches: Match[] = [];
    for (let i = 0; i < playerList.length; i += 2) {
        if (i + 1 < playerList.length) {
            firstRoundMatches.push({
                player1: { id: playerList[i].id, name: playerList[i].name },
                player2: { id: playerList[i + 1].id, name: playerList[i + 1].name },
                completed: false
            });
        } else {
            // Odd number of players - this player gets a bye
            firstRoundMatches.push({
                player1: { id: playerList[i].id, name: playerList[i].name },
                player2: { id: -1, name: 'БАЙ' },
                winner: { id: playerList[i].id, name: playerList[i].name },
                completed: true
            });
        }
    }
    
    rounds.push({ matches: firstRoundMatches });
    
    // Create subsequent rounds (empty for now)
    for (let round = 1; round < totalRounds; round++) {
        const prevRoundMatches = rounds[round - 1].matches.length;
        const thisRoundMatches = Math.ceil(prevRoundMatches / 2);
        const matches: Match[] = [];
        
        for (let i = 0; i < thisRoundMatches; i++) {
            matches.push({
                player1: { id: -1, name: 'TBD' },
                player2: { id: -1, name: 'TBD' },
                completed: false
            });
        }
        
        rounds.push({ matches });
    }
    
    return { rounds, totalRounds };
}

// Function to start tournament bracket
async function startTournamentBracket(chatId: number) {
    const tournament = activeTournaments.get(chatId);
    if (!tournament) return;

    // Create bracket
    tournament.bracket = createTournamentBracket(tournament.participantNames);
    tournament.currentRound = 0;
    tournament.currentMatch = 0;
    tournament.gameState = 'playing';

    // Show bracket and start first match
    await showTournamentBracket(chatId);
    await startNextMatch(chatId);
}

// Function to show tournament bracket
async function showTournamentBracket(chatId: number) {
    const tournament = activeTournaments.get(chatId);
    if (!tournament || !tournament.bracket) return;

    let bracketText = '🏆 **ТУРНИРНАЯ СЕТКА** 🏆\n\n';
    
    tournament.bracket.rounds.forEach((round, roundIndex) => {
        bracketText += `**Раунд ${roundIndex + 1}:**\n`;
        round.matches.forEach((match, matchIndex) => {
            const status = match.completed ? '✅' : '⏳';
            const vs = match.player2.name === 'БАЙ' ? '(проходит без игры)' : `vs ${match.player2.name}`;
            bracketText += `${status} ${match.player1.name} ${vs}`;
            if (match.winner) {
                bracketText += ` → **${match.winner.name}**`;
            }
            bracketText += '\n';
        });
        bracketText += '\n';
    });

    await bot.sendMessage(chatId, bracketText, { parse_mode: 'Markdown' });
}

// Function to start next match
async function startNextMatch(chatId: number) {
    const tournament = activeTournaments.get(chatId);
    if (!tournament || !tournament.bracket) return;

    const currentRound = tournament.bracket.rounds[tournament.currentRound!];
    const currentMatch = currentRound.matches[tournament.currentMatch!];

    if (!currentMatch || currentMatch.completed) {
        // Move to next match or round
        tournament.currentMatch! += 1;
        if (tournament.currentMatch! >= currentRound.matches.length) {
            // Move to next round
            tournament.currentRound! += 1;
            tournament.currentMatch = 0;
            
            if (tournament.currentRound! >= tournament.bracket.totalRounds) {
                // Tournament finished
                await finishTournament(chatId);
                return;
            }
            
            // Advance winners to next round
            await advanceWinnersToNextRound(chatId);
        }
        
        // Start next match
        await startNextMatch(chatId);
        return;
    }

    // Skip bye matches
    if (currentMatch.player2.name === 'БАЙ') {
        currentMatch.completed = true;
        await startNextMatch(chatId);
        return;
    }

    const matchText = `🎯 **МАТЧ ${tournament.currentMatch! + 1}** (Раунд ${tournament.currentRound! + 1})\n\n${currentMatch.player1.name} vs ${currentMatch.player2.name}\n\nВы должны бросить кубик!`;
    
    const keyboard = {
        inline_keyboard: [[
            { text: '🎲 Кинуть кубик', callback_data: 'throw_dice' }
        ]]
    };

    await bot.sendMessage(chatId, matchText, {
        parse_mode: 'Markdown',
        reply_markup: keyboard
    });
}

// Function to handle dice throw
async function handleDiceThrow(chatId: number, userId: number, userName: string) {
    const tournament = activeTournaments.get(chatId);
    if (!tournament || !tournament.bracket) return;

    const currentRound = tournament.bracket.rounds[tournament.currentRound!];
    const currentMatch = currentRound.matches[tournament.currentMatch!];

    // Check if user is in current match
    if (currentMatch.player1.id !== userId && currentMatch.player2.id !== userId) {
        return; // Not this player's turn
    }

    // Check if player already rolled
    if ((currentMatch.player1.id === userId && currentMatch.player1.roll !== undefined) ||
        (currentMatch.player2.id === userId && currentMatch.player2.roll !== undefined)) {
        return; // Already rolled
    }

    // Roll dice
    const diceMessage = await bot.sendDice(chatId, { emoji: '🎲' });
    
    // Simulate dice result (in real implementation, you'd get this from the dice message)
    const roll = Math.floor(Math.random() * 6) + 1;
    
    // Store roll result
    if (currentMatch.player1.id === userId) {
        currentMatch.player1.roll = roll;
    } else {
        currentMatch.player2.roll = roll;
    }

    await bot.sendMessage(chatId, `${userName} бросил кубик: **${roll}**`, { parse_mode: 'Markdown' });

    // Check if both players have rolled
    if (currentMatch.player1.roll !== undefined && currentMatch.player2.roll !== undefined) {
        await resolveMatch(chatId);
    }
}

// Function to resolve match
async function resolveMatch(chatId: number) {
    const tournament = activeTournaments.get(chatId);
    if (!tournament || !tournament.bracket) return;

    const currentRound = tournament.bracket.rounds[tournament.currentRound!];
    const currentMatch = currentRound.matches[tournament.currentMatch!];

    const roll1 = currentMatch.player1.roll!;
    const roll2 = currentMatch.player2.roll!;

    let winner;
    if (roll1 > roll2) {
        winner = currentMatch.player1;
    } else if (roll2 > roll1) {
        winner = currentMatch.player2;
    } else {
        // Tie - reroll
        await bot.sendMessage(chatId, `🤝 **НИЧЬЯ!** (${roll1} - ${roll2})\n\nПереигровка! Бросайте кубики снова.`);
        currentMatch.player1.roll = undefined;
        currentMatch.player2.roll = undefined;
        return;
    }

    currentMatch.winner = winner;
    currentMatch.completed = true;

    await bot.sendMessage(chatId, `🏆 **ПОБЕДИТЕЛЬ МАТЧА:** ${winner.name}!\n\n${currentMatch.player1.name}: ${roll1}\n${currentMatch.player2.name}: ${roll2}`, { parse_mode: 'Markdown' });

    // Move to next match
    setTimeout(() => startNextMatch(chatId), 2000);
}

// Function to advance winners to next round
async function advanceWinnersToNextRound(chatId: number) {
    const tournament = activeTournaments.get(chatId);
    if (!tournament || !tournament.bracket) return;

    const prevRound = tournament.bracket.rounds[tournament.currentRound! - 1];
    const currentRound = tournament.bracket.rounds[tournament.currentRound!];

    let winnerIndex = 0;
    for (let i = 0; i < currentRound.matches.length; i++) {
        const match = currentRound.matches[i];
        
        // Get winners from previous round
        const winner1 = prevRound.matches[winnerIndex]?.winner;
        const winner2 = prevRound.matches[winnerIndex + 1]?.winner;
        
        if (winner1) {
            match.player1 = { id: winner1.id, name: winner1.name };
        }
        if (winner2) {
            match.player2 = { id: winner2.id, name: winner2.name };
        }
        
        winnerIndex += 2;
    }

    await bot.sendMessage(chatId, `🔄 **ПЕРЕХОД К РАУНДУ ${tournament.currentRound! + 1}**`);
    await showTournamentBracket(chatId);
}

// Function to finish tournament
async function finishTournament(chatId: number) {
    const tournament = activeTournaments.get(chatId);
    if (!tournament || !tournament.bracket) return;

    const finalRound = tournament.bracket.rounds[tournament.bracket.totalRounds - 1];
    const finalMatch = finalRound.matches[0];
    const champion = finalMatch.winner;

    if (champion) {
        await bot.sendMessage(chatId, `🎉 **ТУРНИР ЗАВЕРШЕН!** 🎉\n\n👑 **ЧЕМПИОН: ${champion.name}!** 👑\n\nПоздравляем с победой! 🏆`, { parse_mode: 'Markdown' });
    }

    // Clean up tournament
    activeTournaments.delete(chatId);
    console.log(`Tournament completed in chat ${chatId}`);
}

// Handle polling errors
bot.on('polling_error', (error) => {
    console.error('Polling error:', error);
});

// Handle webhook errors
bot.on('webhook_error', (error) => {
    console.error('Webhook error:', error);
});

// Graceful shutdown
process.on('SIGINT', () => {
    console.log('🛑 Shutting down bot...');
    bot.stopPolling();
    process.exit(0);
});

process.on('SIGTERM', () => {
    console.log('🛑 Shutting down bot...');
    bot.stopPolling();
    process.exit(0);
});
