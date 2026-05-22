import mongoose from "mongoose";
import { nextSequence } from "../../models/Counter.js";
import { Order } from "../../models/Order.js";
import { Product, ORIGIN_TYPES } from "../../models/Product.js";
import { Shop } from "../../models/Shop.js";
import { User } from "../../models/User.js";
import { Category, CATALOG_KEYS } from "../../models/Category.js";
import { PlatformSettings } from "../../models/PlatformSettings.js";
import { VendorWallet } from "../../models/VendorWallet.js";
import { computeVendorPayoutAndPlatformSplits } from "../revenue/commissionCalculation.js";
import { recordOrderRevenueLedger } from "../revenue/ledgerService.js";
import { deriveSourceVendorLabel } from "../../utils/legal/sourceVendorLabel.js";
import { computeCoinsEarned, resolveCoinRedemption } from "../rewards/ksaCoins.js";
import {
  assertProfitFirstPrice,
  buildMagicImportSnapshot,
} from "../checkout/profitFirstPricing.js";
import { notifyAdminOrderFulfillment } from "./fulfillmentNotify.js";
import { submitRainforestDropshipBlueprint } from "../fulfillment/rainforestDropshipFulfillment.js";
import { executeProfitSplitAfterPayment } from "../payments/profitSplitService.js";
import { creditPlatformProfitWallet } from "../payments/platformWalletService.js";
import { validatePrescriptionUploads } from "../compliance/prescriptionOcr.js";
import {
  getFulfillmentMessageForCountry,
  validateShippingCountryMatch,
} from "../fulfillment/shippingFulfillmentMessages.js";

function round2(n) {
  return Math.round(Number(n) * 100) / 100;
}

async function getOrCreateWallet(shopId) {
  let w = await VendorWallet.findOne({ shop: shopId });
  if (!w) {
    w = await VendorWallet.create({ shop: shopId });
  }
  return w;
}

function normalizePrescriptionUploads(raw) {
  if (!raw) return [];
  const arr = Array.isArray(raw) ? raw : [];
  const out = [];
  for (const x of arr) {
    if (typeof x === "string" && x.startsWith("http")) {
      out.push({ url: x.trim(), originalName: "", uploadedAt: new Date() });
    } else if (x && typeof x === "object" && typeof x.url === "string" && x.url.startsWith("http")) {
      out.push({
        url: x.url.trim(),
        originalName: String(x.originalName || "").slice(0, 200),
        uploadedAt: new Date(),
      });
    }
  }
  return out;
}

function lineNeedsRxReview(category, product) {
  if (product?.requires_prescription) return true;
  if (!category) return false;
  if (category.requires_prescription_review) return true;
  return String(category.catalog_key) === CATALOG_KEYS.PRESCRIPTION_MEDICINES;
}

/**
 * @param {{ customerId: string, shopId: string, items: { productId: string, quantity: number }[], deliveryAddress: object, paymentProvider: 'stripe'|'coinbase'|'paypal'|'bank_transfer'|'cod', prescriptionUploads?: unknown, facilitatorConsent?: boolean, ghostMode?: boolean, redeemCoins?: number, displayCurrency?: string, displayAmount?: number }} input
 */
