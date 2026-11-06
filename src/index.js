import express from "express";
import { config, missingConfig } from "./config.js";
import { openDb } from "./db.js";
import { makeTelegram } from "./telegram.js";
import { makeReviews } from "./reviews.js";
import { makeBot } from "./bot.js";
import { x402Router } from "./x402-server.js";
import { webRouter } from "./web.js";

const missing = missingConfig();
if (missing.length) {
  console.error(`\nCradle can't start. Set these in .env:\n  - ${missing.join("\n  - ")}\n`);
  process.exit(1);
}

const db = openDb(config.dbPath);
const tg = makeTelegram(config.telegramToken);
const reviews = makeReviews(db, (chatId, text) => tg.send(chatId, text));

const app = express();
app.disable("x-powered-by");
app.set("trust proxy", 1);
app.use(x402Router(db));
app.use(webRouter(db, reviews));

app.listen(config.port, () => {
  console.log(`\nCradle running on ${config.publicUrl} (${config.networkName.toUpperCase()})`);
  if (config.isMainnet) console.log("⚠️  MAINNET: payments use real USDC.");
  console.log(`   Admin:  ${config.publicUrl}/admin  (user: admin)`);
  console.log(`   Bot:    https://t.me/${config.telegramUsername}\n`);
});

tg.poll(makeBot(db, tg, reviews));

// Refund unanswered paid reviews every minute.
setInterval(() => reviews.refundOverdue().catch((e) => console.error("[refunds]", e)), 60_000);
