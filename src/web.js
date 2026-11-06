// Website, expert portal API and admin API.
import express from "express";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { config, txLink, accountLink } from "./config.js";
import { randomToken, safeEqual } from "./secrets.js";
import { balances, isValidAddress, treasury } from "./stellar.js";
import { shareOf } from "./money.js";

const PUBLIC = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "public");
const CV_TYPES = {
  "application/pdf": ".pdf",
  "application/msword": ".doc",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": ".docx",
  "image/png": ".png",
  "image/jpeg": ".jpg",
};
const MAX_CV_BYTES = 5 * 1024 * 1024;

export function webRouter(db, reviews) {
  const r = express.Router();
  fs.mkdirSync(config.uploadDir, { recursive: true });

  const page = (file) => (_req, res) => res.sendFile(path.join(PUBLIC, file));
  r.get("/", page("index.html"));
  r.get("/signup", page("signup.html"));
  r.get("/signup/expert", page("expert-apply.html"));
  r.get("/terms", page("terms.html"));
  r.get("/expert", page("expert.html"));
  r.get("/admin", adminAuth, page("admin.html"));
  r.use("/static", express.static(PUBLIC, { index: false }));

  r.get("/api/public/config", (_req, res) =>
    res.json({
      botUrl: `https://t.me/${config.telegramUsername}`,
      price: config.reviewPriceUsd,
      network: config.networkName,
      expertShare: shareOf(config.reviewPriceUsd, config.expertSharePercent),
    })
  );

  // ---------- Expert applications ----------
  r.post("/api/experts/apply", express.json({ limit: "8mb" }), async (req, res) => {
    const { name, email, profession, stellar_address, agree, cv } = req.body || {};
    const errors = [];
    if (!String(name || "").trim()) errors.push("Your full name is required.");
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email || ""))) errors.push("A valid email is required.");
    if (!isValidAddress(stellar_address)) errors.push("A valid Stellar address (starts with G) is required.");
    if (agree !== true) errors.push("You must agree to the terms and conditions.");
    const ext = cv && CV_TYPES[cv.type];
    if (!ext) errors.push("Upload your CV or certificate as PDF, Word, PNG or JPG.");
    const bytes = ext ? Buffer.from(String(cv.data || ""), "base64") : null;
    if (bytes && (bytes.length === 0 || bytes.length > MAX_CV_BYTES)) errors.push("The CV file must be under 5 MB.");
    if (errors.length) return res.status(400).json({ errors });

    try {
      const b = await balances(stellar_address.trim());
      if (!b.exists || !b.hasTrustline) {
        return res.status(400).json({
          errors: ["Your Stellar wallet must be active and able to receive USDC (add a USDC trustline in your wallet app, e.g. Lobstr), so we can pay you."],
        });
      }
    } catch {
      return res.status(502).json({ errors: ["We couldn't check your wallet on Stellar right now. Please try again."] });
    }

    const file = `${randomToken(16)}${ext}`;
    fs.writeFileSync(path.join(config.uploadDir, file), bytes);
    const id = db.createExpert({
      name: String(name).trim().slice(0, 120),
      email: String(email).trim().slice(0, 200),
      profession: String(profession || "").trim().slice(0, 120),
      stellar_address: stellar_address.trim(),
      cv_file: file,
      cv_original_name: String(cv.name || `cv${ext}`).slice(0, 200),
    });
    res.json({ ok: true, id });
  });

  // ---------- Expert portal ----------
  const expertAuth = (req, res, next) => {
    const e = db.expertByToken(String(req.get("x-expert-token") || ""));
    if (!e) return res.status(401).json({ error: "Invalid or inactive expert link." });
    req.expert = e;
    next();
  };
  r.get("/api/expert/me", expertAuth, (req, res) =>
    res.json({ name: req.expert.name, profession: req.expert.profession, address: req.expert.stellar_address, payout: shareOf(config.reviewPriceUsd, config.expertSharePercent) })
  );
  r.get("/api/expert/reviews", expertAuth, (req, res) => {
    const open = db.openReviews().filter((q) => q.status === "paid" || q.expert_id === req.expert.id);
    const history = db.expertHistory(req.expert.id).map((q) => ({ ...q, payout_link: txLink(q.payout_tx) }));
    res.json({ open, history });
  });
  r.post("/api/expert/reviews/:id/claim", expertAuth, (req, res) => {
    const ok = reviews.claim(Number(req.params.id), req.expert);
    res.status(ok ? 200 : 409).json(ok ? { ok } : { error: "Someone else already took this question." });
  });
  r.post("/api/expert/reviews/:id/answer", expertAuth, express.json({ limit: "32kb" }), async (req, res) => {
    const answer = String(req.body?.answer || "").trim();
    if (answer.length < 20) return res.status(400).json({ error: "Please write a fuller answer (at least 20 characters)." });
    const out = await reviews.answer(Number(req.params.id), req.expert, answer.slice(0, 4000));
    res.status(out.ok ? 200 : 409).json({ ...out, payout_link: txLink(out.payoutTx) });
  });

  // ---------- Admin ----------
  r.get("/api/admin/overview", adminAuth, async (_req, res) => {
    let treasuryInfo = { address: treasury().publicKey() };
    try {
      treasuryInfo = { ...treasuryInfo, ...(await balances(treasuryInfo.address)) };
    } catch { /* show without balances */ }
    treasuryInfo.link = accountLink(treasuryInfo.address);
    res.json({
      network: config.networkName,
      explorer: config.explorer,
      stats: db.stats(),
      treasury: treasuryInfo,
      experts: db.listExperts().map(({ access_token, ...e }) => ({ ...e, has_link: Boolean(access_token) })),
      users: db.listUsers(),
      questions: db.listQuestions(),
      payments: db.listPayments(),
    });
  });
  r.post("/api/admin/experts/:id/:decision(approve|reject)", adminAuth, (req, res) => {
    const e = db.expertById(Number(req.params.id));
    if (!e) return res.status(404).json({ error: "Not found" });
    if (req.params.decision === "reject") {
      db.reviewExpert(e.id, "rejected", null);
      return res.json({ ok: true });
    }
    const token = e.access_token || randomToken(24);
    db.reviewExpert(e.id, "approved", token);
    res.json({ ok: true, portal: `${config.publicUrl}/expert#${token}` });
  });
  r.get("/api/admin/experts/:id/portal-link", adminAuth, (req, res) => {
    const e = db.expertById(Number(req.params.id));
    if (!e?.access_token) return res.status(404).json({ error: "Not approved" });
    res.json({ portal: `${config.publicUrl}/expert#${e.access_token}` });
  });
  r.get("/api/admin/experts/:id/cv", adminAuth, (req, res) => {
    const e = db.expertById(Number(req.params.id));
    if (!e?.cv_file) return res.status(404).send("Not found");
    res.download(path.join(path.resolve(config.uploadDir), path.basename(e.cv_file)), e.cv_original_name);
  });
  r.post("/api/admin/questions/:id/retry-payout", adminAuth, async (req, res) => {
    res.json(await reviews.retryPayout(Number(req.params.id)));
  });

  return r;
}

/** HTTP Basic auth for the admin area. Username: admin, password: ADMIN_PASSWORD. */
function adminAuth(req, res, next) {
  const [scheme, encoded] = String(req.get("authorization") || "").split(" ");
  if (scheme === "Basic" && encoded) {
    const [user, ...rest] = Buffer.from(encoded, "base64").toString().split(":");
    if (user === "admin" && config.adminPassword && safeEqual(rest.join(":"), config.adminPassword)) return next();
  }
  res.set("WWW-Authenticate", 'Basic realm="Cradle admin"').status(401).send("Authentication required");
}
