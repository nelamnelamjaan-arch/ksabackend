/**
 * Firebase Cloud Messaging — server-side sends for price-drop alerts.
 *
 * Setup:
 * 1. Create a Firebase project → Project settings → Service accounts → Generate new private key.
 * 2. Set env `FIREBASE_SERVICE_ACCOUNT` to the **JSON object as a single line** (or use
 *    `FIREBASE_SERVICE_ACCOUNT_PATH` pointing to the downloaded `.json` file).
 *
 * Web clients register FCM tokens via `/api/alerts/price-watch` after obtaining a token
 * from the Firebase JS SDK + VAPID key (`VITE_FIREBASE_VAPID_KEY` on the client).
 */

import fs from "fs";
import admin from "firebase-admin";
import { getPrimaryClientOrigin } from "../../config/clientOrigins.js";

let initialized = false;

function loadServiceAccount() {
  const path = process.env.FIREBASE_SERVICE_ACCOUNT_PATH;
  if (path && fs.existsSync(path)) {
    const raw = fs.readFileSync(path, "utf8");
    return JSON.parse(raw);
  }
  const inline = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (inline) {
    return JSON.parse(inline);
  }
  return null;
}

function ensureFirebase() {
  if (initialized) return admin.apps.length > 0;
  const sa = loadServiceAccount();
  if (!sa) return false;
  try {
    if (!admin.apps.length) {
      admin.initializeApp({
        credential: admin.credential.cert(sa),
      });
    }
    initialized = true;
    return true;
  } catch (e) {
    console.warn("[FCM] init failed:", e.message);
    return false;
  }
}

/**
 * @param {{ tokens: string[]; title: string; body: string; data?: Record<string, string> }} payload
 */
export async function sendPriceDropMulticast(payload) {
  const tokens = [...new Set((payload.tokens || []).filter(Boolean))];
  if (!tokens.length) return { sent: 0, reason: "no_tokens" };

  if (!ensureFirebase()) {
    console.warn("[FCM] FIREBASE_SERVICE_ACCOUNT / FIREBASE_SERVICE_ACCOUNT_PATH not configured");
    return { sent: 0, reason: "not_configured" };
  }

  const data = {};
  for (const [k, v] of Object.entries(payload.data || {})) {
    data[String(k).slice(0, 40)] = String(v ?? "").slice(0, 500);
  }

  const res = await admin.messaging().sendEachForMulticast({
    tokens,
    notification: {
      title: String(payload.title || "KSA Store").slice(0, 120),
      body: String(payload.body || "").slice(0, 500),
    },
    data,
    webpush: {
      fcmOptions: {
        link: data.url || process.env.PUBLIC_SITE_URL || getPrimaryClientOrigin(),
      },
    },
  });

  const failures = res.responses.filter((r) => !r.success).length;
  if (failures) {
    console.warn("[FCM] partial failure", failures, "/", tokens.length);
  }
  return { sent: res.successCount, failureCount: failures };
}