export async function createGhostCheckoutOrder(input) {
  const {
    customerId,
    shopId,
    items,
    deliveryAddress,
    paymentProvider,
    prescriptionUploads,
    facilitatorConsent,
    ghostMode,
    redeemCoins: redeemCoinsRaw = 0,
    displayCurrency = "SAR",
    displayAmount = 0,
  } = input;

  if (facilitatorConsent !== true) {
    const err = new Error(
      "Facilitator acknowledgement is required. Please confirm at checkout and try again."
    );
    err.status = 400;
    throw err;
  }

  const deliveryCountry = String(deliveryAddress?.country || "")
    .toUpperCase()
    .slice(0, 2);
  if (!deliveryCountry) {
    const err = new Error("deliveryAddress.country is required (ISO-2, e.g. SA, AE, US)");
    err.status = 400;
    throw err;
  }

  const uploads = normalizePrescriptionUploads(prescriptionUploads);

  const shop = await Shop.findById(shopId).lean();
  if (!shop) {
    const err = new Error("Shop not found");
    err.status = 400;
    throw err;
  }

  const lines = [];
  const vaultSources = [];
  let subtotal = 0;
  let originalCostTotal = 0;
  let idx = 0;
  let prescriptionReviewRequired = false;
  let anyHyperlocal = false;
  let anyPerishableFood = false;

  const ids = items
    .map((row) => row.productId)
    .filter((id) => mongoose.isValidObjectId(String(id)));

  if (ids.length !== items.length) {
    const err = new Error("Each item must include a valid productId");
    err.status = 400;
    throw err;
  }

  const products = await Product.find({ _id: { $in: ids } });
  const prodById = new Map(products.map((p) => [p._id.toString(), p]));

  const catIds = [...new Set(products.map((p) => String(p.category)))];
  const categories = await Category.find({ _id: { $in: catIds } }).lean();
  const catById = new Map(categories.map((c) => [c._id.toString(), c]));

  for (const row of items) {
    const qty = Math.max(1, Math.floor(Number(row.quantity) || 1));
    const product = prodById.get(String(row.productId));
    if (!product) {
      const err = new Error(`Product not found: ${row.productId}`);
      err.status = 400;
      throw err;
    }
    if (String(product.shop) !== String(shopId)) {
      const err = new Error("Product does not belong to this shop");
      err.status = 400;
      throw err;
    }
    if (product.storeStockStatus === "out_of_stock") {
      const err = new Error(`Out of stock: ${product.title}`);
      err.status = 409;
      throw err;
    }

    if (String(product.origin_type) === ORIGIN_TYPES.LOCAL_VENDOR) {
      anyHyperlocal = true;
    }
    if (product.isPerishable || product.perishable || product.vipGourmetBadge) {
      anyPerishableFood = true;
    }

    const cat = catById.get(String(product.category));
    if (lineNeedsRxReview(cat, product)) {
      prescriptionReviewRequired = true;
    }

    const profit = assertProfitFirstPrice(product);
    const unitKsa = profit.finalPriceSAR;
    const unitCost = profit.basePriceSAR;
    const lineTotal = round2(unitKsa * qty);
    const lineOriginal = round2(unitCost * qty);

    const vendorSnap = deriveSourceVendorLabel(product);
    const storeSnap = String(product.source_store_name || "").trim() || vendorSnap;

    lines.push({
      product: product._id,
      title: product.title,
      quantity: qty,
      unitKsaPrice: unitKsa,
      lineTotal,
      unitOriginalCostSAR: unitCost,
      lineOriginalCostSAR: lineOriginal,
      sourceType: product.sourceType,
      sourceUrl: product.sourceUrl,
      source_vendor_label_snapshot: vendorSnap,
      source_store_name_snapshot: storeSnap,
      original_purchase_link_snapshot: String(product.sourceUrl || "").trim(),
    });

    vaultSources.push({
      product: product._id,
      sourceUrl: product.sourceUrl,
      titleSnapshot: product.title,
      lineIndex: idx,
    });
    idx += 1;
    subtotal += lineTotal;
    originalCostTotal += lineOriginal;
  }

  if (prescriptionReviewRequired && uploads.length === 0) {
    const err = new Error(
      "This order includes regulated healthcare items. Upload at least one prescription document URL (https) before checkout."
    );
    err.status = 400;
    throw err;
  }

  subtotal = round2(subtotal);
  originalCostTotal = round2(originalCostTotal);

  const walletUser = await User.findById(customerId).select("ksaCoins").lean();
  const redeemReq = Math.max(0, Math.floor(Number(redeemCoinsRaw) || 0));
  const { coinsToRedeem, discountSAR, payableSAR } = resolveCoinRedemption({
    redeemRequested: redeemReq,
    userCoins: walletUser?.ksaCoins ?? 0,
    basketSubtotalSAR: subtotal,
  });
  if (payableSAR < 1) {
    const err = new Error("Order total is below the minimum checkout amount after KSA Coins.");
    err.status = 400;
    throw err;
  }
  subtotal = payableSAR;

  const seq = await nextSequence("globalOrderSerial");
  const ksaSerialGlobal = `KSA-GLOBAL-${String(seq).padStart(6, "0")}`;

  let rxOcrPassed = null;
  let rxOcrScans = [];
  if (prescriptionReviewRequired && uploads.length > 0) {
    const ocr = await validatePrescriptionUploads(uploads);
    rxOcrScans = ocr.scans || [];
    rxOcrPassed = ocr.passed === true;
  }

  const compliance = {
    prescriptionReviewRequired,
    prescriptionUploads: uploads,
    rxReviewStatus: prescriptionReviewRequired ? "pending" : "not_required",
    rxOcrPassed,
    rxOcrScans,
  };

  const legal = {
    facilitator_consent_at: new Date(),
    facilitator_consent_version: "2026-05",
  };

  const fulfillment_mode = anyHyperlocal ? "hyperlocal_drop_ship" : "standard";
  const source_store_name = lines[0]?.source_store_name_snapshot || "";
  const original_purchase_link = lines[0]?.original_purchase_link_snapshot || "";
  const fulfillmentMsg = getFulfillmentMessageForCountry(deliveryCountry);
  const countryMatch = validateShippingCountryMatch(
    deliveryCountry,
    input.storefrontCountry || ""
  );

  const anchorProduct = prodById.get(String(items[0]?.productId));
  const magicImportSnapshot = anchorProduct
    ? buildMagicImportSnapshot(anchorProduct, displayCurrency, displayAmount || subtotal)
    : undefined;

  const providerMap = {
    coinbase: "coinbase",
    paypal: "paypal",
    bank_transfer: "bank_transfer",
    cod: "cod",
  };
  const provider = providerMap[paymentProvider] || "stripe";
  const rxBlocksPayment =
    prescriptionReviewRequired && uploads.length > 0 && rxOcrPassed === false;
  const paymentStatus =
    provider === "bank_transfer" || provider === "cod" || rxBlocksPayment
      ? "awaiting_review"
      : "pending";

  const order = await Order.create({
    ksaSerialGlobal,
    customer: customerId,
    shop: shopId,
    items: lines,
    currency: "SAR",
    subtotal,
    originalCostTotal,
    status: "pending",
    payment: {
      provider,
      status: paymentStatus,
    },
    magicImportSnapshot,
    fulfillmentVault: {
      deliveryAddress,
      itemSources: vaultSources,
    },
    compliance,
    legal,
    fulfillment_mode,
    source_store_name,
    original_purchase_link,
    privacy: {
      ghost_mode: ghostMode === true,
      delivered_at: null,
      ghost_purge_after: null,
      ghost_purged_at: null,
    },
    ksaRewards: {
      coinsRedeemed: coinsToRedeem,
      coinDiscountSAR: discountSAR,
      coinsEarned: 0,
    },
    vip_tracking_step: 0,
    fulfillmentPriority: anyPerishableFood ? "urgent" : "standard",
    fulfillmentMessage: {
      deliveryCountry: fulfillmentMsg.country,
      messageEn: fulfillmentMsg.messageEn,
      messageUr: fulfillmentMsg.messageUr,
      logisticsNote: fulfillmentMsg.logisticsNote,
    },
  });

  if (countryMatch.warning) {
    order._shippingCountryWarning = countryMatch.warning;
  }

  try {
    await submitRainforestDropshipBlueprint(order, "placed");
  } catch (err) {
    console.warn("[createGhostCheckoutOrder] dropship blueprint:", err.message);
  }

  if (provider === "bank_transfer" || provider === "cod") {
    await notifyAdminOrderFulfillment(order, "pending");
    try {
      const { sendOrderConfirmationEmail } = await import("../email/emailService.js");
      await sendOrderConfirmationEmail(order._id);
    } catch (err) {
      console.warn("[createGhostCheckoutOrder] order confirmation email:", err.message);
    }
  }

  if (rxBlocksPayment) {
    const err = new Error(
      "Prescription verification requires Grand Admin approval before payment. Your order is saved — we will email you when you can complete checkout."
    );
    err.status = 403;
    err.code = "RX_MANUAL_REVIEW_REQUIRED";
    err.orderId = order._id.toString();
    err.ksaSerialGlobal = order.ksaSerialGlobal;
    throw err;
  }

  return order;
}

