import mongoose from "mongoose";
import { Product } from "../models/Product.js";
import { Shop } from "../models/Shop.js";
import { PlatformSettings } from "../models/PlatformSettings.js";
import { VendorWallet } from "../models/VendorWallet.js";
import { USER_ROLES } from "../models/User.js";
import { convertToSAR } from "../utils/pricing/calculateKSAStorePrice.js";
import { recordAdFeeLedger } from "../services/revenue/ledgerService.js";

function round2(n) {
  return Math.round(Number(n) * 100) / 100;
}

async function getVendorShop(req) {
  if (req.user.role !== USER_ROLES.SELLER && req.user.role !== "vendor_admin") {
    const err = new Error("Vendor access only");
    err.status = 403;
    throw err;
  }
  const shop = await Shop.findOne({ owner: req.user._id });
  if (!shop) {
    const err = new Error("No shop found");
    err.status = 404;
    throw err;
  }
  return shop;
}

/**
 * Boost product for Top Featured (debits vendor wallet, logs ad_fee ledger).
 */
export async function postBoostProduct(req, res, next) {
  try {
    const { productId } = req.params;
    if (!mongoose.isValidObjectId(productId)) {
      return res.status(400).json({ message: "Invalid product id" });
    }

    const shop = await getVendorShop(req);
    const product = await Product.findById(productId);
    if (!product) return res.status(404).json({ message: "Product not found" });
    if (String(product.shop) !== String(shop._id)) {
      return res.status(403).json({ message: "Product is not in your shop" });
    }

    const settings = await PlatformSettings.getSingleton();
    const feeSAR = round2(convertToSAR(settings.boostFeeUSD ?? 5, "USD"));
    const hours = settings.boostDurationHours ?? 24;

    let wallet = await VendorWallet.findOne({ shop: shop._id });
    if (!wallet) {
      wallet = await VendorWallet.create({ shop: shop._id });
    }
    if (wallet.availableSAR < feeSAR) {
      return res.status(402).json({
        message: "Insufficient wallet balance for boost",
        requiredSAR: feeSAR,
        availableSAR: wallet.availableSAR,
      });
    }

    const base =
      product.featuredUntil && product.featuredUntil > new Date()
        ? product.featuredUntil
        : new Date();
    const featuredUntil = new Date(base.getTime() + hours * 3600000);

    wallet.availableSAR = round2(wallet.availableSAR - feeSAR);
    wallet.pushTransaction({
      type: "boost_fee",
      amountSAR: feeSAR,
      note: `Featured boost ${hours}h — ${product.title?.slice(0, 40)}`,
    });
    await wallet.save();

    product.featuredUntil = featuredUntil;
    await product.save();

    await recordAdFeeLedger({
      amountSAR: feeSAR,
      shopId: shop._id,
      productId: product._id,
      vendorUserId: req.user._id,
      note: `Boost ${hours}h`,
    });

    res.json({
      productId: product._id,
      featuredUntil,
      feeSAR,
      hours,
    });
  } catch (e) {
    if (e.status) return res.status(e.status).json({ message: e.message });
    next(e);
  }
}
