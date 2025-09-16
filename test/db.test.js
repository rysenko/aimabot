const { describe, it, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { openDatabase } = require('../lib/db');

let db;

afterEach(async () => {
  if (db) {
    await db.close();
    db = null;
  }
});

describe('openDatabase', () => {
  it('resolves with all expected functions', async () => {
    db = await openDatabase(':memory:');
    assert.equal(typeof db.dbRun, 'function');
    assert.equal(typeof db.dbAll, 'function');
    assert.equal(typeof db.dbGet, 'function');
    assert.equal(typeof db.registerUser, 'function');
    assert.equal(typeof db.close, 'function');
  });

  it('creates monitored_urls table', async () => {
    db = await openDatabase(':memory:');
    const rows = await db.dbAll("SELECT name FROM sqlite_master WHERE type='table' AND name='monitored_urls'");
    assert.equal(rows.length, 1);
  });

  it('creates users table', async () => {
    db = await openDatabase(':memory:');
    const rows = await db.dbAll("SELECT name FROM sqlite_master WHERE type='table' AND name='users'");
    assert.equal(rows.length, 1);
  });
});

describe('dbRun', () => {
  it('inserts a row and returns changes', async () => {
    db = await openDatabase(':memory:');
    const result = await db.dbRun(
      'INSERT INTO monitored_urls (chat_id, url) VALUES (?, ?)',
      ['123', 'https://aima.gov.pt/test']
    );
    assert.equal(result.changes, 1);
  });

  it('rejects on SQL error', async () => {
    db = await openDatabase(':memory:');
    await assert.rejects(
      () => db.dbRun('INSERT INTO nonexistent_table VALUES (?)', ['x']),
      (err) => err.message.includes('no such table')
    );
  });
});

describe('dbAll and dbGet', () => {
  it('dbAll returns rows', async () => {
    db = await openDatabase(':memory:');
    await db.dbRun('INSERT INTO monitored_urls (chat_id, url) VALUES (?, ?)', ['1', 'https://a.aima.gov.pt']);
    await db.dbRun('INSERT INTO monitored_urls (chat_id, url) VALUES (?, ?)', ['1', 'https://b.aima.gov.pt']);
    const rows = await db.dbAll('SELECT * FROM monitored_urls WHERE chat_id = ?', ['1']);
    assert.equal(rows.length, 2);
  });

  it('dbAll returns empty array when no matches', async () => {
    db = await openDatabase(':memory:');
    const rows = await db.dbAll('SELECT * FROM monitored_urls WHERE chat_id = ?', ['999']);
    assert.deepEqual(rows, []);
  });

  it('dbGet returns single row', async () => {
    db = await openDatabase(':memory:');
    await db.dbRun('INSERT INTO monitored_urls (chat_id, url) VALUES (?, ?)', ['1', 'https://a.aima.gov.pt']);
    const row = await db.dbGet('SELECT * FROM monitored_urls WHERE chat_id = ?', ['1']);
    assert.equal(row.chat_id, '1');
    assert.equal(row.url, 'https://a.aima.gov.pt');
  });

  it('dbGet returns undefined when no match', async () => {
    db = await openDatabase(':memory:');
    const row = await db.dbGet('SELECT * FROM monitored_urls WHERE chat_id = ?', ['999']);
    assert.equal(row, undefined);
  });
});

describe('registerUser', () => {
  it('inserts a new user', async () => {
    db = await openDatabase(':memory:');
    db.registerUser('100', 'jsilva', 'João', 'Silva');
    // registerUser is fire-and-forget, so wait a tick then query
    await new Promise(r => setTimeout(r, 50));
    const row = await db.dbGet('SELECT * FROM users WHERE chat_id = ?', ['100']);
    assert.equal(row.username, 'jsilva');
    assert.equal(row.first_name, 'João');
  });

  it('updates existing user without resetting created_at', async () => {
    db = await openDatabase(':memory:');
    db.registerUser('100', 'old', 'Old', 'Name');
    await new Promise(r => setTimeout(r, 50));
    const before = await db.dbGet('SELECT created_at FROM users WHERE chat_id = ?', ['100']);

    db.registerUser('100', 'new', 'New', 'Name');
    await new Promise(r => setTimeout(r, 50));
    const after = await db.dbGet('SELECT * FROM users WHERE chat_id = ?', ['100']);

    assert.equal(after.username, 'new');
    assert.equal(after.first_name, 'New');
    assert.equal(after.created_at, before.created_at);
  });
});

describe('WAL mode', () => {
  it('enables WAL journal mode on file-based databases', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aimabot-test-'));
    const tmpDb = path.join(tmpDir, 'test.db');
    try {
      db = await openDatabase(tmpDb);
      const row = await db.dbGet('PRAGMA journal_mode');
      assert.equal(row.journal_mode, 'wal');
    } finally {
      if (db) { await db.close(); db = null; }
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});

describe('schema constraints', () => {
  it('enforces UNIQUE(chat_id, url)', async () => {
    db = await openDatabase(':memory:');
    await db.dbRun('INSERT INTO monitored_urls (chat_id, url) VALUES (?, ?)', ['1', 'https://a.aima.gov.pt']);
    await assert.rejects(
      () => db.dbRun('INSERT INTO monitored_urls (chat_id, url) VALUES (?, ?)', ['1', 'https://a.aima.gov.pt']),
      (err) => err.message.includes('UNIQUE constraint')
    );
  });

  it('nome column exists in monitored_urls', async () => {
    db = await openDatabase(':memory:');
    await db.dbRun(
      'INSERT INTO monitored_urls (chat_id, url, nome) VALUES (?, ?, ?)',
      ['1', 'https://a.aima.gov.pt', 'Test Name']
    );
    const row = await db.dbGet('SELECT nome FROM monitored_urls WHERE chat_id = ?', ['1']);
    assert.equal(row.nome, 'Test Name');
  });
});
