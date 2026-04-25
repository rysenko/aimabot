const fs = require('fs');
const path = require('path');
const sqlite3 = require('sqlite3').verbose();

const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS monitored_urls (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    chat_id TEXT NOT NULL,
    url TEXT NOT NULL,
    ultima_atualizacao TEXT,
    situacao_at_ss TEXT,
    estado TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(chat_id, url)
  )`,
  `CREATE TABLE IF NOT EXISTS users (
    chat_id TEXT PRIMARY KEY,
    username TEXT,
    first_name TEXT,
    last_name TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`,
];

const MIGRATIONS = [
  { sql: `ALTER TABLE monitored_urls ADD COLUMN nome TEXT`, ignoreIfIncludes: 'duplicate column' },
  { sql: `ALTER TABLE monitored_urls DROP COLUMN ultima_validacao`, ignoreIfIncludes: 'no such column' },
];

async function openDatabase(dbPath) {
  if (dbPath !== ':memory:') {
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  }

  const db = await new Promise((resolve, reject) => {
    const instance = new sqlite3.Database(dbPath, (err) => {
      if (err) reject(err);
      else resolve(instance);
    });
  });

  await new Promise((resolve, reject) => {
    db.serialize(() => {
      db.run('PRAGMA journal_mode=WAL');
      for (const stmt of SCHEMA) db.run(stmt);
      for (const { sql, ignoreIfIncludes } of MIGRATIONS) {
        db.run(sql, (err) => {
          if (err && !err.message.includes(ignoreIfIncludes)) {
            console.error(`Migration error (${sql}):`, err.message);
          }
        });
      }
      // Sentinel: resolves only after all preceding serialized statements finish.
      db.get('SELECT 1', (err) => (err ? reject(err) : resolve()));
    });
  });

  function dbRun(sql, params) {
    return new Promise((resolve, reject) => {
      db.run(sql, params, function (err) {
        if (err) reject(err);
        else resolve(this);
      });
    });
  }

  function dbAll(sql, params) {
    return new Promise((resolve, reject) => {
      db.all(sql, params, (err, rows) => {
        if (err) reject(err);
        else resolve(rows);
      });
    });
  }

  function dbGet(sql, params) {
    return new Promise((resolve, reject) => {
      db.get(sql, params, (err, row) => {
        if (err) reject(err);
        else resolve(row);
      });
    });
  }

  function registerUser(chatId, username, firstName, lastName) {
    db.run(
      `INSERT INTO users (chat_id, username, first_name, last_name) VALUES (?, ?, ?, ?)
       ON CONFLICT(chat_id) DO UPDATE SET username=excluded.username, first_name=excluded.first_name, last_name=excluded.last_name`,
      [chatId, username, firstName, lastName],
      (err) => {
        if (err) console.error(`Failed to register user (chat_id=${chatId}):`, err.message);
      }
    );
  }

  function close() {
    return new Promise((resolve, reject) => {
      db.close((err) => {
        if (err) reject(err);
        else resolve();
      });
    });
  }

  return { dbRun, dbAll, dbGet, registerUser, close };
}

module.exports = { openDatabase };