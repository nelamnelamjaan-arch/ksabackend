/**
 * PayPal REST config — production always uses live credentials; sandbox is rejected in production.
 */

export function isProductionRuntime() {
  return (
    process.env.NODE_ENV === "production" ||
    String(process.env.VERCEL_ENV || "").toLowerCase() === "production"
  );
}

/** @returns {"live" | "sandbox"} */
export function getPayPalMode() {
  const envMode = String(process.env.PAYPAL_MODE || "sandbox").toLowerCase();

  if (isProductionRuntime()) {
    if (envMode !== "live") {
      const err = new Error(
        "Production rejects PayPal sandbox — set PAYPAL_MODE=live and use live REST credentials"
      );
      err.status = 503;
      throw err;
    }
    return "live";
  }

  return envMode === "live" ? "live" : "sandbox";
}

export function getPayPalApiBase() {
  return getPayPalMode() === "live"
    ? "https://api-m.paypal.com"
    : "https://api-m.sandbox.paypal.com";
}

export function getPayPalClientId() {
  return String(process.env.PAYPAL_CLIENT_ID || "").trim();
}

export function getPayPalClientSecret() {
  return String(
    process.env.PAYPAL_CLIENT_SECRET || process.env.PAYPAL_SECRET_KEY || ""
  ).trim();
}

export function assertPayPalConfigured() {
  const clientId = getPayPalClientId();
  const secret = getPayPalClientSecret();
  if (!clientId || !secret) {
    const err = new Error(
      "PayPal is not configured (PAYPAL_CLIENT_ID / PAYPAL_CLIENT_SECRET)"
    );
    err.status = 503;
    throw err;
  }
  getPayPalMode();
  return { clientId, secret };
}
