const { describe, it, beforeEach, afterEach, mock } = require('node:test');
const assert = require('node:assert/strict');
const { openDatabase } = require('../lib/db');
const { createChecker, isBotBlocked } = require('../lib/checker');

// HTML fixture helpers
function makeHtml({ nome, validado, lastUpdated, estado } = {}) {
  let html = '<html><body>';
  if (nome) html += `<span id="P72_NOME_DISPLAY">${nome}</span>`;
  if (validado !== undefined) html += `<input id="P72_VALIDADO" value="${validado}">`;
  if (lastUpdated) html += `<span id="P72_LAST_UPDATED_AT_DISPLAY">${lastUpdated}</span>`;
  if (estado !== undefined) html += `<input id="P72_ESTADO_1" value="${estado}">`;
  html += '</body></html>';
  return html;
}

let db;
let sendMessage;

beforeEach(async () => {
  db = await openDatabase(':memory:');
  sendMessage = mock.fn(async () => {});
});

afterEach(async () => {
  if (db) {
    await db.close();
    db = null;
  }
});

describe('checkSingleUrl', () => {
  it('stores initial values and sends monitoring message on first check', async () => {
    const html = makeHtml({ nome: 'João', validado: 'Sim', lastUpdated: '2024-02-20', estado: 'Ativo' });
    const fetcher = mock.fn(async () => ({ data: html }));
    const bot = { sendMessage };

    const { checkSingleUrl } = createChecker({ bot, dbRun: db.dbRun, dbAll: db.dbAll, fetcher });

    await db.dbRun('INSERT INTO monitored_urls (chat_id, url) VALUES (?, ?)', ['1', 'https://aima.gov.pt/test']);
    const row = await db.dbGet('SELECT * FROM monitored_urls WHERE chat_id = ?', ['1']);

    await checkSingleUrl(row);

    assert.equal(sendMessage.mock.callCount(), 1);
    const msg = sendMessage.mock.calls[0].arguments[1];
    assert.ok(msg.includes('Started monitoring'));
    assert.ok(msg.includes('João'));

    // Verify DB was updated
    const updated = await db.dbGet('SELECT * FROM monitored_urls WHERE id = ?', [row.id]);
    assert.equal(updated.situacao_at_ss, 'Sim');
    assert.equal(updated.estado, 'Ativo');
    assert.equal(updated.nome, 'João');
  });

  it('warns when page has no extractable data on first check', async () => {
    const html = '<html><body><p>Empty page</p></body></html>';
    const fetcher = mock.fn(async () => ({ data: html }));
    const bot = { sendMessage };

    const { checkSingleUrl } = createChecker({ bot, dbRun: db.dbRun, dbAll: db.dbAll, fetcher });

    await db.dbRun('INSERT INTO monitored_urls (chat_id, url) VALUES (?, ?)', ['1', 'https://aima.gov.pt/test']);
    const row = await db.dbGet('SELECT * FROM monitored_urls WHERE chat_id = ?', ['1']);

    await checkSingleUrl(row);

    assert.equal(sendMessage.mock.callCount(), 1);
    const msg = sendMessage.mock.calls[0].arguments[1];
    assert.ok(msg.includes('Could not extract data'));
  });

  it('notifies on field changes', async () => {
    const html = makeHtml({ validado: 'Novo', lastUpdated: '2024-03-01', estado: 'Ativo' });
    const fetcher = mock.fn(async () => ({ data: html }));
    const bot = { sendMessage };

    const { checkSingleUrl } = createChecker({ bot, dbRun: db.dbRun, dbAll: db.dbAll, fetcher });

    // Insert with existing values (not first check)
    await db.dbRun(
      `INSERT INTO monitored_urls (chat_id, url, ultima_atualizacao, situacao_at_ss, estado)
       VALUES (?, ?, ?, ?, ?)`,
      ['1', 'https://aima.gov.pt/test', '2024-01-01', 'Antigo', 'Inativo']
    );
    const row = await db.dbGet('SELECT * FROM monitored_urls WHERE chat_id = ?', ['1']);

    await checkSingleUrl(row);

    assert.equal(sendMessage.mock.callCount(), 1);
    const msg = sendMessage.mock.calls[0].arguments[1];
    assert.ok(msg.includes('CHANGES DETECTED'));
    assert.ok(msg.includes('Antigo'));
    assert.ok(msg.includes('Novo'));
  });

  it('is silent when no changes detected', async () => {
    const html = makeHtml({ validado: 'Sim', lastUpdated: '2024-02-20', estado: 'Ativo' });
    const fetcher = mock.fn(async () => ({ data: html }));
    const bot = { sendMessage };

    const { checkSingleUrl } = createChecker({ bot, dbRun: db.dbRun, dbAll: db.dbAll, fetcher });

    await db.dbRun(
      `INSERT INTO monitored_urls (chat_id, url, ultima_atualizacao, situacao_at_ss, estado)
       VALUES (?, ?, ?, ?, ?)`,
      ['1', 'https://aima.gov.pt/test', '2024-02-20', 'Sim', 'Ativo']
    );
    const row = await db.dbGet('SELECT * FROM monitored_urls WHERE chat_id = ?', ['1']);

    await checkSingleUrl(row);

    assert.equal(sendMessage.mock.callCount(), 0);
  });

  it('ignores null current values (does not report as change)', async () => {
    // Page returns empty values for some fields
    const html = makeHtml({ validado: '', lastUpdated: '2024-02-20', estado: 'Ativo' });
    const fetcher = mock.fn(async () => ({ data: html }));
    const bot = { sendMessage };

    const { checkSingleUrl } = createChecker({ bot, dbRun: db.dbRun, dbAll: db.dbAll, fetcher });

    await db.dbRun(
      `INSERT INTO monitored_urls (chat_id, url, ultima_atualizacao, situacao_at_ss, estado)
       VALUES (?, ?, ?, ?, ?)`,
      ['1', 'https://aima.gov.pt/test', '2024-02-20', 'Sim', 'Ativo']
    );
    const row = await db.dbGet('SELECT * FROM monitored_urls WHERE chat_id = ?', ['1']);

    await checkSingleUrl(row);

    // situacao_at_ss is null (empty input) — should not be reported
    assert.equal(sendMessage.mock.callCount(), 0);
  });

  it('sends HTTP error message on response error', async () => {
    const error = new Error('Request failed');
    error.response = { status: 500 };
    const fetcher = mock.fn(async () => { throw error; });
    const bot = { sendMessage };

    const { checkSingleUrl } = createChecker({ bot, dbRun: db.dbRun, dbAll: db.dbAll, fetcher });

    await db.dbRun('INSERT INTO monitored_urls (chat_id, url) VALUES (?, ?)', ['1', 'https://aima.gov.pt/test']);
    const row = await db.dbGet('SELECT * FROM monitored_urls WHERE chat_id = ?', ['1']);

    await checkSingleUrl(row);

    assert.equal(sendMessage.mock.callCount(), 1);
    const msg = sendMessage.mock.calls[0].arguments[1];
    assert.ok(msg.includes('HTTP Error: 500'));
  });

  it('sends timeout message on ECONNABORTED', async () => {
    const error = new Error('timeout');
    error.code = 'ECONNABORTED';
    const fetcher = mock.fn(async () => { throw error; });
    const bot = { sendMessage };

    const { checkSingleUrl } = createChecker({ bot, dbRun: db.dbRun, dbAll: db.dbAll, fetcher });

    await db.dbRun('INSERT INTO monitored_urls (chat_id, url) VALUES (?, ?)', ['1', 'https://aima.gov.pt/test']);
    const row = await db.dbGet('SELECT * FROM monitored_urls WHERE chat_id = ?', ['1']);

    await checkSingleUrl(row);

    assert.equal(sendMessage.mock.callCount(), 1);
    const msg = sendMessage.mock.calls[0].arguments[1];
    assert.ok(msg.includes('Request timed out'));
  });

  it('sends generic error message on unknown error', async () => {
    const fetcher = mock.fn(async () => { throw new Error('DNS failure'); });
    const bot = { sendMessage };

    const { checkSingleUrl } = createChecker({ bot, dbRun: db.dbRun, dbAll: db.dbAll, fetcher });

    await db.dbRun('INSERT INTO monitored_urls (chat_id, url) VALUES (?, ?)', ['1', 'https://aima.gov.pt/test']);
    const row = await db.dbGet('SELECT * FROM monitored_urls WHERE chat_id = ?', ['1']);

    await checkSingleUrl(row);

    assert.equal(sendMessage.mock.callCount(), 1);
    const msg = sendMessage.mock.calls[0].arguments[1];
    assert.ok(msg.includes('Error: DNS failure'));
  });

  it('does not throw when sendMessage fails in error handler', async () => {
    const fetcher = mock.fn(async () => { throw new Error('network down'); });
    const failingSendMessage = mock.fn(async () => { throw new Error('some send error'); });
    const bot = { sendMessage: failingSendMessage };

    const { checkSingleUrl } = createChecker({ bot, dbRun: db.dbRun, dbAll: db.dbAll, fetcher });

    await db.dbRun('INSERT INTO monitored_urls (chat_id, url) VALUES (?, ?)', ['1', 'https://aima.gov.pt/test']);
    const row = await db.dbGet('SELECT * FROM monitored_urls WHERE chat_id = ?', ['1']);

    // Should resolve without throwing
    await assert.doesNotReject(() => checkSingleUrl(row));
  });

  it('removes all URLs for chat when bot is blocked during sendMessage', async () => {
    const html = makeHtml({ nome: 'João', validado: 'Sim', lastUpdated: '2024-02-20', estado: 'Ativo' });
    const fetcher = mock.fn(async () => ({ data: html }));
    const blockedSend = mock.fn(async () => {
      throw new Error('ETELEGRAM: 403 Forbidden: bot was blocked by the user');
    });
    const bot = { sendMessage: blockedSend };

    const { checkSingleUrl } = createChecker({ bot, dbRun: db.dbRun, dbAll: db.dbAll, fetcher });

    await db.dbRun('INSERT INTO monitored_urls (chat_id, url) VALUES (?, ?)', ['1', 'https://aima.gov.pt/a']);
    await db.dbRun('INSERT INTO monitored_urls (chat_id, url) VALUES (?, ?)', ['1', 'https://aima.gov.pt/b']);
    const row = await db.dbGet('SELECT * FROM monitored_urls WHERE chat_id = ? AND url = ?', ['1', 'https://aima.gov.pt/a']);

    await checkSingleUrl(row);

    // All URLs for this chat should be removed
    const remaining = await db.dbAll('SELECT * FROM monitored_urls WHERE chat_id = ?', ['1']);
    assert.equal(remaining.length, 0);
  });

  it('removes all URLs when bot is blocked during error notification', async () => {
    const fetcher = mock.fn(async () => { throw new Error('network down'); });
    const blockedSend = mock.fn(async () => {
      throw new Error('ETELEGRAM: 403 Forbidden: bot was blocked by the user');
    });
    const bot = { sendMessage: blockedSend };

    const { checkSingleUrl } = createChecker({ bot, dbRun: db.dbRun, dbAll: db.dbAll, fetcher });

    await db.dbRun('INSERT INTO monitored_urls (chat_id, url) VALUES (?, ?)', ['1', 'https://aima.gov.pt/a']);
    await db.dbRun('INSERT INTO monitored_urls (chat_id, url) VALUES (?, ?)', ['1', 'https://aima.gov.pt/b']);
    const row = await db.dbGet('SELECT * FROM monitored_urls WHERE chat_id = ? AND url = ?', ['1', 'https://aima.gov.pt/a']);

    await checkSingleUrl(row);

    const remaining = await db.dbAll('SELECT * FROM monitored_urls WHERE chat_id = ?', ['1']);
    assert.equal(remaining.length, 0);
  });
});

