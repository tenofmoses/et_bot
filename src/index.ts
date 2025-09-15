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

// Handle polling errors to prevent crashes
bot.on('polling_error', (error: any) => {
    if (error.code === 'ETELEGRAM' && error.response?.body?.error_code === 409) {
        console.log('[DEBUG] Multiple bot instances detected, stopping this instance');
        process.exit(0);
    } else {
        console.error('Polling error:', error.message);
    }
});

// Utility function to send message with retry logic
async function sendMessageWithRetry(chatId: number, text: string, options: any = {}, maxRetries: number = 3): Promise<any> {
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
            const result = await bot.sendMessage(chatId, text, options);
            console.log(`[DEBUG] Message sent successfully on attempt ${attempt}`);
            return result;
        } catch (error: any) {
            console.log(`[DEBUG] Message send attempt ${attempt} failed:`, error.message);
            
            if (error.response?.body?.error_code === 429) {
                const retryAfter = error.response?.body?.parameters?.retry_after || 5;
                console.log(`[DEBUG] Rate limited, waiting ${retryAfter} seconds before retry`);
                await new Promise(resolve => setTimeout(resolve, retryAfter * 1000));
            } else if (attempt < maxRetries) {
                // Exponential backoff for other errors
                const delay = Math.pow(2, attempt) * 1000;
                console.log(`[DEBUG] Waiting ${delay}ms before retry`);
                await new Promise(resolve => setTimeout(resolve, delay));
            } else {
                console.error(`[ERROR] Failed to send message after ${maxRetries} attempts:`, error.message);
                throw error;
            }
        }
    }
}

// Utility function to edit message with retry logic
async function editMessageWithRetry(chatId: number, messageId: number, text: string, options: any = {}, maxRetries: number = 3): Promise<any> {
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
            const result = await bot.editMessageText(text, {
                chat_id: chatId,
                message_id: messageId,
                ...options
            });
            console.log(`[DEBUG] Message edited successfully on attempt ${attempt}`);
            return result;
        } catch (error: any) {
            if (error.response?.body?.description?.includes('message is not modified')) {
                console.log('[DEBUG] Message content unchanged, skipping update');
                return null;
            }
            
            console.log(`[DEBUG] Message edit attempt ${attempt} failed:`, error.message);
            
            if (error.response?.body?.error_code === 429) {
                const retryAfter = error.response?.body?.parameters?.retry_after || 5;
                console.log(`[DEBUG] Rate limited, waiting ${retryAfter} seconds before retry`);
                await new Promise(resolve => setTimeout(resolve, retryAfter * 1000));
            } else if (attempt < maxRetries) {
                // Exponential backoff for other errors
                const delay = Math.pow(2, attempt) * 1000;
                console.log(`[DEBUG] Waiting ${delay}ms before retry`);
                await new Promise(resolve => setTimeout(resolve, delay));
            } else {
                console.error(`[ERROR] Failed to edit message after ${maxRetries} attempts:`, error.message);
                throw error;
            }
        }
    }
}

// Store active tournaments by chat ID
interface Tournament {
    messageId: number;
    messageThreadId?: number;
    participants: Set<number>;
    participantNames: Map<number, string>;
    organizerId: number;
    organizerName: string;
    bracket?: TournamentBracket;
    currentRound?: number;
    currentMatch?: number;
    gameState?: 'registration' | 'playing' | 'finished' | 'cancelled';
    startTime?: string;
}

interface TournamentBracket {
    rounds: Round[];
    totalRounds: number;
    byePlayer?: { id: number; name: string };
    byeRound?: number;
}

interface Round {
    matches: Match[];
}

interface Match {
    player1: { id: number; name: string; roll?: number };
    player2: { id: number; name: string; roll?: number } | null;
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

    // Handle tournament trigger - only exact word "турнир" with no other words
    if (messageText?.toLowerCase().trim() === 'турнир') {
        startTournament(chatId, msg.from, undefined, msg.message_thread_id);
        return;
    }
});

