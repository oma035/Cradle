// SQLite storage using Node's built-in node:sqlite (Node 22.13+), no native install needed.
import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import path from "node:path";

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  telegram_id TEXT UNIQUE NOT NULL,
  telegram_name TEXT,
  public_key TEXT,
  enc_secret TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS experts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  email TEXT NOT NULL,
  profession TEXT,
  stellar_address TEXT NOT NULL,
  cv_file TEXT,
  cv_original_name TEXT,
  agreed_terms_at TEXT,
  status TEXT NOT NULL DEFAULT 'pending',     -- pending | approved | rejected
  access_token TEXT UNIQUE,
  created_at TEXT DEFAULT (datetime('now')),
  reviewed_at TEXT
);

CREATE TABLE IF NOT EXISTS questions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id),
  text TEXT NOT NULL,
  triage TEXT,                 -- emergency | free | expert
  ai_answer TEXT,
  status TEXT NOT NULL,        -- answered_free | emergency | awaiting_approval | declined | paying | paid | claimed | answered | refunded | failed
  price_usd TEXT,
  pay_nonce TEXT,
  payment_tx TEXT,
  expert_id INTEGER REFERENCES experts(id),
  expert_answer TEXT,
  payout_tx TEXT,
  payout_amount TEXT,
  refund_tx TEXT,
  error TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  paid_at TEXT,
  answered_at TEXT
);

CREATE TABLE IF NOT EXISTS payments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  question_id INTEGER REFERENCES questions(id),
  kind TEXT NOT NULL,          -- x402_in | payout | refund | sponsor
  from_address TEXT,
  to_address TEXT,
  amount TEXT,
  asset TEXT DEFAULT 'USDC',
  tx_hash TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);
`;

export function openDb(file) {
  if (file !== ":memory:") fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;");
  db.exec(SCHEMA);
  return makeRepo(db);
}

function makeRepo(db) {
  const one = (sql, ...a) => db.prepare(sql).get(...a);
  const all = (sql, ...a) => db.prepare(sql).all(...a);
  const run = (sql, ...a) => db.prepare(sql).run(...a);

  return {
    raw: db,

    // ----- users -----
    upsertUser(telegramId, name) {
      run(
        `INSERT INTO users (telegram_id, telegram_name) VALUES (?, ?)
         ON CONFLICT(telegram_id) DO UPDATE SET telegram_name = excluded.telegram_name`,
        String(telegramId), name || null
      );
      return this.userByTelegram(telegramId);
    },
    userByTelegram: (tid) => one(`SELECT * FROM users WHERE telegram_id = ?`, String(tid)),
    userById: (id) => one(`SELECT * FROM users WHERE id = ?`, id),
    setUserWallet: (id, pub, encSecret) =>
      run(`UPDATE users SET public_key = ?, enc_secret = ? WHERE id = ?`, pub, encSecret, id),
    listUsers: () =>
      all(`SELECT u.id, u.telegram_id, u.telegram_name, u.public_key, u.created_at,
                  (SELECT COUNT(*) FROM questions q WHERE q.user_id = u.id) AS questions
           FROM users u ORDER BY u.id DESC`),

    // ----- experts -----
    createExpert(e) {
      const r = run(
        `INSERT INTO experts (name, email, profession, stellar_address, cv_file, cv_original_name, agreed_terms_at)
         VALUES (?, ?, ?, ?, ?, ?, datetime('now'))`,
        e.name, e.email, e.profession || null, e.stellar_address, e.cv_file, e.cv_original_name
      );
      return Number(r.lastInsertRowid);
    },
    expertById: (id) => one(`SELECT * FROM experts WHERE id = ?`, id),
    expertByToken: (t) => one(`SELECT * FROM experts WHERE access_token = ? AND status = 'approved'`, t),
    listExperts: () => all(`SELECT * FROM experts ORDER BY CASE status WHEN 'pending' THEN 0 ELSE 1 END, id DESC`),
    reviewExpert: (id, status, token) =>
      run(`UPDATE experts SET status = ?, access_token = ?, reviewed_at = datetime('now') WHERE id = ?`,
        status, token || null, id),

    // ----- questions -----
    createQuestion(q) {
      const r = run(
        `INSERT INTO questions (user_id, text, triage, ai_answer, status, price_usd, pay_nonce)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        q.user_id, q.text, q.triage, q.ai_answer || null, q.status, q.price_usd || null, q.pay_nonce || null
      );
      return Number(r.lastInsertRowid);
    },
    question: (id) => one(`SELECT * FROM questions WHERE id = ?`, id),
    /** Atomic status change; returns true only if the row was in one of `from`. */
    transition(id, from, to, extra = {}) {
      const cols = Object.keys(extra);
      const sets = ["status = ?", ...cols.map((c) => `${c} = ?`)].join(", ");
      const ph = from.map(() => "?").join(",");
      const r = run(
        `UPDATE questions SET ${sets} WHERE id = ? AND status IN (${ph})`,
        to, ...cols.map((c) => extra[c]), id, ...from
      );
      return r.changes === 1;
    },
    update(id, fields) {
      const cols = Object.keys(fields);
      run(`UPDATE questions SET ${cols.map((c) => `${c} = ?`).join(", ")} WHERE id = ?`,
        ...cols.map((c) => fields[c]), id);
    },
    openReviews: () =>
      all(`SELECT id, text, ai_answer, status, expert_id, price_usd, paid_at FROM questions
           WHERE status IN ('paid','claimed') ORDER BY paid_at ASC`),
    expertHistory: (expertId) =>
      all(`SELECT id, text, expert_answer, payout_amount, payout_tx, answered_at FROM questions
           WHERE expert_id = ? AND status = 'answered' ORDER BY answered_at DESC LIMIT 50`, expertId),
    overdueReviews: (minutes) =>
      all(`SELECT * FROM questions WHERE status IN ('paid','claimed')
           AND paid_at < datetime('now', ?)`, `-${Math.floor(minutes)} minutes`),
    listQuestions: () =>
      all(`SELECT q.*, u.telegram_name, e.name AS expert_name FROM questions q
           JOIN users u ON u.id = q.user_id LEFT JOIN experts e ON e.id = q.expert_id
           ORDER BY q.id DESC LIMIT 500`),

    // ----- payments -----
    logPayment: (p) =>
      run(`INSERT INTO payments (question_id, kind, from_address, to_address, amount, asset, tx_hash)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
        p.question_id ?? null, p.kind, p.from_address ?? null, p.to_address ?? null,
        p.amount ?? null, p.asset ?? "USDC", p.tx_hash ?? null),
    listPayments: () => all(`SELECT * FROM payments ORDER BY id DESC LIMIT 1000`),

    stats: () => ({
      users: one(`SELECT COUNT(*) n FROM users`).n,
      experts_pending: one(`SELECT COUNT(*) n FROM experts WHERE status='pending'`).n,
      experts_approved: one(`SELECT COUNT(*) n FROM experts WHERE status='approved'`).n,
      questions: one(`SELECT COUNT(*) n FROM questions`).n,
      paid_reviews: one(`SELECT COUNT(*) n FROM questions WHERE status='answered'`).n,
      volume_in: one(`SELECT COALESCE(SUM(CAST(amount AS REAL)),0) v FROM payments WHERE kind='x402_in'`).v,
      volume_out: one(`SELECT COALESCE(SUM(CAST(amount AS REAL)),0) v FROM payments WHERE kind='payout'`).v,
    }),
  };
}
