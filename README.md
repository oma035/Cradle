# Cradle 🤰🏾✿

A maternal-health AI agent on Telegram that **pays verified midwives per answer** using **x402 on Stellar**.
Built for *EmpowerHer: Building the Agent Economy*.

## How it works

1. A mother messages the Telegram bot. `/create` makes her a Stellar wallet. Cradle sponsors the XLM reserve, so she only needs USDC.
2. A **red-flag screen** runs first. If she mentions a danger sign (bleeding, severe headache, fits, reduced baby movement…), Cradle tells her to go to a hospital and doesn't try to answer.
3. The **Claude agent** decides: answer **free** from basic guidance, or escalate to a **paid midwife review**.
4. For a review, she sees **Approve / Decline** buttons. On Approve, the agent calls Cradle's x402-protected endpoint `POST /api/reviews`. It gets back `402 Payment Required: $0.20`, signs the payment with her wallet, and the OpenZeppelin facilitator settles it in USDC on Stellar into the **Cradle escrow (treasury)** wallet.
5. An approved expert claims and answers the question in the **reviewer portal**. Cradle immediately pays the expert from escrow, then sends the mother the answer plus a **receipt** with both Stellar explorer links.
6. If no expert answers within `REVIEW_TIMEOUT_MINUTES`, the mother is **refunded automatically**.

Why escrow? x402 settles within a single HTTP request, but a human review can take an hour. So the paid request buys a review ticket, and the expert is paid when they deliver.

## Pages

| URL | What |
|---|---|
| `/` | Landing page |
| `/signup` | Choose **Mother** (opens the bot) or **Expert** |
| `/signup/expert` | Expert application: name, email, profession, CV upload, payout wallet, terms |
| `/expert#<token>` | Private reviewer portal (link given when the admin approves) |
| `/admin` | Admin: applications (approve/reject, download CV), users, questions, payment history, treasury balance. Login `admin` / `ADMIN_PASSWORD` |

## Setup

Requires **Node.js 22.13+** (uses the built-in `node:sqlite`, so there's no database to install).

```bash
npm install
cp .env.example .env
```

Fill in `.env`:

1. **Telegram bot**: create one with [@BotFather](https://t.me/BotFather) and set `TELEGRAM_BOT_TOKEN` and `TELEGRAM_BOT_USERNAME`.
2. **Claude**: `ANTHROPIC_API_KEY` from console.anthropic.com.
3. **OpenZeppelin facilitator key**: `OZ_API_KEY`. Mainnet: https://channels.openzeppelin.com/gen · Testnet: https://channels.openzeppelin.com/testnet/gen
4. **Master key**: `MASTER_KEY` (encrypts mothers' wallet keys):
   `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`
5. **Stellar RPC**: `STELLAR_RPC_URL`. Required on mainnet (use a Stellar RPC provider); testnet has a default.
6. **Treasury wallet**:
   ```bash
   npm run setup:treasury          # prints a new keypair: put the secret in TREASURY_SECRET
   # fund the address with XLM (mainnet: ~10 XLM; testnet: friendbot link is printed)
   npm run setup:treasury -- --trust   # adds the USDC trustline
   ```
7. `ADMIN_PASSWORD`, and `PUBLIC_URL` once deployed.

Run:

```bash
npm start
npm test        # red-flag, money math, encryption and state-machine tests
```

## Going mainnet ⚠️ (real money)

Switching networks only needs `.env` changes, with no code changes:

```
CRADLE_NETWORK=mainnet
OZ_API_KEY=<mainnet key>
STELLAR_RPC_URL=<mainnet RPC>
TREASURY_SECRET=<a mainnet treasury, funded with XLM + USDC trustline>
```

Recommended order: run the whole flow once on `testnet`, then switch. On mainnet:

- **Keep the treasury small.** It holds escrowed USDC and XLM for sponsoring wallets. Top it up as needed.
- **Each new mother wallet locks ~1.5 XLM** from the treasury (account + trustline reserve, sponsored).
- **Mothers fund wallets with real USDC on Stellar** (for example from an exchange or a wallet app like Lobstr). For Demo Day, pre-fund a few demo wallets yourself with $1 of USDC.
- **Experts' payout addresses must have a USDC trustline.** The application form checks this.
- **Custody:** Cradle holds mothers' keys (AES-256-GCM encrypted with `MASTER_KEY`). Never commit `.env`, back up `MASTER_KEY` safely, and say clearly in your pitch that this is a custodial MVP.

## Project layout

```
src/
  index.js        starts web server, Telegram polling, refund timer
  config.js       testnet/mainnet switch
  agent.js        Claude triage (emergency | free | expert)
  redflags.js     deterministic danger-sign screen (runs before the AI)
  x402-server.js  POST /api/reviews, protected by x402 (pays into escrow)
  x402-client.js  agent pays x402 from the mother's wallet
  reviews.js      escrow lifecycle: pay → claim → answer → payout | refund
  stellar.js      sponsored wallets, USDC transfers, balances
  bot.js          Telegram conversation
  web.js          landing, expert application, portal + admin APIs
  db.js           SQLite schema and queries
public/           landing, signup, expert apply, portal, admin, terms
```

## Safety notes

- Cradle gives general guidance, not diagnoses. The red-flag list in `src/redflags.js` should be reviewed by a clinician and extended with local-language terms.
- If the AI's output can't be parsed, the question goes to an expert (never a silent free answer).
- Experts never see the mother's name.
- `public/terms.html` is a draft. Get it reviewed before a public launch.