// Function to start a tournament
async function startTournament(chatId: number, initiator: TelegramBot.User | undefined, startTime?: string, messageThreadId?: number) {
    if (!initiator) return;
    
    // Check if there's already an active tournament
    if (activeTournaments.has(chatId)) {
        bot.sendMessage(chatId, ' В этом чате уже идет турнир! Дождитесь его завершения.', {
            message_thread_id: messageThreadId
        });
        return;
    }

    const initiatorName = initiator.username ? `@${initiator.username}` : (initiator.first_name || 'Неизвестный');
    
    let tournamentMessage = ` ТУРНИР НАЧАЛСЯ! \n\nИнициатор: ${initiatorName}`;
    
    if (startTime) {
        tournamentMessage += `\n Время начала: ${startTime}`;
    }
    
    tournamentMessage += `\n\n Участники:\n_Пока никого нет_\n\n Нажмите кнопку ниже, чтобы присоединиться!`;
    
    // Create universal keyboard - all users see all buttons, validation in handlers
    const keyboard = {
        inline_keyboard: [
            [
                { text: ' Участвую!', callback_data: 'join_tournament' },
                { text: ' Выйти', callback_data: 'leave_tournament' }
            ],
            [
                { text: ' Начать игру', callback_data: 'start_game' },
                { text: ' Отменить турнир', callback_data: 'cancel_tournament' }
            ]
        ]
    };

    try {
        const sentMessage = await sendMessageWithRetry(chatId, tournamentMessage, {
            reply_markup: keyboard,
            message_thread_id: messageThreadId
        });

        // Store tournament data without organizer as participant
        activeTournaments.set(chatId, {
            messageId: sentMessage.message_id,
            messageThreadId: messageThreadId,
            participants: new Set<number>(),
            participantNames: new Map<number, string>(),
            organizerId: initiator.id,
            organizerName: initiatorName,
            gameState: 'registration',
            startTime: startTime
        });

        // Don't update message immediately - organizer should see join button first

        console.log(`Tournament started in chat ${chatId} by ${initiatorName}`);
    } catch (error) {
        console.error('Error starting tournament:', error);
        bot.sendMessage(chatId, '❌ Произошла ошибка при создании турнира', {
            message_thread_id: messageThreadId
        });
    }
}

