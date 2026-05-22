/** Map unified SUPPLIER_* env → legacy AMAZON_* / NOON_* worker vars. */

export function syncSupplierEnvAliases() {
  const map = [
    ["SUPPLIER_AMAZON_EMAIL", "AMAZON_BUYER_EMAIL"],
    ["SUPPLIER_AMAZON_PASSWORD", "AMAZON_BUYER_PASSWORD"],
    ["SUPPLIER_NOON_EMAIL", "NOON_BUYER_EMAIL"],
    ["SUPPLIER_NOON_PASSWORD", "NOON_BUYER_PASSWORD"],
  ];
  for (const [from, to] of map) {
    const v = String(process.env[from] || "").trim();
    if (v && !String(process.env[to] || "").trim()) {
      process.env[to] = v;
    }
  }
  if (String(process.env.SUPPLIER_AUTO_PAY || "").toLowerCase() === "true") {
    process.env.AMAZON_AUTO_SUBMIT_PAYMENT = "true";
    process.env.NOON_AUTO_SUBMIT_PAYMENT = "true";
  }
}

export function hasAnySupplierCredentials() {
  syncSupplierEnvAliases();
  const amazon =
    (process.env.SUPPLIER_AMAZON_EMAIL && process.env.SUPPLIER_AMAZON_PASSWORD) ||
    (process.env.AMAZON_BUYER_EMAIL && process.env.AMAZON_BUYER_PASSWORD) ||
    process.env.AMAZON_SESSION_COOKIES;
  const noon =
    (process.env.SUPPLIER_NOON_EMAIL && process.env.SUPPLIER_NOON_PASSWORD) ||
    (process.env.NOON_BUYER_EMAIL && process.env.NOON_BUYER_PASSWORD) ||
    process.env.NOON_SESSION_COOKIES;
  return Boolean(amazon || noon);
}

/** True when SUPPLIER_AUTO_PAY=true or legacy *_AUTO_SUBMIT_PAYMENT flags are set. */
export function isSupplierAutoPayEnabled() {
  syncSupplierEnvAliases();
  return (
    String(process.env.SUPPLIER_AUTO_PAY || "").toLowerCase() === "true" ||
    String(process.env.AMAZON_AUTO_SUBMIT_PAYMENT || "").toLowerCase() === "true" ||
    String(process.env.NOON_AUTO_SUBMIT_PAYMENT || "").toLowerCase() === "true"
  );
}
