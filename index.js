const TelegramBot = require('node-telegram-bot-api');
const https = require('https');
const cron = require('node-cron');
const { openDatabase } = require('./lib/db');
const { createChecker } = require('./lib/checker');
const { registerCommands } = require('./lib/commands');

const httpsAgent = new https.Agent({ rejectUnauthorized: false });

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;

if (!BOT_TOKEN) {
  console.error('Please set TELEGRAM_BOT_TOKEN environment variable');
  process.exit(1);
}

const bot = new TelegramBot(BOT_TOKEN, { polling: true });

const dbPath = process.env.DB_PATH || './data/bot.db';

async function main() {
  const { dbRun, dbAll, dbGet, registerUser, close } = await openDatabase(dbPath);
  const { checkSingleUrl, checkAllUrls } = createChecker({ bot, dbRun, dbAll, httpsAgent });
  registerCommands({ bot, dbAll, dbRun, dbGet, registerUser, checkSingleUrl });
  cron.schedule('0 10,22 * * *', async () => {
    try {
      await checkAllUrls();
    } catch (err) {
      console.error('Cron checkAllUrls error:', err);
    }
  });

  async function shutdown() {
    console.log('Shutting down...');
    bot.stopPolling();
    await close();
    console.log('Shutdown complete');
    process.exit(0);
  }
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  console.log('AIMA Multi-User Bot started...');
  console.log('Users can send URLs to start monitoring');
  console.log('Available commands: /start, /status, /check, /remove, /help');
}

main().catch(err => { console.error('Failed to start:', err); process.exit(1); });