// Function to update tournament message
async function updateTournamentMessage(chatId: number, userId?: number) {
    const tournament = activeTournaments.get(chatId);
    if (!tournament) return;

    const participantsList = tournament.participants.size > 0 
        ? Array.from(tournament.participantNames.values()).map((name, index) => `${index + 1}. ${name}`).join('\n')
        : '_Пока никого нет_';

    let updatedMessage = `🏆 ТУРНИР 🏆\n\n👑 Организатор: ${tournament.organizerName}`;
    
    if (tournament.startTime) {
        updatedMessage += `\n⏰ Время начала: ${tournament.startTime}`;
    }
    
    updatedMessage += `\n\n👥 Участники (${tournament.participants.size}):\n${participantsList}`;
    
    // Add tournament bracket and current match info if game is in progress
    if (tournament.gameState === 'playing' && tournament.bracket) {
        updatedMessage += '\n\n🏆 ТУРНИРНАЯ СЕТКА 🏆\n\n';
        
        // Show bye player if exists
        if (tournament.bracket.byePlayer && tournament.bracket.byeRound !== undefined) {
            updatedMessage += `🎯 ${tournament.bracket.byePlayer.name} присоединится в раунде ${tournament.bracket.byeRound + 1}\n\n`;
        }
        
        // Show all rounds
        tournament.bracket.rounds.forEach((round, roundIndex) => {
            updatedMessage += `Раунд ${roundIndex + 1}:\n`;
            round.matches.forEach((match, matchIndex) => {
                const status = match.completed ? '✅' : '⏳';
                
                if (match.player1.name === 'TBD' || (match.player2 && match.player2.name === 'TBD')) {
                    updatedMessage += `${status} Ожидание участников\n`;
                } else if (!match.player2) {
                    updatedMessage += `${status} ${match.player1.name} (одиночный)`;
                    if (match.winner) {
                        updatedMessage += ` → ${match.winner.name}`;
                    }
                    updatedMessage += '\n';
                } else {
                    updatedMessage += `${status} ${match.player1.name} vs ${match.player2.name}`;
                    if (match.winner) {
                        updatedMessage += ` → ${match.winner.name}`;
                    }
                    updatedMessage += '\n';
                }
            });
            updatedMessage += '\n';
        });
        
        // Show current match details
        const currentRound = tournament.bracket.rounds[tournament.currentRound!];
        const currentMatch = currentRound.matches[tournament.currentMatch!];
        
        updatedMessage += `🎯 ТЕКУЩИЙ МАТЧ (Раунд ${tournament.currentRound! + 1}):\n`;
        
        if (!currentMatch.player2) {
            updatedMessage += `${currentMatch.player1.name} (одиночный матч)`;
        } else {
            updatedMessage += `${currentMatch.player1.name} vs ${currentMatch.player2.name}`;
        }
        
        if (currentMatch.player1.roll !== undefined || (currentMatch.player2 && currentMatch.player2.roll !== undefined)) {
            updatedMessage += '\n\n📊 Результаты:\n';
            if (currentMatch.player1.roll !== undefined) {
                updatedMessage += `${currentMatch.player1.name}: ${currentMatch.player1.roll}\n`;
            }
            if (currentMatch.player2 && currentMatch.player2.roll !== undefined) {
                updatedMessage += `${currentMatch.player2.name}: ${currentMatch.player2.roll}\n`;
            }
        }
    } else {
        updatedMessage += '\n\n🎯 Нажмите кнопку ниже, чтобы присоединиться или выйти!';
    }
    
    // Create universal keyboard - show all possible buttons
    const buttons = [];
    
    if (tournament.gameState === 'registration') {
        // Always show all buttons - validation happens in callback handlers
        buttons.push([
            { text: '🎮 Участвую!', callback_data: 'join_tournament' },
            { text: '❌ Выйти', callback_data: 'leave_tournament' }
        ]);
        
        buttons.push([
            { text: '🎲 Начать игру', callback_data: 'start_game' },
            { text: '🚫 Отменить турнир', callback_data: 'cancel_tournament' }
        ]);
    } else if (tournament.gameState === 'playing') {
        // Show dice button for current players only
        const currentRound = tournament.bracket!.rounds[tournament.currentRound!];
        const currentMatch = currentRound.matches[tournament.currentMatch!];
        
        // Only show dice button if match is not completed and players haven't rolled yet
        if (!currentMatch.completed && 
            (currentMatch.player1.roll === undefined || 
             (currentMatch.player2 && currentMatch.player2.roll === undefined))) {
            buttons.push([{ text: '🎲 Кинуть кубик', callback_data: 'throw_dice' }]);
        }
    }
    
    const keyboard = {
        inline_keyboard: buttons
    };

    try {
        await editMessageWithRetry(chatId, tournament.messageId, updatedMessage, {
            reply_markup: keyboard
        });
    } catch (error: any) {
        console.error('Error updating tournament message after retries:', error);
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
        } else if (data === 'throw_dice') {
            const canThrow = await handleDiceThrow(chatId, userId, userName);
            if (canThrow) {
                await bot.answerCallbackQuery(callbackQuery.id, { text: 'Кубик брошен!' });
            } else {
                await bot.answerCallbackQuery(callbackQuery.id, { text: 'Вы уже бросили кубик!' });
            }
        } else if (data === 'leave_tournament') {
            const tournament = activeTournaments.get(chatId);
            if (!tournament || !tournament.participants.has(userId)) {
                await bot.answerCallbackQuery(callbackQuery.id, { text: 'Вы не участвуете в турнире!' });
                return;
            }
            await handleLeaveTournament(chatId, userId, userName);
            await updateTournamentMessage(chatId);
            await bot.answerCallbackQuery(callbackQuery.id, { text: 'Вы вышли из турнира!' });
        } else if (data === 'cancel_tournament') {
            const tournament = activeTournaments.get(chatId);
            if (!tournament) {
                await bot.answerCallbackQuery(callbackQuery.id, { text: 'Турнир не найден!' });
                return;
            }
            if (tournament.organizerId !== userId) {
                await bot.answerCallbackQuery(callbackQuery.id, { text: 'Только организатор может отменить турнир!' });
                return;
            }
            await handleCancelTournament(chatId, userId);
            await bot.answerCallbackQuery(callbackQuery.id, { text: 'Турнир отменен!' });
        } else if (data === 'start_game') {
            const tournament = activeTournaments.get(chatId);
            if (!tournament || tournament.organizerId !== userId) {
                await bot.answerCallbackQuery(callbackQuery.id, { text: 'Только организатор может начать турнир!' });
                return;
            }
            if (tournament.participants.size < 1) {
                await bot.answerCallbackQuery(callbackQuery.id, { text: 'Нужно минимум 1 участник для начала игры!' });
                return;
            }
            await startTournamentBracket(chatId);
            await bot.answerCallbackQuery(callbackQuery.id, { text: 'Турнир начался!' });
        }
    } catch (error) {
        console.error('Error handling callback query:', error);
        await bot.answerCallbackQuery(callbackQuery.id, { text: 'Произошла ошибка!' });
    }
});

// Function to handle tournament cancellation
async function handleCancelTournament(chatId: number, userId: number) {
    const tournament = activeTournaments.get(chatId);
    if (!tournament) return;

    // Set tournament state to cancelled
    tournament.gameState = 'cancelled';
    
    await editMessageWithRetry(chatId, tournament.messageId, '🚫 ТУРНИР ОТМЕНЕН\n\nТурнир был отменен.');
    
    // Remove tournament after updating message
    activeTournaments.delete(chatId);
    
    console.log(`Tournament cancelled in chat ${chatId} by user ${userId}`);
}

