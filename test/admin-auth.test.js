import { test } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";

process.env.MASTER_KEY = crypto.randomBytes(32).toString("hex");
process.env.ADMIN_EMAIL = "Boss@Cradle.app";
process.env.ADMIN_PASSWORD = "correct horse battery";
process.env.ADMIN_PATH = "console-abcdef1234567890";
const { tryLogin, isAdmin } = await import("../src/admin-auth.js");
const { config } = await import("../src/config.js");

const fakeRes = () => { const h = []; return { h, append: (k, v) => h.push(v) }; };
const reqWith = (cookieHeader = "", ip = "1.1.1.1") => ({ ip, secure: true, headers: { cookie: cookieHeader } });
const cookieOf = (res) => res.h[0].split(";")[0];

test("admin path is normalised", () => assert.equal(config.adminPath, "/console-abcdef1234567890"));

test("correct email (any case) + password signs in", () => {
  const res = fakeRes();
  assert.equal(tryLogin(reqWith(), res, " boss@cradle.app ", "correct horse battery").ok, true);
  assert.match(res.h[0], /HttpOnly; SameSite=Strict/);
  assert.match(res.h[0], /Path=\/console-abcdef1234567890/);
  assert.equal(isAdmin(reqWith(cookieOf(res))), true);
});

test("wrong password or email is refused, tampered cookie is refused", () => {
  assert.equal(tryLogin(reqWith("", "2.2.2.2"), fakeRes(), "boss@cradle.app", "nope").ok, false);
  assert.equal(tryLogin(reqWith("", "2.2.2.2"), fakeRes(), "other@cradle.app", "correct horse battery").ok, false);
  assert.equal(isAdmin(reqWith("cradle_admin=abc.def")), false);
  assert.equal(isAdmin(reqWith("")), false);
});

test("locks out after 5 failures, even with the right password", () => {
  const ip = "3.3.3.3";
  let out;
  for (let i = 0; i < 5; i++) out = tryLogin(reqWith("", ip), fakeRes(), "x@y.z", "bad");
  assert.equal(out.locked, true);
  assert.equal(tryLogin(reqWith("", ip), fakeRes(), "boss@cradle.app", "correct horse battery").ok, false);
});

test("changing the password logs out existing sessions", () => {
  const res = fakeRes();
  tryLogin(reqWith("", "4.4.4.4"), res, "boss@cradle.app", "correct horse battery");
  const c = cookieOf(res);
  config.adminPassword = "a brand new password";
  assert.equal(isAdmin(reqWith(c)), false);
});
