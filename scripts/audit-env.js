import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const envPath = path.join(__dirname, "..", ".env");

const REQUIRED = [
  "MONGODB_URI",
  "JWT_SECRET",
  "ADMIN_USERNAME",
  "ADMIN_PASSWORD",
  "RAINFOREST_API_KEY",
  "GEMINI_API_KEY",
  "FIXER_API_KEY",
];

const FEATURE_KEYS = {
  "Magic Import + AI": ["RAINFOREST_API_KEY", "GEMINI_API_KEY"],
  "Currency (PK/SAR)": ["EXCHANGERATE_API_KEY", "FIXER_API_KEY"],
  "Global tracking (AfterShip)": ["AFTERSHIP_API_KEY"],
  "Transactional email — Resend (order / payment / shipping)": ["RESEND_API_KEY", "RESEND_FROM"],
  "Product reel videos (Shotstack)": ["SHOTSTACK_API_KEY", "VIDEO_GENERATOR_ENABLED"],
  "PayPal checkout + profit payout": ["PAYPAL_CLIENT_ID", "PAYPAL_CLIENT_SECRET", "PAYPAL_PROFIT_RECEIVER_EMAIL"],
  "Bank transfer receipts": ["CLOUDINARY_CLOUD_NAME", "CLOUDINARY_API_KEY", "CLOUDINARY_API_SECRET"],
  "Daily profit email": ["SMTP_HOST", "SMTP_USER", "SMTP_PASS", "ENABLE_DAILY_PROFIT_REPORT"],
  "Google sign-in (client)": ["GOOGLE_CLIENT_ID"],
  "Stripe checkout": ["STRIPE_SECRET_KEY", "STRIPE_PUBLISHABLE_KEY"],
  "SerpApi (optional scrape)": ["SERPAPI_API_KEY"],
  "Redis cache (optional)": ["REDIS_URL"],
};

function parseEnv(file) {
  const out = {};
  if (!fs.existsSync(file)) return out;
  for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const i = t.indexOf("=");
    if (i < 0) continue;
    const k = t.slice(0, i).trim();
    let v = t.slice(i + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1);
    }
    out[k] = v;
  }
  return out;
}

function status(v) {
  if (v === undefined) return "MISSING";
  if (!v) return "EMPTY";
  if (v === "change-me-in-production") return "PLACEHOLDER";
  if (v.includes("…") || v === "...") return "PLACEHOLDER";
  return "OK";
}

const env = parseEnv(envPath);
if (!fs.existsSync(envPath)) {
  console.log("ERROR: server/.env file not found");
  process.exit(1);
}

console.log("ENV_AUDIT_START");
for (const k of REQUIRED) {
  console.log(`REQUIRED|${k}|${status(env[k])}`);
}
for (const [feature, keys] of Object.entries(FEATURE_KEYS)) {
  for (const k of keys) {
    console.log(`FEATURE|${feature}|${k}|${status(env[k])}`);
  }
}
const example = fs.readFileSync(path.join(__dirname, "..", ".env.example"), "utf8");
const exampleKeys = [...example.matchAll(/^([A-Z][A-Z0-9_]*)=/gm)].map((m) => m[1]);
for (const k of exampleKeys) {
  if (!(k in env)) console.log(`EXTRA_IN_EXAMPLE|${k}|MISSING_FROM_ENV`);
}
console.log("ENV_AUDIT_END");