// Function to handle leaving tournament
async function handleLeaveTournament(chatId: number, userId: number, userName: string) {
    const tournament = activeTournaments.get(chatId);
    if (!tournament) return;

    // Check if tournament has already started
    if (tournament.gameState === 'playing') {
        return; // Can't leave once game has started
    }

    // Check if user is in tournament
    if (!tournament.participants.has(userId)) {
        return; // User is not in tournament
    }

    // Remove participant
    tournament.participants.delete(userId);
    tournament.participantNames.delete(userId);
    
    await updateTournamentMessage(chatId, userId);
    console.log(`${userName} left tournament in chat ${chatId}`);
}

// Function to create tournament bracket
function createTournamentBracket(participants: Map<number, string>): TournamentBracket {
    const playerList = Array.from(participants.entries()).map(([id, name]) => ({ id, name }));
    
    // Shuffle participants randomly
    for (let i = playerList.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [playerList[i], playerList[j]] = [playerList[j], playerList[i]];
    }
    
    // Handle single player case
    if (playerList.length === 1) {
        const rounds: Round[] = [{
            matches: [{
                player1: playerList[0],
                player2: null,
                winner: undefined,
                completed: false
            }]
        }];
        
        return {
            rounds,
            totalRounds: 1,
            byePlayer: undefined,
            byeRound: -1
        };
    }
    
    // For even number of players, no bye needed
    if (playerList.length % 2 === 0) {
        const totalRounds = Math.ceil(Math.log2(playerList.length));
        const rounds: Round[] = [];
        
        // Create first round matches
        const firstRoundMatches: Match[] = [];
        for (let i = 0; i < playerList.length; i += 2) {
            firstRoundMatches.push({
                player1: { id: playerList[i].id, name: playerList[i].name },
                player2: { id: playerList[i + 1].id, name: playerList[i + 1].name },
                completed: false
            });
        }
        rounds.push({ matches: firstRoundMatches });
        
        // Create subsequent rounds
        let currentMatches = firstRoundMatches.length;
        for (let round = 1; round < totalRounds; round++) {
            currentMatches = Math.ceil(currentMatches / 2);
            const matches: Match[] = [];
            
            for (let i = 0; i < currentMatches; i++) {
                matches.push({
                    player1: { id: -1, name: 'TBD' },
                    player2: { id: -1, name: 'TBD' },
                    completed: false
                });
            }
            rounds.push({ matches });
        }
        
        return { rounds, totalRounds, byePlayer: undefined, byeRound: -1 };
    }
    
    // For odd number of players, calculate bye logic
    // The bye player should join when there's an odd number of winners that need to be paired
    const totalRounds = Math.ceil(Math.log2(playerList.length));
    const rounds: Round[] = [];
    const byePlayer = playerList[playerList.length - 1];
    
    // Create first round with even number of players (exclude bye player)
    const firstRoundMatches: Match[] = [];
    const playersInFirstRound = playerList.length - 1; // Exclude bye player
    
    for (let i = 0; i < playersInFirstRound; i += 2) {
        firstRoundMatches.push({
            player1: { id: playerList[i].id, name: playerList[i].name },
            player2: { id: playerList[i + 1].id, name: playerList[i + 1].name },
            completed: false
        });
    }
    rounds.push({ matches: firstRoundMatches });
    
    // Calculate when bye player should join
    let winnersCount = firstRoundMatches.length; // Winners from first round
    let byeRound = -1;
    
    // Find the round where adding the bye player creates an even number for pairing
    for (let round = 1; round < totalRounds; round++) {
        if ((winnersCount + 1) % 2 === 0) {
            // Adding bye player makes even number - this is the round
            byeRound = round;
            break;
        }
        winnersCount = Math.ceil(winnersCount / 2);
    }
    
    // Create subsequent rounds
    let currentWinners = firstRoundMatches.length;
    for (let round = 1; round < totalRounds; round++) {
        // Add bye player if this is their round
        if (round === byeRound) {
            currentWinners += 1;
        }
        
        const matchesInRound = Math.ceil(currentWinners / 2);
        const matches: Match[] = [];
        
        for (let i = 0; i < matchesInRound; i++) {
            matches.push({
                player1: { id: -1, name: 'TBD' },
                player2: { id: -1, name: 'TBD' },
                completed: false
            });
        }
        
        rounds.push({ matches });
        currentWinners = matchesInRound; // Winners from this round
    }
    
    return { rounds, totalRounds, byePlayer, byeRound };
}

