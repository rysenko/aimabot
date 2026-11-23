const {
  isValidAimaUrl,
  extractUrls,
  startsWithUrl,
  LegacyPortalError,
  TrackingPortalError,
  AuthenticatedLinkError,
} = require('./validate-url');
const { formatUrlLabel } = require('./scraper');
const { PORTAL_FIELDS, TRACKING_FIELDS, fieldsForUrl } = require('./fields');

const PORTAL_LABELS = PORTAL_FIELDS.map(({ label }) => label).join('\n');
const TRACKING_LABELS = TRACKING_FIELDS.map(({ label }) => label).join('\n');

const MAX_URLS_PER_USER = 50;
const CHECK_COOLDOWN_MS = 300_000;
const RATE_LIMIT_MS = 1000;
const REMOVE_TIMEOUT_MS = 60_000;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Matches "/name", "/name@bot" and "/name <anything>"; the argument is captured.
// Users routinely type a command and paste a link after it in the same message.
function commandPattern(name) {
  return new RegExp(`^\\/${name}(?:@\\w+)?(?:\\s+([\\s\\S]*))?$`, 'i');
}

function commandName(text) {
  const m = /^\/(\w+)/.exec(text);
  return m ? m[1].toLowerCase() : null;
}

const SEND_LINK_PLAIN_HINT = 'ℹ️ To add a link to monitoring, send it as a plain message, without a command in front.';

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
  if (err instanceof TrackingPortalError) {
    return '❌ On contactenos.aima.gov.pt I can only monitor process/card tracking pages.\n\n📋 Please send the tracking link itself, which looks like:\nhttps://contactenos.aima.gov.pt/tracking/00000000-0000-0000-0000-000000000000';
  }
  if (err instanceof AuthenticatedLinkError) {
    return '❌ This link is tied to your logged-in portal session, so I can\'t open it — it stops working once your session ends.\n\n📋 Please send the public URL from the QR code on your submission confirmation document instead. It looks like:\nhttps://portal-renovacoes.aima.gov.pt/ords/r/aima/aima-pr/validar?...';
  }
  return '❌ Invalid URL. Only URLs from aima.gov.pt domain are accepted.\n\n📋 Please send the AIMA URL from your submission confirmation document (found in QR code).';
}