describe('isBotBlocked', () => {
  it('returns true for Telegram blocked error', () => {
    assert.ok(isBotBlocked(new Error('ETELEGRAM: 403 Forbidden: bot was blocked by the user')));
  });

  it('returns false for other errors', () => {
    assert.ok(!isBotBlocked(new Error('network timeout')));
  });

  it('returns false for null/undefined', () => {
    assert.ok(!isBotBlocked(null));
    assert.ok(!isBotBlocked(undefined));
  });
});

describe('checkAllUrls', () => {
  it('iterates all rows from dbAll', async () => {
    const html = makeHtml({ validado: 'Sim', lastUpdated: '2024-02-20', estado: 'Ativo' });
    const fetcher = mock.fn(async () => ({ data: html }));
    const bot = { sendMessage };

    const { checkAllUrls } = createChecker({ bot, dbRun: db.dbRun, dbAll: db.dbAll, fetcher });

    // Insert 3 URLs (all first-check, so each triggers a sendMessage)
    await db.dbRun('INSERT INTO monitored_urls (chat_id, url) VALUES (?, ?)', ['1', 'https://aima.gov.pt/a']);
    await db.dbRun('INSERT INTO monitored_urls (chat_id, url) VALUES (?, ?)', ['2', 'https://aima.gov.pt/b']);
    await db.dbRun('INSERT INTO monitored_urls (chat_id, url) VALUES (?, ?)', ['3', 'https://aima.gov.pt/c']);

    await checkAllUrls();

    assert.equal(fetcher.mock.callCount(), 3);
    assert.equal(sendMessage.mock.callCount(), 3);
  });

  it('continues checking remaining URLs after mid-loop failure', async () => {
    const html = makeHtml({ nome: 'Test', validado: 'Sim', lastUpdated: '2024-02-20', estado: 'Ativo' });
    let fetchCount = 0;
    const fetcher = mock.fn(async (url) => {
      fetchCount++;
      if (url.includes('/b')) throw new Error('fetch fail');
      return { data: html };
    });
    // sendMessage throws for chat '2' (the one whose fetch also fails), simulating double failure
    const failingSendMessage = mock.fn(async (chatId) => {
      if (chatId === '2') throw new Error('bot blocked');
    });
    const bot = { sendMessage: failingSendMessage };

    const { checkAllUrls } = createChecker({ bot, dbRun: db.dbRun, dbAll: db.dbAll, fetcher });

    await db.dbRun('INSERT INTO monitored_urls (chat_id, url) VALUES (?, ?)', ['1', 'https://aima.gov.pt/a']);
    await db.dbRun('INSERT INTO monitored_urls (chat_id, url) VALUES (?, ?)', ['2', 'https://aima.gov.pt/b']);
    await db.dbRun('INSERT INTO monitored_urls (chat_id, url) VALUES (?, ?)', ['3', 'https://aima.gov.pt/c']);

    await checkAllUrls();

    // All 3 URLs were fetched (loop didn't abort)
    assert.equal(fetcher.mock.callCount(), 3);
    // URLs A and C got messages (initial monitoring); URL B's sendMessage threw but was caught
    const sentChats = failingSendMessage.mock.calls.map(c => c.arguments[0]);
    assert.ok(sentChats.includes('1'), 'chat 1 should have received a message');
    assert.ok(sentChats.includes('3'), 'chat 3 should have received a message');
  });

  it('rejects when dbAll throws (e.g. DB locked)', async () => {
    const fetcher = mock.fn(async () => ({ data: '' }));
    const bot = { sendMessage };
    const failingDbAll = async () => { throw new Error('SQLITE_BUSY: database is locked'); };

    const { checkAllUrls } = createChecker({ bot, dbRun: db.dbRun, dbAll: failingDbAll, fetcher });

    await assert.rejects(
      () => checkAllUrls(),
      (err) => err.message.includes('database is locked')
    );
  });

  it('skips overlapping run when already in progress', async () => {
    const html = makeHtml({ validado: 'Sim', lastUpdated: '2024-02-20', estado: 'Ativo' });
    const fetcher = mock.fn(async () => ({ data: html }));
    const bot = { sendMessage };

    const { checkAllUrls } = createChecker({ bot, dbRun: db.dbRun, dbAll: db.dbAll, fetcher });

    await db.dbRun('INSERT INTO monitored_urls (chat_id, url) VALUES (?, ?)', ['1', 'https://aima.gov.pt/a']);

    // Launch two runs concurrently — second should be skipped
    const [r1, r2] = await Promise.all([checkAllUrls(), checkAllUrls()]);

    // Only one run should have fetched
    assert.equal(fetcher.mock.callCount(), 1);
  });

  it('handles empty URL list gracefully', async () => {
    const fetcher = mock.fn(async () => ({ data: '' }));
    const bot = { sendMessage };

    const { checkAllUrls } = createChecker({ bot, dbRun: db.dbRun, dbAll: db.dbAll, fetcher });

    await checkAllUrls();

    assert.equal(fetcher.mock.callCount(), 0);
    assert.equal(sendMessage.mock.callCount(), 0);
  });

  it('skips remaining URLs for a blocked chat', async () => {
    const html = makeHtml({ nome: 'Test', validado: 'Sim', lastUpdated: '2024-02-20', estado: 'Ativo' });
    const fetcher = mock.fn(async () => ({ data: html }));
    const blockedSend = mock.fn(async (chatId) => {
      if (chatId === '1') throw new Error('ETELEGRAM: 403 Forbidden: bot was blocked by the user');
    });
    const bot = { sendMessage: blockedSend };

    const { checkAllUrls } = createChecker({ bot, dbRun: db.dbRun, dbAll: db.dbAll, fetcher });

    // Chat 1 has 2 URLs, chat 2 has 1 URL
    await db.dbRun('INSERT INTO monitored_urls (chat_id, url) VALUES (?, ?)', ['1', 'https://aima.gov.pt/a']);
    await db.dbRun('INSERT INTO monitored_urls (chat_id, url) VALUES (?, ?)', ['1', 'https://aima.gov.pt/b']);
    await db.dbRun('INSERT INTO monitored_urls (chat_id, url) VALUES (?, ?)', ['2', 'https://aima.gov.pt/c']);

    await checkAllUrls();

    // Only 2 fetches: URL /a (blocked on send), URL /b skipped, URL /c fetched normally
    assert.equal(fetcher.mock.callCount(), 2);
    // Chat 1's URLs should be deleted, chat 2's should remain
    const remaining = await db.dbAll('SELECT * FROM monitored_urls');
    assert.equal(remaining.length, 1);
    assert.equal(remaining[0].chat_id, '2');
  });
});