// Function to send tournament bracket as separate message
async function sendTournamentBracket(chatId: number) {
    const tournament = activeTournaments.get(chatId);
    if (!tournament || !tournament.bracket) return;
    
    let bracketText = '🏆 ТУРНИРНАЯ СЕТКА 🏆\n\n';
    
    // Show bye player if exists
    if (tournament.bracket.byePlayer && tournament.bracket.byeRound !== undefined) {
        bracketText += `🎯 ${tournament.bracket.byePlayer.name} присоединится в раунде ${tournament.bracket.byeRound + 1}\n\n`;
    }
    
    tournament.bracket.rounds.forEach((round, roundIndex) => {
        bracketText += `Раунд ${roundIndex + 1}:\n`;
        round.matches.forEach((match, matchIndex) => {
            const status = match.completed ? '✅' : '⏳';
            
            if (match.player1.name === 'TBD' || (match.player2 && match.player2.name === 'TBD')) {
                bracketText += `${status} Ожидание участников\n`;
            } else if (!match.player2) {
                bracketText += `${status} ${match.player1.name} (одиночный)`;
                if (match.winner) {
                    bracketText += ` → ${match.winner.name}`;
                }
                bracketText += '\n';
            } else {
                bracketText += `${status} ${match.player1.name} vs ${match.player2.name}`;
                if (match.winner) {
                    bracketText += ` → ${match.winner.name}`;
                }
                bracketText += '\n';
            }
        });
        bracketText += '\n';
    });
    
    await sendMessageWithRetry(chatId, bracketText, { 
        message_thread_id: tournament.messageThreadId
    });
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

    // Update main message to show tournament bracket and start first match
    await updateTournamentMessage(chatId);
    await startNextMatch(chatId);
}

// Function to start next match
async function startNextMatch(chatId: number) {
    const tournament = activeTournaments.get(chatId);
    if (!tournament || !tournament.bracket) return;

    console.log(`[DEBUG] startNextMatch called. Current round: ${tournament.currentRound}, current match: ${tournament.currentMatch}`);
    
    const currentRound = tournament.bracket.rounds[tournament.currentRound!];
    const currentMatch = currentRound.matches[tournament.currentMatch!];
    
    console.log(`[DEBUG] Current match exists: ${!!currentMatch}, completed: ${currentMatch?.completed}`);
    console.log(`[DEBUG] Round has ${currentRound.matches.length} matches total`);

    if (!currentMatch || currentMatch.completed) {
        // Move to next match or round
        tournament.currentMatch! += 1;
        if (tournament.currentMatch! >= currentRound.matches.length) {
            // Check if all matches in current round are completed
            const allMatchesCompleted = currentRound.matches.every(match => match.completed);
            console.log(`[DEBUG] All matches completed in round: ${allMatchesCompleted}`);
            if (!allMatchesCompleted) {
                // Find next incomplete match
                const nextIncompleteMatchIndex = currentRound.matches.findIndex(match => !match.completed);
                console.log(`[DEBUG] Next incomplete match index: ${nextIncompleteMatchIndex}`);
                if (nextIncompleteMatchIndex !== -1) {
                    tournament.currentMatch = nextIncompleteMatchIndex;
                    await startNextMatch(chatId);
                }
                return;
            }
            
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
            return;
        }
        
        // Start next match in current round
        await startNextMatch(chatId);
        return;
    }

    // Handle single player match
    if (!currentMatch.player2) {
        const matchText = `🎯 ОДИНОЧНЫЙ ТУРНИР\n\n${currentMatch.player1.name}, бросьте кубик чтобы завершить турнир!`;
        
        const keyboard = {
            inline_keyboard: [[
                { text: '🎲 Кинуть кубик', callback_data: 'throw_dice' }
            ]]
        };

        await sendMessageWithRetry(chatId, matchText, {
            reply_markup: keyboard,
            message_thread_id: tournament.messageThreadId
        });
        return;
    }

    // Skip bye matches
    if (currentMatch.player2.name === 'БАЙ') {
        currentMatch.completed = true;
        await startNextMatch(chatId);
        return;
    }

    const matchText = `🎯 МАТЧ ${tournament.currentMatch! + 1} (Раунд ${tournament.currentRound! + 1})\n\n${currentMatch.player1.name} vs ${currentMatch.player2.name}\n\nВы должны бросить кубик!`;
    
    const keyboard = {
        inline_keyboard: [[
            { text: '🎲 Кинуть кубик', callback_data: 'throw_dice' }
        ]]
    };

    await sendMessageWithRetry(chatId, matchText, {
        reply_markup: keyboard,
        message_thread_id: tournament.messageThreadId
    });
}

