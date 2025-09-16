import TelegramBot from 'node-telegram-bot-api';
import * as dotenv from 'dotenv';
dotenv.config();

import { TournamentService } from './tournament';

const token = process.env.TELEGRAM_BOT_TOKEN;
if (!token) {
  console.error('TELEGRAM_BOT_TOKEN is not set in environment variables');
  process.exit(1);
}

const bot = new TelegramBot(token, { polling: true });
const service = new TournamentService(bot);

bot.on('polling_error', (error: any) => {
  if (error.code === 'ETELEGRAM' && error.response?.body?.error_code === 409) {
    setTimeout(() => {
      bot.stopPolling();
      setTimeout(() => bot.startPolling(), 1000);
    }, 5000);
  } else {
    console.error('Polling error:', error.message);
  }
});

console.log('🎲 Dice Bot started successfully!');

bot.on('message', (msg) => service.onMessage(msg));
bot.on('callback_query', (cb) => service.onCallback(cb));

bot.on('webhook_error', (e) => console.error('Webhook error:', e));
process.on('SIGINT', () => { bot.stopPolling(); process.exit(0); });
process.on('SIGTERM', () => { bot.stopPolling(); process.exit(0); });
