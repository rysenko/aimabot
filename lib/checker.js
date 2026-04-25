const cheerio = require('cheerio');
const { formatUrlLabel, extractFieldValue, isPedidoDeferido } = require('./scraper');
const { isLegacyPortalUrl } = require('./validate-url');

const APPROVED_RETENTION_MONTHS = 2;
const RATE_LIMIT_MS = 1000;
const DEBUG = process.env.DEBUG === 'true';

const RESULT_BLOCKED = 'blocked';
const RESULT_SKIPPED = 'skipped';

const FIELDS = [
  { key: 'ultima_atualizacao', label: '📅 Última Atualização' },
  { key: 'situacao_at_ss',     label: '📋 Situação AT/SS' },
  { key: 'estado',             label: '🏛️ Estado' },
];

const FIELD_NAMES = {
  ultima_atualizacao: 'Última Atualização',
  situacao_at_ss: 'Situação AT/SS',
  estado: 'Estado',
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function isBotBlocked(error) {
  return !!(error && error.message && error.message.includes('bot was blocked by the user'));
}

function isApprovedAndStale(estado, updatedAt, now = new Date()) {
  if (!isPedidoDeferido(estado)) return false;
  if (!updatedAt) return false;
  const updated = new Date(updatedAt);
  if (isNaN(updated.getTime())) return false;
  const threshold = new Date(now);
  threshold.setMonth(threshold.getMonth() - APPROVED_RETENTION_MONTHS);
  return updated <= threshold;
}

function formatFetchError(error) {
  if (error.response) return `HTTP Error: ${error.response.status}`;
  if (error.code === 'ECONNABORTED') return 'Request timed out';
  return `Error: ${error.message}`;
}

function createChecker({ bot, dbRun, dbAll, httpsAgent, fetcher }) {
  const fetch = fetcher || require('axios').get;

  async function removeAllForChat(chatId) {
    console.log(`Removing all monitored URLs for chat ${chatId} (bot was blocked)`);
    await dbRun('DELETE FROM monitored_urls WHERE chat_id = ?', [chatId]);
    return RESULT_BLOCKED;
  }

  async function safeSend(chatId, message) {
    try {
      await bot.sendMessage(chatId, message);
      return 'sent';
    } catch (err) {
      if (isBotBlocked(err)) return removeAllForChat(chatId);
      console.error(`Failed to send notification to chat ${chatId}:`, err.message);
      return 'failed';
    }
  }

  // Returns RESULT_BLOCKED iff the user has blocked the bot, otherwise undefined.
  // Lets checkAllUrls skip remaining URLs for a blocked chat.
  async function notify(chatId, message) {
    return (await safeSend(chatId, message)) === RESULT_BLOCKED ? RESULT_BLOCKED : undefined;
  }

  function updateUrlValues(id, currentValues, nome) {
    return dbRun(
      `UPDATE monitored_urls SET
         ultima_atualizacao = ?, situacao_at_ss = ?, estado = ?, nome = ?,
         updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
      [currentValues.ultima_atualizacao, currentValues.situacao_at_ss,
       currentValues.estado, nome, id]
    );
  }

  async function autoRemoveAndNotify(urlData, logReason, message) {
    console.log(`Auto-removing ${logReason} for chat ${urlData.chat_id} (id=${urlData.id})`);
    await dbRun('DELETE FROM monitored_urls WHERE id = ?', [urlData.id]);
    const sendResult = await safeSend(urlData.chat_id, message);
    return sendResult === RESULT_BLOCKED ? RESULT_BLOCKED : RESULT_SKIPPED;
  }

  async function checkSingleUrl(urlData) {
    try {
      if (isLegacyPortalUrl(urlData.url)) {
        const label = formatUrlLabel(urlData.url, urlData.nome);
        return autoRemoveAndNotify(urlData, 'legacy portal URL',
          `⚠️ Removed from monitoring — legacy portal URL:\n${label}\n\nThis URL is from the older AIMA portal (services.aima.gov.pt) which is no longer supported. Please send the URL from the new portal (portal-renovacoes.aima.gov.pt), typically found in the QR code of your latest submission confirmation.`);
      }

      if (isApprovedAndStale(urlData.estado, urlData.updated_at)) {
        const label = formatUrlLabel(urlData.url, urlData.nome);
        return autoRemoveAndNotify(urlData, 'approved URL',
          `✅ Approved request auto-removed from monitoring:\n${label}\n\n🎉 Estado: ${urlData.estado}\n📅 Última Atualização: ${urlData.ultima_atualizacao}\n\nThis request has been approved for more than ${APPROVED_RETENTION_MONTHS} months with no further updates, so monitoring has been stopped. Congratulations! 🎊`);
      }

      if (DEBUG) console.log(`Checking URL for user ${urlData.chat_id}: ${urlData.url}`);
      else console.log(`Checking URL id=${urlData.id} for user ${urlData.chat_id}`);

      const response = await fetch(urlData.url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
        },
        timeout: 30000,
        httpsAgent
      });

      const $ = cheerio.load(response.data);
      const nome = $('span#P72_NOME_DISPLAY').text().trim() || null;

      const currentValues = {};
      for (const { key } of FIELDS) {
        currentValues[key] = extractFieldValue($, FIELD_NAMES[key]);
      }

      if (DEBUG) console.log(`Current values for ${urlData.url}:`, currentValues);

      const isFirstCheck = FIELDS.every(({ key }) => urlData[key] === null);
      const allCurrentNull = FIELDS.every(({ key }) => !currentValues[key]);

      if (isFirstCheck) {
        if (allCurrentNull) {
          return notify(urlData.chat_id,
            `⚠️ Could not extract data from URL:\n${formatUrlLabel(urlData.url, nome)}\n\nThe page loaded but no tracking fields were found. Please verify the URL is correct.`);
        }

        await updateUrlValues(urlData.id, currentValues, nome || urlData.nome);
        console.log('Initial values set');

        let message = `🤖 Started monitoring URL:\n${formatUrlLabel(urlData.url, nome)}\n\nCurrent values:\n`;
        for (const { key, label } of FIELDS) {
          if (currentValues[key]) message += `${label}: ${currentValues[key]}\n`;
        }
        return notify(urlData.chat_id, message);
      }

      const changes = [];
      for (const { key, label } of FIELDS) {
        if (urlData[key] !== currentValues[key] && currentValues[key] !== null) {
          changes.push(`${label}: ${urlData[key] || 'N/A'} → ${currentValues[key]}`);
        }
      }

      if (changes.length > 0) {
        console.log('Changes detected!');
        await updateUrlValues(urlData.id, currentValues, nome || urlData.nome);
        return notify(urlData.chat_id,
          `🚨 CHANGES DETECTED!\n\n${formatUrlLabel(urlData.url, nome || urlData.nome)}\n\n${changes.join('\n\n')}`);
      } else {
        if (DEBUG) console.log(`No changes detected for ${urlData.url}`);
        if (nome && !urlData.nome) {
          await dbRun(`UPDATE monitored_urls SET nome = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
            [nome, urlData.id]);
        }
      }

    } catch (error) {
      if (isBotBlocked(error)) return removeAllForChat(urlData.chat_id);

      if (DEBUG) console.error(`Error checking ${urlData.url}:`, error.message);
      else console.error(`Error checking URL id=${urlData.id} for chat ${urlData.chat_id}:`, error.message);

      if (error.response) console.error('Response status:', error.response.status);

      return notify(urlData.chat_id,
        `⚠️ Error checking URL:\n${formatUrlLabel(urlData.url, urlData.nome)}\n\n${formatFetchError(error)}`);
    }
  }

  let checkRunning = false;

  async function checkAllUrls() {
    if (checkRunning) {
      console.log('checkAllUrls already running, skipping');
      return;
    }
    checkRunning = true;
    try {
      const rows = await dbAll('SELECT * FROM monitored_urls');
      console.log(`Checking ${rows.length} monitored URLs`);

      const blockedChats = new Set();

      for (const urlData of rows) {
        if (blockedChats.has(urlData.chat_id)) {
          if (DEBUG) console.log(`Skipping URL for blocked chat ${urlData.chat_id}: ${urlData.url}`);
          continue;
        }
        let result;
        try {
          result = await checkSingleUrl(urlData);
          if (result === RESULT_BLOCKED) blockedChats.add(urlData.chat_id);
        } catch (error) {
          console.error(`Unhandled error checking URL id=${urlData.id} for chat ${urlData.chat_id}:`, error.message);
        }
        // Sequential pacing throttles outbound requests to the AIMA portal.
        if (result !== RESULT_SKIPPED) await sleep(RATE_LIMIT_MS);
      }
    } finally {
      checkRunning = false;
    }
  }

  return { checkSingleUrl, checkAllUrls };
}

module.exports = { createChecker, isBotBlocked, isApprovedAndStale, APPROVED_RETENTION_MONTHS };