// Function to handle dice throw
async function handleDiceThrow(chatId: number, userId: number, userName: string): Promise<boolean> {
    const tournament = activeTournaments.get(chatId);
    if (!tournament || !tournament.bracket) return false;

    const currentRound = tournament.bracket.rounds[tournament.currentRound!];
    const currentMatch = currentRound.matches[tournament.currentMatch!];

    // Handle single player match
    if (!currentMatch.player2) {
        if (currentMatch.player1.id !== userId) {
            return false; // Not this player's turn
        }
        
        if (currentMatch.player1.roll !== undefined) {
            return false; // Already rolled
        }
        
        // Roll dice for single player
        const diceMessage = await bot.sendDice(chatId, { 
            emoji: '🎲',
            message_thread_id: tournament.messageThreadId
        });
        
        // Wait for dice animation to complete and get the result
        setTimeout(async () => {
            try {
                const roll = diceMessage.dice?.value || Math.floor(Math.random() * 6) + 1;
                currentMatch.player1.roll = roll;
                currentMatch.winner = currentMatch.player1;
                currentMatch.completed = true;
                
                await bot.sendMessage(chatId, `🎲 ${userName} бросил: ${roll}\n\n🏆 ТУРНИР ЗАВЕРШЕН!\n\n🥇 Победитель: ${currentMatch.player1.name}`, {
                    message_thread_id: tournament.messageThreadId
                });
                
                // Clean up tournament
                activeTournaments.delete(chatId);
            } catch (error) {
                console.error('Error processing single player dice result:', error);
            }
        }, 4000); // Wait 4 seconds for dice animation
        return true;
    }

    // Check if user is in current match
    if (currentMatch.player1.id !== userId && currentMatch.player2!.id !== userId) {
        return false; // Not this player's turn
    }

    // Check if player already rolled
    if ((currentMatch.player1.id === userId && currentMatch.player1.roll !== undefined) ||
        (currentMatch.player2!.id === userId && currentMatch.player2!.roll !== undefined)) {
        return false; // Already rolled
    }

    // Roll dice with player name
    await bot.sendMessage(chatId, `🎲 ${userName} кидает кубик...`, {
        message_thread_id: tournament.messageThreadId
    });
    const diceMessage = await bot.sendDice(chatId, { 
        emoji: '🎲',
        message_thread_id: tournament.messageThreadId
    });
    
    // Wait for dice animation to complete and get the result
    setTimeout(async () => {
        try {
            // Get the dice value from the message
            const roll = diceMessage.dice?.value || Math.floor(Math.random() * 6) + 1;
            
            // Store roll result
            if (currentMatch.player1.id === userId) {
                currentMatch.player1.roll = roll;
            } else {
                currentMatch.player2!.roll = roll;
            }

            // Check if both players have rolled (for multiplayer) or complete single player match
            if (!currentMatch.player2) {
                // Single player - complete immediately
                currentMatch.winner = currentMatch.player1;
                currentMatch.completed = true;
                
                // Check if this was the last match in the tournament
                if (tournament.bracket && tournament.currentRound! >= tournament.bracket.totalRounds - 1) {
                    await finishTournament(chatId);
                } else {
                    await startNextMatch(chatId);
                }
            } else if (currentMatch.player1.roll !== undefined && currentMatch.player2!.roll !== undefined) {
                await resolveMatch(chatId);
            } else {
                // Update tournament message to reflect current state
                await updateTournamentMessage(chatId);
            }
        } catch (error) {
            console.error('Error processing dice result:', error);
        }
    }, 4000); // Wait 4 seconds for dice animation
    
    return true;
}

