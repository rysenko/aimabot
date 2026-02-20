const { isValidAimaUrl } = require('./validate-url');
const { formatUrlLabel } = require('./scraper');

const MAX_URLS_PER_USER = 50;
const CHECK_COOLDOWN_MS = 300_000;

function registerCommands({ bot, dbAll, dbRun, dbGet, registerUser, checkSingleUrl }) {
  const pendingRemoves = new Set();
  const lastCheckTime = new Map();

  bot.onText(/\/start(?:@\w+)?$/, async (msg) => {
    const chatId = String(msg.chat.id);
    registerUser(chatId, msg.from.username, msg.from.first_name, msg.from.last_name);

    const welcome = `👋 Welcome to AIMA Monitor Bot!

🤖 I can monitor AIMA portal URLs for changes in these fields:
📅 Última Atualização
📋 Situação AT/SS
🏛️ Estado

📋 Commands:
/status - Show your monitored URLs
/check - Check all your URLs now
/remove - Remove a URL from monitoring
/help - Show this help

📨 To start monitoring:
Send me the AIMA URL from your submission confirmation document (usually found in the QR code). The URL must be from aima.gov.pt domain.`;

    await bot.sendMessage(chatId, welcome);
  });

  bot.onText(/\/status(?:@\w+)?$/, async (msg) => {
    const chatId = String(msg.chat.id);
    registerUser(chatId, msg.from.username, msg.from.first_name, msg.from.last_name);

    try {
      const rows = await dbAll('SELECT * FROM monitored_urls WHERE chat_id = ?', [chatId]);

      if (rows.length === 0) {
        await bot.sendMessage(chatId, '📭 No URLs being monitored.\nSend me a URL to start monitoring!');
        return;
      }

      let status = `📊 Your monitored URLs (${rows.length}):\n\n`;
      rows.forEach((row, index) => {
        status += `${index + 1}. ${formatUrlLabel(row.url, row.nome)}\n`;
        if (row.ultima_atualizacao) status += `   📅 Última Atualização: ${row.ultima_atualizacao}\n`;
        if (row.situacao_at_ss) status += `   📋 Situação AT/SS: ${row.situacao_at_ss}\n`;
        if (row.estado) status += `   🏛️ Estado: ${row.estado}\n`;
        if (!row.ultima_atualizacao && !row.situacao_at_ss && !row.estado) {
          status += `   ⏳ Not checked yet\n`;
        }
        const added = new Date(row.created_at);
        const dd = String(added.getDate()).padStart(2, '0');
        const mm = String(added.getMonth() + 1).padStart(2, '0');
        const yyyy = added.getFullYear();
        status += `   Added: ${dd}-${mm}-${yyyy}\n\n`;
      });

      status += '🕐 Automatic checks at 10:00, 16:00 and 22:00 daily';
      await bot.sendMessage(chatId, status);
    } catch (err) {
      console.error('Error in /status:', err);
      await bot.sendMessage(chatId, '❌ Database error occurred');
    }
  });

  bot.onText(/\/check(?:@\w+)?$/, async (msg) => {
    const chatId = String(msg.chat.id);
    registerUser(chatId, msg.from.username, msg.from.first_name, msg.from.last_name);

    const now = Date.now();
    const last = lastCheckTime.get(chatId);
    if (last && now - last < CHECK_COOLDOWN_MS) {
      const remaining = Math.ceil((CHECK_COOLDOWN_MS - (now - last)) / 1000);
      await bot.sendMessage(chatId, `⏳ Please wait ${remaining} seconds before checking again.`);
      return;
    }
    lastCheckTime.set(chatId, now);

    try {
      const rows = await dbAll('SELECT * FROM monitored_urls WHERE chat_id = ?', [chatId]);

      if (rows.length === 0) {
        await bot.sendMessage(chatId, '❌ No URLs being monitored. Send me a URL first.');
        return;
      }

      await bot.sendMessage(chatId, `🔍 Checking ${rows.length} URL(s) now...`);

      for (const urlData of rows) {
        try {
          await checkSingleUrl(urlData);
        } catch (error) {
          console.error(`Unhandled error checking URL ${urlData.url} for chat ${urlData.chat_id}:`, error.message);
        }
        await new Promise(resolve => setTimeout(resolve, 1000));
      }

      await bot.sendMessage(chatId, '✅ Check completed!');
    } catch (err) {
      console.error('Error in /check:', err);
      await bot.sendMessage(chatId, '❌ Database error occurred');
    }
  });

  bot.onText(/\/remove(?:@\w+)?$/, async (msg) => {
    const chatId = String(msg.chat.id);
    registerUser(chatId, msg.from.username, msg.from.first_name, msg.from.last_name);

    if (pendingRemoves.has(chatId)) {
      await bot.sendMessage(chatId, '⏳ A remove operation is already in progress. Reply with a number or send "cancel" first.');
      return;
    }

    try {
      const rows = await dbAll('SELECT * FROM monitored_urls WHERE chat_id = ?', [chatId]);

      if (rows.length === 0) {
        await bot.sendMessage(chatId, '📭 No URLs being monitored.');
        return;
      }

      let message = '🗑️ Select URL to remove:\n\n';
      rows.forEach((row, index) => {
        message += `${index + 1}. ${formatUrlLabel(row.url, row.nome)}\n`;
      });
      message += '\nReply with the number (1, 2, etc.) or send "cancel"';

      await bot.sendMessage(chatId, message);
      pendingRemoves.add(chatId);

      const handler = async (response) => {
        if (String(response.chat.id) !== chatId) return;
        bot.removeListener('message', handler);
        clearTimeout(timeout);
        pendingRemoves.delete(chatId);

        if (response.text === 'cancel') {
          await bot.sendMessage(chatId, '❌ Cancelled');
          return;
        }

        const num = parseInt(response.text);
        if (num >= 1 && num <= rows.length) {
          const urlToRemove = rows[num - 1];
          try {
            await dbRun('DELETE FROM monitored_urls WHERE id = ?', [urlToRemove.id]);
            await bot.sendMessage(chatId, `✅ Removed URL from monitoring`);
          } catch (err) {
            console.error('Error removing URL:', err);
            await bot.sendMessage(chatId, '❌ Error removing URL');
          }
        } else {
          await bot.sendMessage(chatId, '❌ Invalid number');
        }
      };

      const timeout = setTimeout(() => {
        bot.removeListener('message', handler);
        pendingRemoves.delete(chatId);
        bot.sendMessage(chatId, '⏰ Remove operation timed out. Send /remove to try again.')
          .catch(err => console.error('Error sending timeout message:', err));
      }, 60000);

      bot.on('message', handler);
    } catch (err) {
      console.error('Error in /remove:', err);
      await bot.sendMessage(chatId, '❌ Database error occurred');
    }
  });

  bot.onText(/\/help(?:@\w+)?$/, async (msg) => {
    const chatId = String(msg.chat.id);
    const help = `🤖 AIMA Monitor Bot Commands:

📋 /status - Show your monitored URLs
🔍 /check - Check all your URLs now
🗑️ /remove - Remove a URL from monitoring
❓ /help - Show this help

📨 To start monitoring:
Send me the AIMA URL from your submission confirmation document (found in QR code). The bot monitors these fields at 10:00, 16:00 and 22:00 daily:
📅 Última Atualização
📋 Situação AT/SS
🏛️ Estado

⚠️ Only URLs from aima.gov.pt domain are accepted.
🔒 Your URLs are private - only you can see and manage them.`;

    await bot.sendMessage(chatId, help);
  });

  bot.on('message', async (msg) => {
    const chatId = String(msg.chat.id);
    const text = msg.text;

    if (!text || text.startsWith('/')) return;

    // Skip URL processing if this chat is in remove mode
    if (pendingRemoves.has(chatId)) return;

    registerUser(chatId, msg.from.username, msg.from.first_name, msg.from.last_name);

    if (text.startsWith('http://') || text.startsWith('https://')) {
      const url = text.trim();

      // Validate that URL is from AIMA domain
      try {
        isValidAimaUrl(url);
      } catch (err) {
        const msg = err instanceof TypeError
          ? '❌ Invalid URL format.\n\n📋 Please send a valid AIMA URL from your submission confirmation document (found in QR code).'
          : '❌ Invalid URL. Only URLs from aima.gov.pt domain are accepted.\n\n📋 Please send the AIMA URL from your submission confirmation document (found in QR code).';
        await bot.sendMessage(chatId, msg);
        return;
      }

      try {
        const countRow = await dbGet('SELECT COUNT(*) AS cnt FROM monitored_urls WHERE chat_id = ?', [chatId]);
        if (countRow.cnt >= MAX_URLS_PER_USER) {
          await bot.sendMessage(chatId, `❌ You have reached the maximum of ${MAX_URLS_PER_USER} monitored URLs. Remove one with /remove before adding more.`);
          return;
        }

        const result = await dbRun('INSERT OR IGNORE INTO monitored_urls (chat_id, url) VALUES (?, ?)', [chatId, url]);

        if (result.changes === 0) {
          await bot.sendMessage(chatId, '⚠️ This URL is already being monitored');
          return;
        }

        await bot.sendMessage(chatId, `✅ AIMA URL added to monitoring:\n${url}\n\n🔍 Checking now...`);

        const row = await dbGet('SELECT * FROM monitored_urls WHERE chat_id = ? AND url = ?', [chatId, url]);
        if (row) {
          await checkSingleUrl(row);
        }
      } catch (err) {
        console.error('Error adding URL:', err);
        await bot.sendMessage(chatId, '❌ Error adding URL to database');
      }
    }
  });
}

module.exports = { registerCommands, MAX_URLS_PER_USER, CHECK_COOLDOWN_MS };
