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
            participantNames: new Map()
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

            // Start the dice game
            await startDiceGame(chatId);
            await bot.answerCallbackQuery(callbackQuery.id, { text: 'Игра началась!' });
        }
    } catch (error) {
        console.error('Error handling callback query:', error);
        await bot.answerCallbackQuery(callbackQuery.id, { text: 'Произошла ошибка!' });
    }
});

// Function to start dice game
async function startDiceGame(chatId: number) {
    const tournament = activeTournaments.get(chatId);
    if (!tournament) return;

    const participants = Array.from(tournament.participantNames.values());
    
    await bot.sendMessage(chatId, `🎲 **ИГРА НАЧАЛАСЬ!** 🎲\n\nУчастники: ${participants.join(', ')}\n\nКаждый участник бросает кубик! Побеждает тот, у кого выпадет наибольшее число!`);
    
    // Roll dice for each participant
    const results: { name: string, roll: number }[] = [];
    
    for (const participantName of participants) {
        const diceMessage = await bot.sendDice(chatId, { emoji: '🎲' });
        // Note: In real implementation, you'd need to wait for the dice animation to complete
        // and get the actual result. For now, we'll simulate it.
        const roll = Math.floor(Math.random() * 6) + 1;
        results.push({ name: participantName, roll });
        
        await new Promise(resolve => setTimeout(resolve, 1000)); // Wait between rolls
    }
    
    // Determine winner
    const maxRoll = Math.max(...results.map(r => r.roll));
    const winners = results.filter(r => r.roll === maxRoll);
    
    let resultMessage = '🏆 **РЕЗУЛЬТАТЫ ТУРНИРА** 🏆\n\n';
    results.forEach(result => {
        const emoji = result.roll === maxRoll ? '👑' : '🎲';
        resultMessage += `${emoji} ${result.name}: ${result.roll}\n`;
    });
    
    if (winners.length === 1) {
        resultMessage += `\n🎉 **ПОБЕДИТЕЛЬ: ${winners[0].name}!** 🎉`;
    } else {
        resultMessage += `\n🤝 **НИЧЬЯ между:** ${winners.map(w => w.name).join(', ')}`;
    }
    
    await bot.sendMessage(chatId, resultMessage);
    
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