// Function to resolve match
async function resolveMatch(chatId: number) {
    const tournament = activeTournaments.get(chatId);
    if (!tournament || !tournament.bracket) return;

    const currentRound = tournament.bracket.rounds[tournament.currentRound!];
    const currentMatch = currentRound.matches[tournament.currentMatch!];

    const roll1 = currentMatch.player1.roll!;
    const roll2 = currentMatch.player2!.roll!;

    let winner;
    if (roll1 > roll2) {
        winner = currentMatch.player1;
    } else if (roll2 > roll1) {
        winner = currentMatch.player2!;
    } else {
        // Tie - restart the round with both players
        await bot.sendMessage(chatId, `🤝 НИЧЬЯ! (${roll1} - ${roll2})\n\n🔄 Начинаем раунд заново!`, {
            message_thread_id: tournament.messageThreadId
        });
        
        // Reset both players' rolls
        currentMatch.player1.roll = undefined;
        currentMatch.player2!.roll = undefined;
        
        // Restart the match after a delay - send new match message instead of recursion
        setTimeout(async () => {
            const matchText = `🎯 МАТЧ ${tournament.currentMatch! + 1} (Раунд ${tournament.currentRound! + 1})\n\n${currentMatch.player1.name} vs ${currentMatch.player2!.name}\n\nВы должны бросить кубик!`;
            
            const keyboard = {
                inline_keyboard: [[
                    { text: '🎲 Кинуть кубик', callback_data: 'throw_dice' }
                ]]
            };

            await sendMessageWithRetry(chatId, matchText, {
                reply_markup: keyboard,
                message_thread_id: tournament.messageThreadId
            });
        }, 2000);
        return;
    }

    currentMatch.winner = winner;
    currentMatch.completed = true;

    await sendMessageWithRetry(chatId, `🏆 ПОБЕДИТЕЛЬ МАТЧА: ${winner.name}!\n\n${currentMatch.player1.name}: ${roll1}\n${currentMatch.player2!.name}: ${roll2}`, {
        message_thread_id: tournament.messageThreadId
    });

    // Move to next match
    console.log(`[DEBUG] Match completed. Moving to next match. Current round: ${tournament.currentRound}, current match: ${tournament.currentMatch}`);
    console.log(`[DEBUG] Match winner: ${winner.name}, match marked as completed: ${currentMatch.completed}`);
    
    // Don't call updateTournamentMessage here since resolveMatch is called from within handleDiceThrow
    // which already calls updateTournamentMessage
    setTimeout(() => startNextMatch(chatId), 2000);
}

// Function to advance winners to next round
async function advanceWinnersToNextRound(chatId: number) {
    const tournament = activeTournaments.get(chatId);
    if (!tournament || !tournament.bracket) return;

    // Check if we're trying to advance beyond the last round
    if (tournament.currentRound! >= tournament.bracket.totalRounds) {
        console.log(`[DEBUG] Tournament completed - no more rounds to advance to`);
        await finishTournament(chatId);
        return;
    }

    const prevRound = tournament.bracket.rounds[tournament.currentRound! - 1];
    const currentRound = tournament.bracket.rounds[tournament.currentRound!];
    const winners = prevRound.matches.map(match => match.winner).filter(winner => winner !== undefined);

    console.log(`[DEBUG] Advancing ${winners.length} winners to round ${tournament.currentRound! + 1}`);
    console.log(`[DEBUG] Current round has ${currentRound.matches.length} matches`);
    console.log(`[DEBUG] Bye player should join in round: ${tournament.bracket.byeRound}, current round: ${tournament.currentRound}`);
    
    // Check if bye player should join this round
    const shouldByePlayerJoin = tournament.currentRound === tournament.bracket.byeRound && tournament.bracket.byePlayer;
    
    let playersToPlace = [...winners];
    if (shouldByePlayerJoin) {
        playersToPlace.push(tournament.bracket.byePlayer!);
        console.log(`[DEBUG] Adding bye player ${tournament.bracket.byePlayer!.name} to round ${tournament.currentRound! + 1}`);
    }
    
    console.log(`[DEBUG] Total players to place: ${playersToPlace.length}`);
    
    // Fill matches with players - handle odd numbers properly
    let playerIndex = 0;
    
    // If odd number of players, one gets a bye (skip to next round)
    if (playersToPlace.length % 2 === 1) {
        const byePlayer = playersToPlace.pop()!; // Remove last player for bye
        console.log(`[DEBUG] ${byePlayer.name} gets bye to next round due to odd number of players`);
        
        // Store bye player for next round if not already set
        if (!tournament.bracket.byePlayer || tournament.bracket.byeRound !== tournament.currentRound! + 1) {
            tournament.bracket.byePlayer = byePlayer;
            tournament.bracket.byeRound = tournament.currentRound! + 1;
        }
    }
    
    // Fill matches with remaining players (now even number)
    for (let i = 0; i < currentRound.matches.length; i++) {
        const match = currentRound.matches[i];
        
        if (playerIndex < playersToPlace.length && playersToPlace[playerIndex]) {
            const player1 = playersToPlace[playerIndex];
            if (player1) {
                match.player1 = { id: player1.id, name: player1.name };
                playerIndex++;
            }
        }
        
        if (playerIndex < playersToPlace.length && playersToPlace[playerIndex]) {
            const player2 = playersToPlace[playerIndex];
            if (player2) {
                match.player2 = { id: player2.id, name: player2.name };
                playerIndex++;
            }
        } else if (match.player1 && !match.player2) {
            // If only one player in match, they automatically advance
            match.player2 = null;
        }
        
        // Clear matches that have no real players assigned
        if (playerIndex >= playersToPlace.length && (!match.player1 || match.player1.name === 'TBD')) {
            match.player1 = { id: -1, name: 'TBD' };
            match.player2 = { id: -1, name: 'TBD' };
        }
        
        console.log(`[DEBUG] Match ${i + 1}: ${match.player1?.name || 'TBD'} vs ${match.player2?.name || 'single player'}`);
    }

    try {
        await sendMessageWithRetry(chatId, `🔄 ПЕРЕХОД К РАУНДУ ${tournament.currentRound! + 1}`, {
            message_thread_id: tournament.messageThreadId
        });
        
        // Add delay to prevent rate limiting
        await new Promise(resolve => setTimeout(resolve, 1000));
        
        if (shouldByePlayerJoin) {
            await sendMessageWithRetry(chatId, `🎯 ${tournament.bracket.byePlayer!.name} присоединяется к турниру!`, {
                message_thread_id: tournament.messageThreadId
            });
            await new Promise(resolve => setTimeout(resolve, 1000));
        }
        
        // Send updated bracket for new round
        await sendTournamentBracket(chatId);
        await new Promise(resolve => setTimeout(resolve, 1000));
        
        await updateTournamentMessage(chatId);
        
        // Start first match of new round
        setTimeout(() => startNextMatch(chatId), 1000);
    } catch (error: any) {
        if (error.response?.body?.error_code === 429) {
            const retryAfter = error.response?.body?.parameters?.retry_after || 10;
            console.log(`[DEBUG] Rate limited in advanceWinnersToNextRound, waiting ${retryAfter} seconds`);
            setTimeout(() => startNextMatch(chatId), (retryAfter + 2) * 1000);
        } else {
            console.error('Error in advanceWinnersToNextRound:', error);
            // Continue with tournament progression even if some messages fail
            setTimeout(() => startNextMatch(chatId), 3000);
        }
    }
}