function registerCommands({ bot, dbAll, dbRun, dbGet, registerUser, checkSingleUrl }) {
  const pendingRemoves = new Map(); // chatId → { rows, timeout }
  const lastCheckTime = new Map();
  const commandNames = new Set(); // filled by onCommand; anything else is "unknown"

  const trackUser = (chatId, { from }) =>
    registerUser(chatId, from.username, from.first_name, from.last_name);

  // Same order everywhere, so "/remove <n>" removes the n-th row /status shows.
  const listUrls = (chatId) =>
    dbAll('SELECT * FROM monitored_urls WHERE chat_id = ? ORDER BY id', [chatId]);

  // `fn` receives the text after the command. Commands that don't take an argument
  // still run, and if a link was pasted after them the user is told how to add it.
  const onCommand = (name, fn, takesArgs = false) => {
    commandNames.add(name);
    bot.onText(commandPattern(name), async (msg, match) => {
      const chatId = String(msg.chat.id);
      trackUser(chatId, msg);
      const args = (match[1] ?? '').trim();
      await fn(msg, chatId, args);
      if (!takesArgs && extractUrls(args).length > 0) {
        await bot.sendMessage(chatId, SEND_LINK_PLAIN_HINT);
      }
    });
  };

  function cancelPendingRemove(chatId) {
    const pending = pendingRemoves.get(chatId);
    if (!pending) return false;
    clearTimeout(pending.timeout);
    pendingRemoves.delete(chatId);
    return true;
  }

  onCommand('start', async (msg, chatId) => {
    const welcome = `👋 Welcome to AIMA Monitor Bot!

🤖 I can monitor two kinds of AIMA links:

1️⃣ Renewals portal (portal-renovacoes.aima.gov.pt), from the QR code of your submission confirmation:
${PORTAL_LABELS}

2️⃣ Process/card tracking (contactenos.aima.gov.pt/tracking/...):
${TRACKING_LABELS}

📋 Commands:
/status - Show your monitored URLs
/check - Check all your URLs now
/remove - Remove a URL from monitoring
/help - Show this help

📨 To start monitoring, just send me the link. It must be from the aima.gov.pt domain.`;

    await bot.sendMessage(chatId, welcome);
  });

  onCommand('status', async (msg, chatId) => {
    try {
      const rows = await listUrls(chatId);

      if (rows.length === 0) {
        await bot.sendMessage(chatId, '📭 No URLs being monitored.\nSend me a URL to start monitoring!');
        return;
      }

      let status = `📊 Your monitored URLs (${rows.length}):\n\n`;
      rows.forEach((row, index) => {
        status += `${index + 1}. ${formatUrlLabel(row.url, row.nome)}\n`;
        const shown = fieldsForUrl(row.url).filter(({ key }) => row[key]);
        for (const { key, label } of shown) status += `   ${label}: ${row[key]}\n`;
        if (shown.length === 0) status += `   ⏳ Not checked yet\n`;
        status += `   Added: ${formatDateDDMMYYYY(new Date(row.created_at))}\n\n`;
      });

      status += '🕐 Automatic checks at 10:00, 16:00 and 22:00 daily';
      await bot.sendMessage(chatId, status);
    } catch (err) {
      console.error('Error in /status:', err);
      await bot.sendMessage(chatId, '❌ Database error occurred');
    }
  });

  onCommand('check', async (msg, chatId) => {
    try {
      const rows = await listUrls(chatId);

      if (rows.length === 0) {
        await bot.sendMessage(chatId, '❌ No URLs being monitored. Send me a URL first.');
        return;
      }

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

  // "/remove <link>" or "/remove <n>" removes directly, without the pick-a-number step.
  async function removeDirectly(chatId, args) {
    cancelPendingRemove(chatId);

    const urls = extractUrls(args);
    if (urls.length > 0) {
      let removed = 0;
      for (const url of urls) {
        // Substring match only for legacy glued rows (two schemes), so a link can't
        // take out a different one that merely starts with it.
        const result = await dbRun(
          `DELETE FROM monitored_urls WHERE chat_id = ?
             AND (url = ? OR (instr(url, ?) > 0 AND url LIKE '%://%://%'))`,
          [chatId, url, url]
        );
        removed += result.changes;
      }
      await bot.sendMessage(chatId, removed > 0
        ? `✅ Removed ${removed} URL(s) from monitoring`
        : '❌ This link is not in your monitoring list. Send /status to see your links or /remove to pick one from the list.');
      return;
    }

    await removeByIndex(chatId, await listUrls(chatId), args);
  }

  // `answer` is the user's 1-based pick from `rows` (as listed by /status and /remove).
  async function removeByIndex(chatId, rows, answer) {
    const num = /^\d+$/.test(answer) ? parseInt(answer, 10) : NaN;
    if (!(num >= 1 && num <= rows.length)) {
      await bot.sendMessage(chatId, '❌ Invalid number. Send /remove to see the list.');
      return;
    }
    await dbRun('DELETE FROM monitored_urls WHERE id = ?', [rows[num - 1].id]);
    await bot.sendMessage(chatId, '✅ Removed URL from monitoring');
  }

  onCommand('remove', async (msg, chatId, args) => {
    if (args) {
      try {
        await removeDirectly(chatId, args);
      } catch (err) {
        console.error('Error in /remove:', err);
        await bot.sendMessage(chatId, '❌ Error removing URL');
      }
      return;
    }

    if (pendingRemoves.has(chatId)) {
      await bot.sendMessage(chatId, '⏳ A remove operation is already in progress. Reply with a number or send /cancel first.');
      return;
    }

    try {
      const rows = await listUrls(chatId);

      if (rows.length === 0) {
        await bot.sendMessage(chatId, '📭 No URLs being monitored.');
        return;
      }

      let message = '🗑️ Select URL to remove:\n\n';
      rows.forEach((row, index) => {
        message += `${index + 1}. ${formatUrlLabel(row.url, row.nome)}\n`;
      });
      message += '\nReply with the number (1, 2, etc.) or send /cancel';

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
  }, true);

  onCommand('cancel', async (msg, chatId) => {
    await bot.sendMessage(chatId, cancelPendingRemove(chatId) ? '❌ Cancelled' : 'ℹ️ Nothing to cancel.');
  });

  onCommand('help', async (msg, chatId) => {
    const help = `🤖 AIMA Monitor Bot Commands:

📋 /status - Show your monitored URLs
🔍 /check - Check all your URLs now
🗑️ /remove - Remove a URL from monitoring (or /remove <link>)
❓ /help - Show this help

📨 To start monitoring, send me either link as a plain message, without a command. The bot checks them at 10:00, 16:00 and 22:00 daily.

🔗 Renewals portal (portal-renovacoes.aima.gov.pt, from the QR code on your submission confirmation):
${PORTAL_LABELS}

🔗 Process/card tracking (contactenos.aima.gov.pt/tracking/...):
${TRACKING_LABELS}

⚠️ Only URLs from aima.gov.pt domain are accepted.
🔒 Your URLs are private - only you can see and manage them.`;

    await bot.sendMessage(chatId, help);
  });

  async function handleRemoveResponse(chatId, text) {
    const pending = pendingRemoves.get(chatId);
    if (!pending) return;
    cancelPendingRemove(chatId);

    const answer = text.trim();
    if (answer.toLowerCase() === 'cancel') {
      await bot.sendMessage(chatId, '❌ Cancelled');
      return;
    }

    try {
      await removeByIndex(chatId, pending.rows, answer);
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

  // A plain (non-command) message that starts with a link adds every link in it.
  async function handlePlainLinks(chatId, msg) {
    if (!startsWithUrl(msg.text)) return;
    for (const url of extractUrls(msg.text)) {
      await handleNewUrl(chatId, url);
    }
  }

  bot.on('message', async (msg) => {
    const chatId = String(msg.chat.id);
    const text = msg.text;
    if (!text) return;

    if (text.startsWith('/')) {
      // Known commands are handled by their onText handlers.
      if (commandNames.has(commandName(text))) return;
      await bot.sendMessage(chatId, extractUrls(text).length > 0
        ? `❓ Unknown command. ${SEND_LINK_PLAIN_HINT}`
        : '❓ Unknown command. Send /help to see what I can do.');
      return;
    }

    if (pendingRemoves.has(chatId)) {
      await handleRemoveResponse(chatId, text);
      return;
    }

    trackUser(chatId, msg);
    await handlePlainLinks(chatId, msg);
  });

  // Telegram delivers edits separately and onText never sees them. A message edited
  // into a plain link (e.g. "/status <link>" with the command deleted) should still count.
  bot.on('edited_message', async (msg) => {
    const chatId = String(msg.chat.id);
    if (!msg.text || pendingRemoves.has(chatId)) return;
    await handlePlainLinks(chatId, msg);
  });
}

module.exports = { registerCommands, commandPattern, MAX_URLS_PER_USER, CHECK_COOLDOWN_MS };
