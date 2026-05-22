import mongoose from "mongoose";
import { Subscription } from "../models/Subscription.js";
import { Product } from "../models/Product.js";
import { Shop } from "../models/Shop.js";

function nextMonthlyRun() {
  const d = new Date();
  d.setMonth(d.getMonth() + 1);
  return d;
}

export async function createOrUpdateSubscription(req, res, next) {
  try {
    const { shopId, productId, quantity = 1 } = req.body ?? {};
    if (!mongoose.isValidObjectId(shopId) || !mongoose.isValidObjectId(productId)) {
      return res.status(400).json({ message: "shopId and productId are required ObjectIds" });
    }
    const [shop, product] = await Promise.all([
      Shop.findById(shopId).lean(),
      Product.findById(productId).lean(),
    ]);
    if (!shop || !product) {
      return res.status(400).json({ message: "Shop or product not found" });
    }
    if (String(product.shop) !== String(shopId)) {
      return res.status(400).json({ message: "shopId must match the product's shop" });
    }
    const qty = Math.max(1, Math.floor(Number(quantity) || 1));
    const nextRunAt = nextMonthlyRun();

    const doc = await Subscription.findOneAndUpdate(
      { customer: req.user._id, product: productId },
      {
        $set: {
          shop: shopId,
          quantity: qty,
          cadence: "monthly",
          active: true,
          nextRunAt,
        },
      },
      { upsert: true, new: true }
    )
      .populate("product", "title ksaPrice images")
      .populate("shop", "name slug")
      .lean();

    res.status(201).json({
      subscription: doc,
      message:
        "Subscription saved. Connect a scheduler to POST /api/checkout from nextRunAt for auto-orders.",
    });
  } catch (err) {
    next(err);
  }
}

export async function listMySubscriptions(req, res, next) {
  try {
    const rows = await Subscription.find({ customer: req.user._id, active: true })
      .populate("product", "title ksaPrice images perishable")
      .populate("shop", "name slug")
      .sort({ nextRunAt: 1 })
      .lean();
    res.json({ items: rows });
  } catch (err) {
    next(err);
  }
}