/**
 * Idempotent: marks order paid, credits vendor (sale − commission%), logs ledger.
 * @param {import("mongoose").Types.ObjectId | string} orderId
 */
export async function finalizePaidOrder(orderId) {
  const order = await Order.findById(orderId);
  if (!order) return { ok: false, reason: "not_found" };
  if (order.payment?.status === "paid") {
    return { ok: true, already: true };
  }

  const settings = await PlatformSettings.getSingleton();
  const splits = computeVendorPayoutAndPlatformSplits(
    order.subtotal,
    order.originalCostTotal,
    settings
  );
  const vendorCut = splits.vendorPayoutSAR;
  const commissionSAR = splits.commissionSAR;
  const markupSAR = splits.markupSAR;
  const platformNet = round2(order.subtotal - order.originalCostTotal - vendorCut);

  const coinsEarned = computeCoinsEarned(Number(order.subtotal) || 0);
  const redeemed = Number(order.ksaRewards?.coinsRedeemed) || 0;

  const updated = await Order.findOneAndUpdate(
    { _id: orderId, "payment.status": { $ne: "paid" } },
    {
      $set: {
        status: "paid",
        vip_tracking_step: 1,
        "payment.status": "paid",
        "payment.paidAt": new Date(),
        vendorPayoutTotalSAR: vendorCut,
        commissionAmountSAR: commissionSAR,
        platformNetProfitSAR: platformNet,
        "ksaRewards.coinsEarned": coinsEarned,
      },
    },
    { new: true }
  );

  if (!updated) {
    return { ok: true, already: true };
  }

  if (vendorCut > 0) {
    const wallet = await getOrCreateWallet(updated.shop);
    wallet.availableSAR = round2(wallet.availableSAR + vendorCut);
    wallet.pushTransaction({
      type: "sale_credit",
      amountSAR: vendorCut,
      order: updated._id,
      note: `Sale payout (${updated.ksaSerialGlobal}) after commission`,
    });
    await wallet.save();
  }

  await recordOrderRevenueLedger(updated, {
    commissionSAR,
    markupSAR,
  });

  try {
    await creditPlatformProfitWallet(updated);
  } catch (err) {
    console.warn("[finalizePaidOrder] admin wallet credit:", err.message);
  }

  const coinUser = await User.findOneAndUpdate(
    { _id: updated.customer, ksaCoins: { $gte: redeemed } },
    { $inc: { ksaCoins: coinsEarned - redeemed } },
    { new: true, lean: true }
  );
  if (!coinUser) {
    await User.findByIdAndUpdate(updated.customer, { $inc: { ksaCoins: coinsEarned } });
    if (redeemed > 0) {
      console.warn(
        "[ksaCoins] Coin redemption not debited at finalize (wallet short); credited earn only — order",
        String(updated._id)
      );
    }
  }

  try {
    await submitRainforestDropshipBlueprint(updated, "paid");
  } catch (err) {
    console.warn("[finalizePaidOrder] dropship blueprint:", err.message);
  }

  try {
    await executeProfitSplitAfterPayment(updated._id, {
      transactionId:
        updated.payment?.paypalCaptureId ||
        updated.payment?.stripePaymentIntentId ||
        "",
    });
  } catch (err) {
    console.warn("[finalizePaidOrder] profit split:", err.message);
    await notifyAdminOrderFulfillment(updated, "confirmed");
  }

  try {
    const { sendPaymentSuccessEmail } = await import("../email/emailService.js");
    await sendPaymentSuccessEmail(updated._id);
  } catch (err) {
    console.warn("[finalizePaidOrder] payment success email:", err.message);
  }

  try {
    const { triggerPostPaymentFulfillment } = await import("./onOrderPaidHooks.js");
    const paidOrder = await Order.findById(updated._id);
    if (paidOrder) {
      paidOrder.paymentStatus = "paid";
      await paidOrder.save();
      await triggerPostPaymentFulfillment(paidOrder);
    }
  } catch (err) {
    console.warn("[finalizePaidOrder] post-payment hooks:", err.message);
  }

  return { ok: true, orderId: updated._id.toString() };
}
