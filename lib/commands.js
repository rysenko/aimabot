const { isValidAimaUrl, LegacyPortalError } = require('./validate-url');
const { formatUrlLabel } = require('./scraper');

const MAX_URLS_PER_USER = 50;
const CHECK_COOLDOWN_MS = 300_000;
const RATE_LIMIT_MS = 1000;
const REMOVE_TIMEOUT_MS = 60_000;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function formatDateDDMMYYYY(d) {
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  return `${dd}-${mm}-${d.getFullYear()}`;
}

function urlRejectionMessage(err) {
  if (err instanceof TypeError) {
    return '❌ Invalid URL format.\n\n📋 Please send a valid AIMA URL from your submission confirmation document (found in QR code).';
  }
  if (err instanceof LegacyPortalError) {
    return '❌ This URL is from the older AIMA portal (services.aima.gov.pt) and is no longer supported.\n\n📋 Please send the URL from the new portal (portal-renovacoes.aima.gov.pt), typically found in the QR code of your latest submission confirmation.';
  }
  return '❌ Invalid URL. Only URLs from aima.gov.pt domain are accepted.\n\n📋 Please send the AIMA URL from your submission confirmation document (found in QR code).';
}

function registerCommands({ bot, dbAll, dbRun, dbGet, registerUser, checkSingleUrl }) {
  const pendingRemoves = new Map(); // chatId → { rows, timeout }
  const lastCheckTime = new Map();

  const onCommand = (regex, fn) => bot.onText(regex, async (msg) => {
    const chatId = String(msg.chat.id);
    registerUser(chatId, msg.from.username, msg.from.first_name, msg.from.last_name);
    await fn(msg, chatId);
  });

  onCommand(/\/start(?:@\w+)?$/, async (msg, chatId) => {
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

  onCommand(/\/status(?:@\w+)?$/, async (msg, chatId) => {
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
        status += `   Added: ${formatDateDDMMYYYY(new Date(row.created_at))}\n\n`;
      });

      status += '🕐 Automatic checks at 10:00, 16:00 and 22:00 daily';
      await bot.sendMessage(chatId, status);
    } catch (err) {
      console.error('Error in /status:', err);
      await bot.sendMessage(chatId, '❌ Database error occurred');
    }
  });

  onCommand(/\/check(?:@\w+)?$/, async (msg, chatId) => {
    const now = Date.now();
    const last = lastCheckTime.get(chatId);
    if (last && now - last < CHECK_COOLDOWN_MS) {
      const remaining = Math.ceil((CHECK_COOLDOWN_MS - (now - last)) / 1000);
      await bot.sendMessage(chatId, `⏳ Please wait ${remaining} seconds before checking again.`);
      return;
    }
    lastCheckTime.set(chatId, now);
    setTimeout(() => {
      if (lastCheckTime.get(chatId) === now) lastCheckTime.delete(chatId);
    }, CHECK_COOLDOWN_MS).unref?.();

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
        await sleep(RATE_LIMIT_MS);
      }

      await bot.sendMessage(chatId, '✅ Check completed!');
    } catch (err) {
      console.error('Error in /check:', err);
      await bot.sendMessage(chatId, '❌ Database error occurred');
    }
  });

  onCommand(/\/remove(?:@\w+)?$/, async (msg, chatId) => {
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

      const timeout = setTimeout(() => {
        if (!pendingRemoves.delete(chatId)) return;
        bot.sendMessage(chatId, '⏰ Remove operation timed out. Send /remove to try again.')
          .catch((e) => console.error('Error sending timeout message:', e));
      }, REMOVE_TIMEOUT_MS);
      pendingRemoves.set(chatId, { rows, timeout });
    } catch (err) {
      console.error('Error in /remove:', err);
      await bot.sendMessage(chatId, '❌ Database error occurred');
    }
  });

  onCommand(/\/help(?:@\w+)?$/, async (msg, chatId) => {
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

  async function handleRemoveResponse(chatId, text) {
    const pending = pendingRemoves.get(chatId);
    if (!pending) return;
    clearTimeout(pending.timeout);
    pendingRemoves.delete(chatId);

    if (text === 'cancel') {
      await bot.sendMessage(chatId, '❌ Cancelled');
      return;
    }

    const num = parseInt(text);
    if (!(num >= 1 && num <= pending.rows.length)) {
      await bot.sendMessage(chatId, '❌ Invalid number');
      return;
    }

    try {
      await dbRun('DELETE FROM monitored_urls WHERE id = ?', [pending.rows[num - 1].id]);
      await bot.sendMessage(chatId, `✅ Removed URL from monitoring`);
    } catch (err) {
      console.error('Error removing URL:', err);
      await bot.sendMessage(chatId, '❌ Error removing URL');
    }
  }

  async function handleNewUrl(chatId, url) {
    try {
      isValidAimaUrl(url);
    } catch (err) {
      await bot.sendMessage(chatId, urlRejectionMessage(err));
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

      await checkSingleUrl({
        id: result.lastID,
        chat_id: chatId,
        url,
        nome: null,
        ultima_atualizacao: null,
        situacao_at_ss: null,
        estado: null,
        updated_at: null,
      });
    } catch (err) {
      console.error('Error adding URL:', err);
      await bot.sendMessage(chatId, '❌ Error adding URL to database');
    }
  }

  bot.on('message', async (msg) => {
    const chatId = String(msg.chat.id);
    const text = msg.text;
    if (!text || text.startsWith('/')) return;

    if (pendingRemoves.has(chatId)) {
      await handleRemoveResponse(chatId, text);
      return;
    }

    registerUser(chatId, msg.from.username, msg.from.first_name, msg.from.last_name);

    if (text.startsWith('http://') || text.startsWith('https://')) {
      await handleNewUrl(chatId, text.trim());
    }
  });
}

module.exports = { registerCommands, MAX_URLS_PER_USER, CHECK_COOLDOWN_MS };
