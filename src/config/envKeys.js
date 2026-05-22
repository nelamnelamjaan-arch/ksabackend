/**
 * Central accessors for API keys — always read from process.env.
 */

export function getRainforestApiKey() {
  return process.env.RAINFOREST_API_KEY || "";
}

export function getGeminiApiKey() {
  return process.env.GEMINI_API_KEY || process.env.GOOGLE_AI_API_KEY || "";
}

export function getSerpApiKey() {
  return process.env.SERPAPI_API_KEY || process.env.SERP_API_KEY || "";
}

export function getAmazonPaApiKeyPair() {
  const accessKey = String(process.env.AMAZON_ACCESS_KEY || "").trim();
  const secretKey = String(process.env.AMAZON_SECRET_KEY || "").trim();
  if (!accessKey || !secretKey) return null;
  return { accessKey, secretKey };
}

export function getAmazonAssociateTag() {
  return String(process.env.AMAZON_ASSOCIATE_TAG || process.env.AMAZON_PARTNER_TAG || "").trim();
}

export function getAliExpressAppKey() {
  return String(process.env.ALIEXPRESS_APP_KEY || "").trim();
}

export function getFixerApiKey() {
  return process.env.FIXER_API_KEY || "";
}

export function getExchangeRateApiKey() {
  return process.env.EXCHANGERATE_API_KEY || process.env.EXCHANGE_RATE_API_KEY || "";
}

export function getAftershipApiKey() {
  return process.env.AFTERSHIP_API_KEY || "";
}

export function getResendApiKey() {
  return process.env.RESEND_API_KEY || "";
}

export function getResendFromAddress() {
  return (
    process.env.RESEND_FROM ||
    process.env.SMTP_FROM ||
    "KSA Store <orders@ksastore.com>"
  );
}

export function getPublicSiteUrl() {
  return (
    process.env.PUBLIC_SITE_URL ||
    process.env.ADMIN_DASHBOARD_URL ||
    "http://localhost:5173"
  );
}

export function getShotstackApiKey() {
  return process.env.SHOTSTACK_API_KEY || "";
}

/** `stage` / `sandbox` → Shotstack sandbox; `v1` / `production` / `live` → production API */
export function getShotstackApiVersion() {
  const env = String(process.env.SHOTSTACK_ENV || process.env.SHOTSTACK_API_VERSION || "v1")
    .trim()
    .toLowerCase();
  if (env === "stage" || env === "sandbox" || env === "staging") return "stage";
  return "v1";
}

export function getPayPalClientSecret() {
  return process.env.PAYPAL_CLIENT_SECRET || process.env.PAYPAL_SECRET_KEY || "";
}

export function getCloudinaryConfig() {
  const url = process.env.CLOUDINARY_URL;
  if (url && url.startsWith("cloudinary://")) {
    try {
      const parsed = new URL(url.replace("cloudinary://", "https://"));
      return {
        cloud_name: parsed.hostname,
        api_key: decodeURIComponent(parsed.username || ""),
        api_secret: decodeURIComponent(parsed.password || ""),
      };
    } catch {
      /* fall through */
    }
  }
  return {
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME || "",
    api_key: process.env.CLOUDINARY_API_KEY || "",
    api_secret: process.env.CLOUDINARY_API_SECRET || "",
  };
}
