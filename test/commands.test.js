const { describe, it, beforeEach, afterEach, mock } = require('node:test');
const assert = require('node:assert/strict');
const { openDatabase } = require('../lib/db');
const { registerCommands, commandPattern, MAX_URLS_PER_USER, CHECK_COOLDOWN_MS } = require('../lib/commands');

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

function register(checkSingleUrl = mock.fn(async () => {})) {
  registerCommands({ bot, dbAll: db.dbAll, dbRun: db.dbRun, dbGet: db.dbGet, registerUser: db.registerUser, checkSingleUrl });
  return checkSingleUrl;
}

// Invoke a command handler the way node-telegram-bot-api does: with the regex match.
function runCommand(name, msg) {
  const pattern = commandPattern(name);
  return getHandler(pattern)(msg, pattern.exec(msg.text));
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
    register(checkSingleUrl);
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
    register(checkSingleUrl);
    const handler = getMessageHandler();

    await handler(makeMsg('42', 'https://aima.gov.pt/test/first'));

    const lastMsg = sendMessage.mock.calls[sendMessage.mock.calls.length - 1].arguments[1];
    assert.ok(lastMsg.includes('added to monitoring'), `Expected success message, got: ${lastMsg}`);
  });
});

describe('legacy portal URL rejection', () => {
  it('rejects services.aima.gov.pt URLs with a clear message and does not insert', async () => {
    const checkSingleUrl = mock.fn(async () => {});
    register(checkSingleUrl);
    const handler = getMessageHandler();

    await handler(makeMsg('42', 'https://services.aima.gov.pt/RAR/2fase/sumario.php'));

    const lastMsg = sendMessage.mock.calls[sendMessage.mock.calls.length - 1].arguments[1];
    assert.ok(lastMsg.includes('older AIMA portal'), `Expected legacy-portal message, got: ${lastMsg}`);
    assert.equal(checkSingleUrl.mock.callCount(), 0);

    const rows = await db.dbAll('SELECT * FROM monitored_urls WHERE chat_id = ?', ['42']);
    assert.equal(rows.length, 0);
  });
});

describe('contact portal URLs', () => {
  it('rejects non-tracking contactenos.aima.gov.pt URLs with a clear message and does not insert', async () => {
    const checkSingleUrl = mock.fn(async () => {});
    register(checkSingleUrl);
    const handler = getMessageHandler();

    await handler(makeMsg('42', 'https://contactenos.aima.gov.pt/contact-form'));

    const lastMsg = sendMessage.mock.calls[sendMessage.mock.calls.length - 1].arguments[1];
    assert.ok(lastMsg.includes('tracking pages'), `Expected tracking-page message, got: ${lastMsg}`);
    assert.equal(checkSingleUrl.mock.callCount(), 0);

    const rows = await db.dbAll('SELECT * FROM monitored_urls WHERE chat_id = ?', ['42']);
    assert.equal(rows.length, 0);
  });

  it('accepts a /tracking/<uuid> URL and starts checking it', async () => {
    const checkSingleUrl = mock.fn(async () => {});
    register(checkSingleUrl);
    const handler = getMessageHandler();

    const url = 'https://contactenos.aima.gov.pt/tracking/00000000-0000-0000-0000-000000000000';
    await handler(makeMsg('42', url));

    assert.equal(checkSingleUrl.mock.callCount(), 1);

    const rows = await db.dbAll('SELECT * FROM monitored_urls WHERE chat_id = ?', ['42']);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].url, url);
  });
});

