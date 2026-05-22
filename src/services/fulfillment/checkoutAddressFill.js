/**
 * Inject customer shipping address into marketplace checkout forms (Amazon / Noon).
 * Selectors vary by locale — we try several known patterns.
 */

/**
 * @param {import("../../models/Order.js").Order | object} order
 * @returns {import("../../models/Order.js").Order["fulfillmentVault"]["deliveryAddress"] | null}
 */
export function resolveOrderDeliveryAddress(order) {
  const raw =
    order?.fulfillmentVault?.deliveryAddress ||
    order?.customerDetails?.shippingAddress ||
    order?.profitSplit?.shippingAddress ||
    order?.dropshipFulfillment?.deliveryAddress ||
    null;
  if (!raw?.line1 || !raw?.city || !raw?.country) return null;
  return {
    fullName: String(raw.fullName || order?.customerDetails?.name || "").trim(),
    line1: String(raw.line1).trim(),
    line2: String(raw.line2 || "").trim(),
    city: String(raw.city).trim(),
    state: String(raw.state || "").trim(),
    postalCode: String(raw.postalCode || "").trim(),
    country: String(raw.country).trim().toUpperCase(),
    phone: String(raw.phone || "").trim(),
  };
}

function delay(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * @param {import("puppeteer").Page} page
 * @param {string[]} selectors
 * @param {string} value
 */
async function tryFill(page, selectors, value) {
  if (!value) return false;
  for (const sel of selectors) {
    try {
      const el = await page.$(sel);
      if (!el) continue;
      await el.click({ clickCount: 3 });
      await el.type(value, { delay: 35 });
      return true;
    } catch {
      /* next selector */
    }
  }
  return false;
}

/**
 * @param {import("puppeteer").Page} page
 * @param {{ fullName: string, line1: string, line2?: string, city: string, state?: string, postalCode?: string, country: string, phone?: string }} address
 * @param {"amazon" | "noon"} marketplace
 */
export async function fillCheckoutAddress(page, address, marketplace = "amazon") {
  if (!address?.line1) {
    throw new Error("checkout_address_missing");
  }

  await delay(600);

  if (marketplace === "noon") {
    await tryFill(page, ['input[name="firstName"]', "#firstName", 'input[placeholder*="First"]'], address.fullName.split(" ")[0] || address.fullName);
    await tryFill(page, ['input[name="lastName"]', "#lastName"], address.fullName.split(" ").slice(1).join(" ") || "-");
    await tryFill(page, ['input[name="streetAddress"]', 'input[name="address"]', "#streetAddress"], address.line1);
    await tryFill(page, ['input[name="addressLine2"]', "#addressLine2"], address.line2);
    await tryFill(page, ['input[name="city"]', "#city"], address.city);
    await tryFill(page, ['input[name="phone"]', "#phone", 'input[type="tel"]'], address.phone);
    return;
  }

  // Amazon address widget (SA / AE / .com variants)
  await tryFill(page, [
    "#enterAddressFullName",
    'input[name="enterAddressFullName"]',
    "#address-ui-widgets-enterAddressFullName",
    'input[data-field="name"]',
    "#shipaddress-full-name",
  ], address.fullName);

  await tryFill(page, [
    "#enterAddressAddressLine1",
    'input[name="enterAddressAddressLine1"]',
    "#address-ui-widgets-enterAddressLine1",
    'input[data-field="addressLine1"]',
    "#shipaddress-address-line1",
  ], address.line1);

  if (address.line2) {
    await tryFill(page, [
      "#enterAddressAddressLine2",
      'input[name="enterAddressAddressLine2"]',
      "#address-ui-widgets-enterAddressLine2",
    ], address.line2);
  }

  await tryFill(page, [
    "#enterAddressCity",
    'input[name="enterAddressCity"]',
    "#address-ui-widgets-enterAddressCity",
    "#shipaddress-city",
  ], address.city);

  if (address.state) {
    await tryFill(page, [
      "#enterAddressStateOrRegion",
      'input[name="enterAddressStateOrRegion"]',
      "#address-ui-widgets-enterAddressStateOrRegion",
    ], address.state);
  }

  await tryFill(page, [
    "#enterAddressPostalCode",
    'input[name="enterAddressPostalCode"]',
    "#address-ui-widgets-enterAddressPostalCode",
    "#shipaddress-postal-code",
  ], address.postalCode);

  await tryFill(page, [
    "#enterAddressPhoneNumber",
    'input[name="enterAddressPhoneNumber"]',
    "#address-ui-widgets-enterAddressPhoneNumber",
    'input[type="tel"]',
  ], address.phone);

  // Country dropdown — often pre-set from TLD; attempt select if visible
  try {
    const countrySel = await page.$('select[name="address-ui-widgets-countryCode"], #enterAddressCountryCode');
    if (countrySel && address.country) {
      await page.select('select[name="address-ui-widgets-countryCode"], #enterAddressCountryCode', address.country);
    }
  } catch {
    /* optional */
  }
}

/**
 * @param {import("puppeteer").Page} page
 */
export async function detectCaptchaOrBlock(page) {
  const url = page.url();
  const title = await page.title().catch(() => "");
  const body = await page.evaluate(() => document.body?.innerText?.slice(0, 4000) || "").catch(() => "");
  const hay = `${url} ${title} ${body}`.toLowerCase();
  if (/captcha|robot check|sorry, we just need to make sure|type the characters/i.test(hay)) {
    return "captcha";
  }
  if (/otp|one-time password|verification code|enter the code|2fa|two-factor/i.test(hay)) {
    return "otp_required";
  }
  if (/out of stock|currently unavailable|no longer available/i.test(hay)) {
    return "out_of_stock";
  }
  if (/sign in|ap_signin|authportal/i.test(url) && /password|email/i.test(hay)) {
    return "login_required";
  }
  return null;
}
