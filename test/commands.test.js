const { describe, it, beforeEach, afterEach, mock } = require('node:test');
const assert = require('node:assert/strict');
const { openDatabase } = require('../lib/db');
const { registerCommands, MAX_URLS_PER_USER, CHECK_COOLDOWN_MS } = require('../lib/commands');

let db;
let sendMessage;
let bot;

beforeEach(async () => {
  db = await openDatabase(':memory:');
  sendMessage = mock.fn(async () => {});
  bot = {
    sendMessage,
    onText: mock.fn(),
    on: mock.fn(),
    removeListener: mock.fn(),
  };
});

afterEach(async () => {
  if (db) {
    await db.close();
    db = null;
  }
});

// Helper: extract the handler registered for a given regex pattern via bot.onText
function getHandler(pattern) {
  const call = bot.onText.mock.calls.find(c => c.arguments[0].toString() === pattern.toString());
  if (!call) throw new Error(`No handler registered for ${pattern}`);
  return call.arguments[1];
}

// Helper: extract the generic message handler registered via bot.on('message', ...)
function getMessageHandler() {
  const call = bot.on.mock.calls.find(c => c.arguments[0] === 'message');
  if (!call) throw new Error('No message handler registered');
  return call.arguments[1];
}

function makeMsg(chatId, text) {
  return {
    chat: { id: Number(chatId) },
    from: { username: 'testuser', first_name: 'Test', last_name: 'User' },
    text,
  };
}

describe('per-user URL limit', () => {
  it(`rejects the ${MAX_URLS_PER_USER + 1}th URL`, async () => {
    const checkSingleUrl = mock.fn(async () => {});
    registerCommands({ bot, dbAll: db.dbAll, dbRun: db.dbRun, dbGet: db.dbGet, registerUser: db.registerUser, checkSingleUrl });
    const handler = getMessageHandler();

    // Insert MAX_URLS_PER_USER URLs directly into the DB
    for (let i = 0; i < MAX_URLS_PER_USER; i++) {
      await db.dbRun(
        'INSERT INTO monitored_urls (chat_id, url) VALUES (?, ?)',
        ['42', `https://aima.gov.pt/test/${i}`]
      );
    }

    // Simulate sending one more URL
    await handler(makeMsg('42', `https://aima.gov.pt/test/${MAX_URLS_PER_USER}`));

    // Should have sent a rejection message
    const calls = sendMessage.mock.calls.filter(c => c.arguments[0] === '42');
    const lastMsg = calls[calls.length - 1].arguments[1];
    assert.ok(lastMsg.includes(`maximum of ${MAX_URLS_PER_USER}`), `Expected rejection message, got: ${lastMsg}`);

    // URL count should still be MAX_URLS_PER_USER
    const rows = await db.dbAll('SELECT * FROM monitored_urls WHERE chat_id = ?', ['42']);
    assert.equal(rows.length, MAX_URLS_PER_USER);
  });

  it('allows adding a URL when under the limit', async () => {
    const checkSingleUrl = mock.fn(async () => {});
    registerCommands({ bot, dbAll: db.dbAll, dbRun: db.dbRun, dbGet: db.dbGet, registerUser: db.registerUser, checkSingleUrl });
    const handler = getMessageHandler();

    await handler(makeMsg('42', 'https://aima.gov.pt/test/first'));

    const lastMsg = sendMessage.mock.calls[sendMessage.mock.calls.length - 1].arguments[1];
    assert.ok(lastMsg.includes('added to monitoring'), `Expected success message, got: ${lastMsg}`);
  });
});

describe('/check rate limit', () => {
  it('rate-limits the second /check call within cooldown', async () => {
    const checkSingleUrl = mock.fn(async () => {});
    registerCommands({ bot, dbAll: db.dbAll, dbRun: db.dbRun, dbGet: db.dbGet, registerUser: db.registerUser, checkSingleUrl });
    const handler = getHandler(/\/check(?:@\w+)?$/);

    // Insert a URL so the first /check has work to do
    await db.dbRun('INSERT INTO monitored_urls (chat_id, url) VALUES (?, ?)', ['42', 'https://aima.gov.pt/test']);

    // First call — should proceed
    await handler(makeMsg('42', '/check'));

    // Second call immediately — should be rate-limited
    sendMessage.mock.resetCalls();
    await handler(makeMsg('42', '/check'));

    assert.equal(sendMessage.mock.callCount(), 1);
    const msg = sendMessage.mock.calls[0].arguments[1];
    assert.ok(msg.includes('Please wait'), `Expected rate-limit message, got: ${msg}`);
  });

  it('allows /check after cooldown expires', async () => {
    const realDateNow = Date.now;
    let fakeNow = realDateNow();

    mock.method(Date, 'now', () => fakeNow);

    try {
      const checkSingleUrl = mock.fn(async () => {});
      registerCommands({ bot, dbAll: db.dbAll, dbRun: db.dbRun, dbGet: db.dbGet, registerUser: db.registerUser, checkSingleUrl });
      const handler = getHandler(/\/check(?:@\w+)?$/);

      await db.dbRun('INSERT INTO monitored_urls (chat_id, url) VALUES (?, ?)', ['42', 'https://aima.gov.pt/test']);

      // First call
      await handler(makeMsg('42', '/check'));

      // Advance time past cooldown
      fakeNow += CHECK_COOLDOWN_MS + 1;

      sendMessage.mock.resetCalls();
      await handler(makeMsg('42', '/check'));

      // Should NOT be a rate-limit message
      const msgs = sendMessage.mock.calls.map(c => c.arguments[1]);
      assert.ok(!msgs.some(m => m.includes('Please wait')), 'Should not be rate-limited after cooldown');
    } finally {
      Date.now.mock.restore();
    }
  });
});