describe('/check rate limit', () => {
  it('does not start cooldown when there are no URLs to check', async () => {
    const checkSingleUrl = mock.fn(async () => {});
    register(checkSingleUrl);
    const handler = (msg) => runCommand('check', msg);

    await handler(makeMsg('42', '/check'));

    await db.dbRun('INSERT INTO monitored_urls (chat_id, url) VALUES (?, ?)', ['42', 'https://aima.gov.pt/test']);

    sendMessage.mock.resetCalls();
    await handler(makeMsg('42', '/check'));

    const msgs = sendMessage.mock.calls.map(c => c.arguments[1]);
    assert.ok(!msgs.some(m => m.includes('Please wait')), 'No-URL /check should not consume cooldown');
    assert.equal(checkSingleUrl.mock.callCount(), 1);
  });

  it('rate-limits the second /check call within cooldown', async () => {
    const checkSingleUrl = mock.fn(async () => {});
    register(checkSingleUrl);
    const handler = (msg) => runCommand('check', msg);

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
      register(checkSingleUrl);
      const handler = (msg) => runCommand('check', msg);

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

describe('several links in one message', () => {
  const A = 'https://portal-renovacoes.aima.gov.pt/ords/r/aima/aima-pr/validar?p72_token=AAA&cs=1xyz';
  const B = 'https://portal-renovacoes.aima.gov.pt/ords/r/aima/aima-pr/validar?p72_token=BBB&cs=1abc';

  function setup() {
    const checkSingleUrl = mock.fn(async () => {});
    register(checkSingleUrl);
    return { handler: getMessageHandler(), checkSingleUrl };
  }

  it('stores the same link pasted twice back to back as one clean row', async () => {
    const { handler, checkSingleUrl } = setup();
    await handler(makeMsg('42', A + A));

    const rows = await db.dbAll('SELECT url FROM monitored_urls WHERE chat_id = ?', ['42']);
    assert.deepEqual(rows.map(r => r.url), [A]);
    assert.equal(checkSingleUrl.mock.callCount(), 1);
  });

  it('adds each of several different links as its own row', async () => {
    const { handler, checkSingleUrl } = setup();
    await handler(makeMsg('42', `${A}\n${B}`));

    const rows = await db.dbAll('SELECT url FROM monitored_urls WHERE chat_id = ? ORDER BY id', ['42']);
    assert.deepEqual(rows.map(r => r.url), [A, B]);
    assert.equal(checkSingleUrl.mock.callCount(), 2);
  });
});

describe('/remove reply', () => {
  async function startRemove() {
    register();
    await db.dbRun('INSERT INTO monitored_urls (chat_id, url) VALUES (?, ?)', ['42', 'https://aima.gov.pt/a']);
    await runCommand('remove', makeMsg('42', '/remove'));
    return getMessageHandler();
  }

  for (const reply of ['Cancel', ' CANCEL ', 'cancel']) {
    it(`treats ${JSON.stringify(reply)} as cancel`, async () => {
      const handler = await startRemove();
      await handler(makeMsg('42', reply));

      const lastMsg = sendMessage.mock.calls.at(-1).arguments[1];
      assert.equal(lastMsg, '❌ Cancelled');
      const rows = await db.dbAll('SELECT * FROM monitored_urls WHERE chat_id = ?', ['42']);
      assert.equal(rows.length, 1);
    });
  }

  it('accepts a number with surrounding whitespace', async () => {
    const handler = await startRemove();
    await handler(makeMsg('42', ' 1 '));

    const rows = await db.dbAll('SELECT * FROM monitored_urls WHERE chat_id = ?', ['42']);
    assert.equal(rows.length, 0);
  });
});

describe('commands followed by text', () => {
  const GLUED = 'https://aima.gov.pt/aaahttps://aima.gov.pt/aaa';
  const CLEAN = 'https://aima.gov.pt/aaa';
  const OTHER = 'https://aima.gov.pt/bbb';

  function setup() {
    const checkSingleUrl = mock.fn(async () => {});
    register(checkSingleUrl);
    return checkSingleUrl;
  }

  const lastMsg = () => sendMessage.mock.calls.at(-1).arguments[1];
  const urls = async () => (await db.dbAll('SELECT url FROM monitored_urls WHERE chat_id = ? ORDER BY id', ['42'])).map(r => r.url);

  it('command patterns match bare, @bot and with an argument, but not longer names', () => {
    const p = commandPattern('remove');
    assert.equal(p.exec('/remove')[1], undefined);
    assert.equal(p.exec('/remove@AimaBot')[1], undefined);
    assert.equal(p.exec(`/remove ${CLEAN}`)[1], CLEAN);
    assert.equal(p.exec(`/remove\n${CLEAN}`)[1], CLEAN);
    assert.equal(p.exec('/removeall'), null);
  });

  it('/remove <link> removes that link without the number step', async () => {
    setup();
    await db.dbRun('INSERT INTO monitored_urls (chat_id, url) VALUES (?, ?)', ['42', CLEAN]);
    await db.dbRun('INSERT INTO monitored_urls (chat_id, url) VALUES (?, ?)', ['42', OTHER]);
    await runCommand('remove', makeMsg('42', `/remove ${CLEAN}`));

    assert.deepEqual(await urls(), [OTHER]);
    assert.equal(lastMsg(), '✅ Removed 1 URL(s) from monitoring');
    assert.equal(sendMessage.mock.callCount(), 1, 'no "send without a command" hint for /remove');
  });

  it('/remove <link> also removes a legacy row where that link was stored glued', async () => {
    setup();
    await db.dbRun('INSERT INTO monitored_urls (chat_id, url) VALUES (?, ?)', ['42', GLUED]);
    // The user pastes exactly what the bot showed them: the glued string.
    await runCommand('remove', makeMsg('42', `/remove  ${GLUED}`));
    assert.deepEqual(await urls(), []);
  });

  it('/remove <link> does not remove a different link that merely starts with it', async () => {
    setup();
    await db.dbRun('INSERT INTO monitored_urls (chat_id, url) VALUES (?, ?)', ['42', `${CLEAN}x`]);
    await runCommand('remove', makeMsg('42', `/remove ${CLEAN}`));
    assert.deepEqual(await urls(), [`${CLEAN}x`]);
  });

  it('/remove <link> reports when the link is not monitored', async () => {
    setup();
    await db.dbRun('INSERT INTO monitored_urls (chat_id, url) VALUES (?, ?)', ['42', OTHER]);
    await runCommand('remove', makeMsg('42', `/remove ${CLEAN}`));
    assert.deepEqual(await urls(), [OTHER]);
    assert.ok(lastMsg().includes('not in your monitoring list'));
  });

  it('/remove <n> removes the n-th link as listed by /status', async () => {
    setup();
    await db.dbRun('INSERT INTO monitored_urls (chat_id, url) VALUES (?, ?)', ['42', CLEAN]);
    await db.dbRun('INSERT INTO monitored_urls (chat_id, url) VALUES (?, ?)', ['42', OTHER]);
    await runCommand('remove', makeMsg('42', '/remove 2'));
    assert.deepEqual(await urls(), [CLEAN]);
  });

  it('/cancel cancels a pending remove', async () => {
    setup();
    await db.dbRun('INSERT INTO monitored_urls (chat_id, url) VALUES (?, ?)', ['42', CLEAN]);
    await runCommand('remove', makeMsg('42', '/remove'));
    await runCommand('cancel', makeMsg('42', '/cancel'));
    assert.equal(lastMsg(), '❌ Cancelled');

    // Back to normal mode: a plain number is no longer taken as a remove choice.
    await getMessageHandler()(makeMsg('42', '1'));
    assert.deepEqual(await urls(), [CLEAN]);
  });

  it('/cancel with nothing pending says so', async () => {
    setup();
    await runCommand('cancel', makeMsg('42', `/cancel ${CLEAN}`));
    assert.equal(sendMessage.mock.calls[0].arguments[1], 'ℹ️ Nothing to cancel.');
  });

  it('/status <link> shows status and explains how to add the link', async () => {
    const checkSingleUrl = setup();
    await runCommand('status', makeMsg('42', `/status ${CLEAN}`));
    assert.ok(sendMessage.mock.calls[0].arguments[1].includes('No URLs being monitored'));
    assert.ok(lastMsg().includes('send it as a plain message'));
    assert.deepEqual(await urls(), []);
    assert.equal(checkSingleUrl.mock.callCount(), 0);
  });

  it('answers unknown commands instead of staying silent', async () => {
    setup();
    await getMessageHandler()(makeMsg('42', `/add ${CLEAN}`));
    assert.ok(lastMsg().startsWith('❓ Unknown command.'));
    assert.ok(lastMsg().includes('send it as a plain message'));

    await getMessageHandler()(makeMsg('42', '/foo'));
    assert.ok(lastMsg().includes('/help'));
  });

  it('known commands are left to their own handlers by the message handler', async () => {
    setup();
    await getMessageHandler()(makeMsg('42', `/remove ${CLEAN}`));
    await getMessageHandler()(makeMsg('42', '/Status'));
    assert.equal(sendMessage.mock.callCount(), 0);
  });

  it('adds a link when a message is edited into a plain link', async () => {
    const checkSingleUrl = setup();
    const call = bot.on.mock.calls.find(c => c.arguments[0] === 'edited_message');
    await call.arguments[1](makeMsg('42', CLEAN));
    assert.deepEqual(await urls(), [CLEAN]);
    assert.equal(checkSingleUrl.mock.callCount(), 1);

    await call.arguments[1](makeMsg('42', `/status ${OTHER}`));
    assert.deepEqual(await urls(), [CLEAN], 'edited commands are ignored');
  });
});
