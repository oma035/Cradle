// Admin sign-in: email + password, signed session cookie, and a lockout after repeated failures.
import crypto from "node:crypto";
import { config } from "./config.js";
import { safeEqual } from "./secrets.js";

const COOKIE = "cradle_admin";
const SESSION_HOURS = 12;
const MAX_FAILS = 5;
const LOCK_MINUTES = 15;
const fails = new Map(); // ip -> { count, until }

const sessionKey = () => crypto.createHmac("sha256", Buffer.from(config.masterKey, "hex")).update("cradle-admin-session").digest();

function sign(payload) {
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const mac = crypto.createHmac("sha256", sessionKey()).update(body).digest("base64url");
  return `${body}.${mac}`;
}

function verify(token) {
  const [body, mac] = String(token || "").split(".");
  if (!body || !mac) return null;
  const expected = crypto.createHmac("sha256", sessionKey()).update(body).digest("base64url");
  if (!safeEqual(mac, expected)) return null;
  try {
    const data = JSON.parse(Buffer.from(body, "base64url").toString());
    // A session is only valid for the current email/password (changing either logs everyone out).
    if (data.exp < Date.now() || data.v !== credentialVersion()) return null;
    return data;
  } catch {
    return null;
  }
}

function credentialVersion() {
  return crypto.createHash("sha256").update(`${config.adminEmail}:${config.adminPassword}`).digest("base64url").slice(0, 12);
}

function readCookie(req, name) {
  for (const part of String(req.headers.cookie || "").split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === name) return decodeURIComponent(v.join("="));
  }
  return "";
}

function cookieAttrs(req, maxAgeSeconds) {
  return [`Path=${config.adminPath}`, "HttpOnly", "SameSite=Strict", `Max-Age=${maxAgeSeconds}`, req.secure ? "Secure" : ""]
    .filter(Boolean)
    .join("; ");
}

export function isAdmin(req) {
  return Boolean(verify(readCookie(req, COOKIE)));
}

/** Checks the login form. Returns { ok } or { ok: false, locked, minutes }. */
export function tryLogin(req, res, email, password) {
  const ip = req.ip || "unknown";
  const entry = fails.get(ip);
  if (entry && entry.until > Date.now()) {
    return { ok: false, locked: true, minutes: Math.ceil((entry.until - Date.now()) / 60000) };
  }
  const emailOk = safeEqual(String(email || "").trim().toLowerCase(), config.adminEmail);
  const passOk = safeEqual(String(password || ""), config.adminPassword);
  if (!(emailOk && passOk)) {
    const count = (entry && entry.until <= Date.now() && entry.count >= MAX_FAILS ? 0 : entry?.count || 0) + 1;
    fails.set(ip, { count, until: count >= MAX_FAILS ? Date.now() + LOCK_MINUTES * 60000 : 0 });
    return count >= MAX_FAILS ? { ok: false, locked: true, minutes: LOCK_MINUTES } : { ok: false };
  }
  fails.delete(ip);
  const token = sign({ exp: Date.now() + SESSION_HOURS * 3600000, v: credentialVersion() });
  res.append("Set-Cookie", `${COOKIE}=${token}; ${cookieAttrs(req, SESSION_HOURS * 3600)}`);
  return { ok: true };
}

export function logout(req, res) {
  res.append("Set-Cookie", `${COOKIE}=; ${cookieAttrs(req, 0)}`);
}
