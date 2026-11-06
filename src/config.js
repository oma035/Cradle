import "dotenv/config";

const NETWORKS = {
  testnet: {
    x402Network: "stellar:testnet",
    horizonUrl: "https://horizon-testnet.stellar.org",
    rpcUrl: "https://soroban-testnet.stellar.org",
    passphrase: "Test SDF Network ; September 2015",
    facilitatorUrl: "https://channels.openzeppelin.com/x402/testnet",
    usdcIssuer: "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5",
    explorer: "https://stellar.expert/explorer/testnet",
  },
  mainnet: {
    x402Network: "stellar:pubnet",
    horizonUrl: "https://horizon.stellar.org",
    rpcUrl: "",
    passphrase: "Public Global Stellar Network ; September 2015",
    facilitatorUrl: "https://channels.openzeppelin.com/x402",
    usdcIssuer: "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN",
    explorer: "https://stellar.expert/explorer/public",
  },
};

const env = process.env;
const networkName = (env.CRADLE_NETWORK || "testnet").toLowerCase();
if (!NETWORKS[networkName]) {
  throw new Error(`CRADLE_NETWORK must be "testnet" or "mainnet", got "${networkName}"`);
}
const net = NETWORKS[networkName];

export const config = {
  networkName,
  isMainnet: networkName === "mainnet",
  x402Network: net.x402Network,
  horizonUrl: env.HORIZON_URL || net.horizonUrl,
  rpcUrl: env.STELLAR_RPC_URL || net.rpcUrl,
  passphrase: net.passphrase,
  facilitatorUrl: env.FACILITATOR_URL || net.facilitatorUrl,
  usdcIssuer: env.USDC_ISSUER || net.usdcIssuer,
  explorer: net.explorer,

  ozApiKey: env.OZ_API_KEY || "",
  treasurySecret: env.TREASURY_SECRET || "",
  masterKey: env.MASTER_KEY || "",

  telegramToken: env.TELEGRAM_BOT_TOKEN || "",
  telegramUsername: env.TELEGRAM_BOT_USERNAME || "CradleCareBot",

  anthropicKey: env.ANTHROPIC_API_KEY || "",
  anthropicModel: env.ANTHROPIC_MODEL || "claude-sonnet-5-5",

  port: Number(env.PORT || 3000),
  publicUrl: (env.PUBLIC_URL || `http://localhost:${env.PORT || 3000}`).replace(/\/$/, ""),
  adminPassword: env.ADMIN_PASSWORD || "",

  reviewPriceUsd: env.REVIEW_PRICE_USD || "0.20",
  expertSharePercent: Number(env.EXPERT_SHARE_PERCENT || 100),
  reviewTimeoutMinutes: Number(env.REVIEW_TIMEOUT_MINUTES || 120),

  dbPath: env.DB_PATH || "data/cradle.db",
  uploadDir: env.UPLOAD_DIR || "data/uploads",
};

export function txLink(hash) {
  return hash ? `${config.explorer}/tx/${hash}` : "";
}
export function accountLink(address) {
  return `${config.explorer}/account/${address}`;
}

/** Returns a list of missing settings so startup can fail with a clear message. */
export function missingConfig() {
  const missing = [];
  if (!config.ozApiKey) missing.push("OZ_API_KEY");
  if (!config.treasurySecret) missing.push("TREASURY_SECRET");
  if (!/^[0-9a-f]{64}$/i.test(config.masterKey)) missing.push("MASTER_KEY (64 hex chars)");
  if (!config.telegramToken) missing.push("TELEGRAM_BOT_TOKEN");
  if (!config.anthropicKey) missing.push("ANTHROPIC_API_KEY");
  if (!config.adminPassword || config.adminPassword === "change-me") missing.push("ADMIN_PASSWORD");
  if (!config.rpcUrl) missing.push("STELLAR_RPC_URL (required on mainnet)");
  return missing;
}
