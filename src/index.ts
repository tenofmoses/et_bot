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
    byePlayer?: { id: number; name: string };
    byeRound?: number;
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
        inline_keyboard: [
            [
                { text: '🎮 Участвую!', callback_data: 'join_tournament' },
                { text: '❌ Выйти', callback_data: 'leave_tournament' }
            ],
            [
                { text: '🎲 Начать игру', callback_data: 'start_game' }
            ]
        ]
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

    const updatedMessage = `🏆 **ТУРНИР** 🏆\n\n👥 **Участники (${tournament.participants.size}):**\n${participantsList}\n\n🎯 Нажмите кнопку ниже, чтобы присоединиться или выйти!`;
    
    const keyboard = {
        inline_keyboard: [
            [
                { text: '🎮 Участвую!', callback_data: 'join_tournament' },
                { text: '❌ Выйти', callback_data: 'leave_tournament' }
            ],
            [
                { text: '🎲 Начать игру', callback_data: 'start_game' }
            ]
        ]
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
        } else if (data === 'leave_tournament') {
            await handleLeaveTournament(chatId, userId, userName);
            await bot.answerCallbackQuery(callbackQuery.id, { text: 'Вы вышли из турнира!' });
        }
    } catch (error) {
        console.error('Error handling callback query:', error);
        await bot.answerCallbackQuery(callbackQuery.id, { text: 'Произошла ошибка!' });
    }
});

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
    
    await updateTournamentMessage(chatId);
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
    
    // Calculate total rounds needed
    const totalRounds = Math.ceil(Math.log2(playerList.length));
    const rounds: Round[] = [];
    
    // Determine bye player and which round they join
    let byePlayer = null;
    let byeRound = -1;
    
    if (playerList.length % 2 === 1) {
        byePlayer = playerList[playerList.length - 1];
        
        // Calculate which round the bye player should join
        // Find the round where there will be an odd number of winners
        let currentPlayers = playerList.length - 1; // Exclude bye player
        byeRound = 0;
        
        while (currentPlayers > 1) {
            currentPlayers = Math.floor(currentPlayers / 2);
            byeRound++;
            if (currentPlayers % 2 === 1) {
                break;
            }
        }
    }
    
    // Create first round matches (excluding bye player)
    const firstRoundMatches: Match[] = [];
    const playersInFirstRound = byePlayer ? playerList.length - 1 : playerList.length;
    
    for (let i = 0; i < playersInFirstRound; i += 2) {
        firstRoundMatches.push({
            player1: { id: playerList[i].id, name: playerList[i].name },
            player2: { id: playerList[i + 1].id, name: playerList[i + 1].name },
            completed: false
        });
    }
    
    rounds.push({ matches: firstRoundMatches });
    
    // Create subsequent rounds
    for (let round = 1; round < totalRounds; round++) {
        const prevRoundMatches = rounds[round - 1].matches.length;
        let winnersFromPrevRound = prevRoundMatches;
        
        // Add bye player if this is their round
        if (round === byeRound && byePlayer) {
            winnersFromPrevRound += 1;
        }
        
        const thisRoundMatches = Math.ceil(winnersFromPrevRound / 2);
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
    
    return { rounds, totalRounds, byePlayer: byePlayer || undefined, byeRound };
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
    
    // Show bye player if exists
    if (tournament.bracket.byePlayer && tournament.bracket.byeRound !== undefined) {
        bracketText += `🎯 **${tournament.bracket.byePlayer.name}** присоединится в раунде ${tournament.bracket.byeRound + 1}\n\n`;
    }
    
    tournament.bracket.rounds.forEach((round, roundIndex) => {
        bracketText += `**Раунд ${roundIndex + 1}:**\n`;
        round.matches.forEach((match, matchIndex) => {
            const status = match.completed ? '✅' : '⏳';
            
            if (match.player1.name === 'TBD' || match.player2.name === 'TBD') {
                bracketText += `${status} Ожидание участников\n`;
            } else {
                bracketText += `${status} ${match.player1.name} vs ${match.player2.name}`;
                if (match.winner) {
                    bracketText += ` → **${match.winner.name}**`;
                }
                bracketText += '\n';
            }
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
    const winners = prevRound.matches.map(match => match.winner).filter(winner => winner !== undefined);

    let winnerIndex = 0;
    let matchIndex = 0;
    
    // Check if bye player should join this round
    const shouldByePlayerJoin = tournament.currentRound === tournament.bracket.byeRound && tournament.bracket.byePlayer;
    
    if (shouldByePlayerJoin) {
        // Add bye player to the list of "winners"
        winners.push(tournament.bracket.byePlayer!);
    }
    
    // Fill matches with winners
    for (let i = 0; i < currentRound.matches.length; i++) {
        const match = currentRound.matches[i];
        
        if (winnerIndex < winners.length) {
            match.player1 = { id: winners[winnerIndex].id, name: winners[winnerIndex].name };
            winnerIndex++;
        }
        
        if (winnerIndex < winners.length) {
            match.player2 = { id: winners[winnerIndex].id, name: winners[winnerIndex].name };
            winnerIndex++;
        }
    }

    await bot.sendMessage(chatId, `🔄 **ПЕРЕХОД К РАУНДУ ${tournament.currentRound! + 1}**`);
    if (shouldByePlayerJoin) {
        await bot.sendMessage(chatId, `🎯 **${tournament.bracket.byePlayer!.name}** присоединяется к турниру!`);
    }
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
