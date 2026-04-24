const cheerio = require('cheerio');
const { formatUrlLabel, extractFieldValue, isPedidoDeferido } = require('./scraper');
const { isLegacyPortalUrl } = require('./validate-url');

const APPROVED_RETENTION_MONTHS = 2;

function isBotBlocked(error) {
  return error && error.message && error.message.includes('bot was blocked by the user');
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

function createChecker({ bot, dbRun, dbAll, httpsAgent, fetcher }) {
  const fetch = fetcher || require('axios').get;

  async function removeAllUrlsForChat(chatId) {
    console.log(`Removing all monitored URLs for chat ${chatId} (bot was blocked)`);
    await dbRun('DELETE FROM monitored_urls WHERE chat_id = ?', [chatId]);
    return 'blocked';
  }

  async function autoRemoveAndNotify(urlData, logReason, message) {
    console.log(`Auto-removing ${logReason} for chat ${urlData.chat_id}: ${urlData.url}`);
    await dbRun('DELETE FROM monitored_urls WHERE id = ?', [urlData.id]);
    try {
      await bot.sendMessage(urlData.chat_id, message);
    } catch (sendError) {
      if (isBotBlocked(sendError)) return removeAllUrlsForChat(urlData.chat_id);
      console.error(`Failed to send auto-remove notification to chat ${urlData.chat_id}:`, sendError.message);
    }
    return 'skipped';
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

      console.log(`Checking URL for user ${urlData.chat_id}: ${urlData.url}`);

      const response = await fetch(urlData.url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
        },
        timeout: 30000,
        httpsAgent
      });

      const $ = cheerio.load(response.data);

      const nome = $('span#P72_NOME_DISPLAY').text().trim() || null;

      const currentValues = {
        ultima_atualizacao: extractFieldValue($, 'Última Atualização'),
        situacao_at_ss: extractFieldValue($, 'Situação AT/SS'),
        estado: extractFieldValue($, 'Estado')
      };

      console.log(`Current values for ${urlData.url}:`, currentValues);

      const allCurrentNull = !currentValues.ultima_atualizacao && !currentValues.situacao_at_ss &&
                             !currentValues.estado;

      const changes = [];
      let hasChanges = false;

      if (urlData.ultima_atualizacao === null && urlData.situacao_at_ss === null &&
          urlData.estado === null) {

        if (allCurrentNull) {
          await bot.sendMessage(urlData.chat_id,
            `⚠️ Could not extract data from URL:\n${formatUrlLabel(urlData.url, nome)}\n\nThe page loaded but no tracking fields were found. Please verify the URL is correct.`);
          return;
        }

        await dbRun(`UPDATE monitored_urls SET
                  ultima_atualizacao = ?, situacao_at_ss = ?,
                  estado = ?, nome = ?,
                  updated_at = CURRENT_TIMESTAMP
                WHERE id = ?`,
          [currentValues.ultima_atualizacao, currentValues.situacao_at_ss,
           currentValues.estado, nome || urlData.nome, urlData.id]);

        console.log('Initial values set');

        let message = `🤖 Started monitoring URL:\n${formatUrlLabel(urlData.url, nome)}\n\nCurrent values:\n`;
        if (currentValues.ultima_atualizacao) message += `📅 Última Atualização: ${currentValues.ultima_atualizacao}\n`;
        if (currentValues.situacao_at_ss) message += `📋 Situação AT/SS: ${currentValues.situacao_at_ss}\n`;
        if (currentValues.estado) message += `🏛️ Estado: ${currentValues.estado}\n`;

        await bot.sendMessage(urlData.chat_id, message);
        return;
      }

      if (urlData.ultima_atualizacao !== currentValues.ultima_atualizacao && currentValues.ultima_atualizacao !== null) {
        changes.push(`📅 Última Atualização: ${urlData.ultima_atualizacao || 'N/A'} → ${currentValues.ultima_atualizacao}`);
        hasChanges = true;
      }

      if (urlData.situacao_at_ss !== currentValues.situacao_at_ss && currentValues.situacao_at_ss !== null) {
        changes.push(`📋 Situação AT/SS: ${urlData.situacao_at_ss || 'N/A'} → ${currentValues.situacao_at_ss}`);
        hasChanges = true;
      }

      if (urlData.estado !== currentValues.estado && currentValues.estado !== null) {
        changes.push(`🏛️ Estado: ${urlData.estado || 'N/A'} → ${currentValues.estado}`);
        hasChanges = true;
      }

      if (hasChanges) {
        console.log('Changes detected!');

        await dbRun(`UPDATE monitored_urls SET
                  ultima_atualizacao = ?, situacao_at_ss = ?,
                  estado = ?, nome = ?,
                  updated_at = CURRENT_TIMESTAMP
                WHERE id = ?`,
          [currentValues.ultima_atualizacao, currentValues.situacao_at_ss,
           currentValues.estado, nome || urlData.nome, urlData.id]);

        const message = `🚨 CHANGES DETECTED!\n\n${formatUrlLabel(urlData.url, nome || urlData.nome)}\n\n${changes.join('\n\n')}`;
        await bot.sendMessage(urlData.chat_id, message);
      } else {
        console.log(`No changes detected for ${urlData.url}`);
        if (nome && !urlData.nome) {
          await dbRun(`UPDATE monitored_urls SET nome = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
            [nome, urlData.id]);
        }
      }

    } catch (error) {
      if (isBotBlocked(error)) {
        return removeAllUrlsForChat(urlData.chat_id);
      }

      console.error(`Error checking ${urlData.url}:`, error.message);

      let errorMsg = `⚠️ Error checking URL:\n${formatUrlLabel(urlData.url, urlData.nome)}\n\n`;
      if (error.response) {
        console.error('Response status:', error.response.status);
        errorMsg += `HTTP Error: ${error.response.status}`;
      } else if (error.code === 'ECONNABORTED') {
        errorMsg += 'Request timed out';
      } else {
        errorMsg += `Error: ${error.message}`;
      }

      try {
        await bot.sendMessage(urlData.chat_id, errorMsg);
      } catch (sendError) {
        if (isBotBlocked(sendError)) {
          return removeAllUrlsForChat(urlData.chat_id);
        }
        console.error(`Failed to send error notification to chat ${urlData.chat_id}:`, sendError.message);
      }
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
          console.log(`Skipping URL for blocked chat ${urlData.chat_id}: ${urlData.url}`);
          continue;
        }
        let result;
        try {
          result = await checkSingleUrl(urlData);
          if (result === 'blocked') {
            blockedChats.add(urlData.chat_id);
          }
        } catch (error) {
          console.error(`Unhandled error checking URL ${urlData.url} for chat ${urlData.chat_id}:`, error.message);
        }
        if (result !== 'skipped') {
          await new Promise(resolve => setTimeout(resolve, 1000));
        }
      }
    } finally {
      checkRunning = false;
    }
  }

  return { checkSingleUrl, checkAllUrls };
}

module.exports = { createChecker, isBotBlocked, isApprovedAndStale, APPROVED_RETENTION_MONTHS };