// Function to finish tournament
async function finishTournament(chatId: number) {
    const tournament = activeTournaments.get(chatId);
    if (!tournament || !tournament.bracket) return;

    const finalRound = tournament.bracket.rounds[tournament.bracket.totalRounds - 1];
    const finalMatch = finalRound.matches[0];
    const champion = finalMatch.winner;

    // Set tournament state to finished
    tournament.gameState = 'finished';
    
    // Update tournament message to remove buttons
    await updateTournamentMessage(chatId);

    if (champion) {
        // Create final tournament results message with full bracket
        let resultsMessage = `🎉 ТУРНИР ЗАВЕРШЕН! 🎉\n\n👑 ЧЕМПИОН: ${champion.name}! 👑\n\n`;
        
        resultsMessage += `🏆 ФИНАЛЬНАЯ ТУРНИРНАЯ ТАБЛИЦА 🏆\n\n`;
        
        // Show bye player if exists
        if (tournament.bracket.byePlayer && tournament.bracket.byeRound !== undefined) {
            resultsMessage += `🎯 ${tournament.bracket.byePlayer.name} присоединился в раунде ${tournament.bracket.byeRound + 1}\n\n`;
        }
        
        // Show all rounds with results
        tournament.bracket.rounds.forEach((round, roundIndex) => {
            resultsMessage += `Раунд ${roundIndex + 1}:\n`;
            round.matches.forEach((match, matchIndex) => {
                const status = '✅'; // All matches are completed at this point
                
                if (match.player1.name === 'TBD' || (match.player2 && match.player2.name === 'TBD')) {
                    resultsMessage += `${status} Ожидание участников\n`;
                } else if (!match.player2) {
                    resultsMessage += `${status} ${match.player1.name} (одиночный)`;
                    if (match.winner) {
                        resultsMessage += ` → 🏆 ${match.winner.name}`;
                    }
                    resultsMessage += '\n';
                } else {
                    resultsMessage += `${status} ${match.player1.name} vs ${match.player2.name}`;
                    if (match.winner) {
                        resultsMessage += ` → 🏆 ${match.winner.name}`;
                    }
                    resultsMessage += '\n';
                }
            });
            resultsMessage += '\n';
        });
        
        resultsMessage += `🎊 Поздравляем с победой! 🎊`;
        
        await bot.sendMessage(chatId, resultsMessage, {
            message_thread_id: tournament.messageThreadId
        });
    }

    // Clean up tournament after a delay to allow message update
    setTimeout(() => {
        activeTournaments.delete(chatId);
        console.log(`Tournament completed in chat ${chatId}`);
    }, 1000);
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
