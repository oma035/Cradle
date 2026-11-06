import { test } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { screenRedFlags } from "../src/redflags.js";
import { toStroops, fromStroops, shareOf } from "../src/money.js";
import { encryptSecret, decryptSecret } from "../src/secrets.js";
import { openDb } from "../src/db.js";

test("red flags: danger signs are caught", () => {
  for (const t of [
    "I'm bleeding a lot",
    "I have a severe headache and blurred vision",
    "she had a fit this morning",
    "the baby stopped moving since yesterday",
    "my water broke at 32 weeks",
    "my face and hands are suddenly swollen",
    "I have a high fever",
    "I want to end my life",
  ]) assert.ok(screenRedFlags(t).length > 0, t);
});

test("red flags: everyday questions are not flagged", () => {
  for (const t of [
    "I'm 30 weeks and my feet are swelling, is that normal?",
    "What is a normal blood pressure in pregnancy?",
    "Can I keep fit with yoga?",
    "Does this dress fit a bump?",
    "When should I do my blood test?",
    "What should I pack for the hospital?",
  ]) assert.deepEqual(screenRedFlags(t), [], t);
});

test("money: exact 7-decimal math", () => {
  assert.equal(toStroops("0.20"), 2000000n);
  assert.equal(toStroops("$0.001"), 10000n);
  assert.equal(fromStroops(2000000n), "0.2000000");
  assert.equal(shareOf("0.20", 100), "0.2000000");
  assert.equal(shareOf("0.20", 80), "0.1600000");
  assert.throws(() => toStroops("0.123456789"));
});

test("secrets: encrypt/decrypt round trip and tamper detection", () => {
  const key = crypto.randomBytes(32).toString("hex");
  const blob = encryptSecret("SABCDEF", key);
  assert.equal(decryptSecret(blob, key), "SABCDEF");
  const other = crypto.randomBytes(32).toString("hex");
  assert.throws(() => decryptSecret(blob, other));
});

test("db: question state machine allows each transition only once", () => {
  const db = openDb(":memory:");
  const u = db.upsertUser(123, "Ada");
  const id = db.createQuestion({ user_id: u.id, text: "q", triage: "expert", status: "awaiting_approval", price_usd: "0.20" });
  assert.equal(db.transition(id, ["awaiting_approval"], "paying"), true);
  assert.equal(db.transition(id, ["awaiting_approval"], "paying"), false); // double tap
  assert.equal(db.transition(id, ["paying"], "paid", { payment_tx: "abc", paid_at: "2026-01-01 00:00:00" }), true);
  const eid = db.createExpert({ name: "M", email: "m@x.io", stellar_address: "G", cv_file: "f", cv_original_name: "cv.pdf" });
  assert.equal(db.transition(id, ["paid"], "claimed", { expert_id: eid }), true);
  assert.equal(db.transition(id, ["paid"], "claimed", { expert_id: eid }), false); // second expert can't claim
  assert.equal(db.overdueReviews(1).length, 1); // paid in 2026-01-01, so overdue
  assert.equal(db.stats().questions, 1);
});
