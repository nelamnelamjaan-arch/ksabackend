import mongoose from "mongoose";
import { PriceWatchSubscription } from "../models/PriceWatchSubscription.js";
import { Product } from "../models/Product.js";

export async function postPriceWatch(req, res, next) {
  try {
    const { productId, fcmToken } = req.body ?? {};
    if (!mongoose.isValidObjectId(productId)) {
      return res.status(400).json({ message: "productId is required" });
    }
    if (!fcmToken || typeof fcmToken !== "string" || fcmToken.length < 20) {
      return res.status(400).json({ message: "fcmToken is required (FCM Web device token)" });
    }

    const product = await Product.findById(productId).select("ksaPrice title").lean();
    if (!product) return res.status(404).json({ message: "Product not found" });

    await PriceWatchSubscription.findOneAndUpdate(
      { user: req.user._id, product: productId, fcmToken: fcmToken.trim() },
      {
        $set: {
          active: true,
          baselineKsaPrice: Number(product.ksaPrice) || null,
        },
      },
      { upsert: true, new: true }
    );

    res.status(201).json({ ok: true, productId, message: "You will be notified on ≥5% price drops." });
  } catch (e) {
    next(e);
  }
}

export async function deletePriceWatch(req, res, next) {
  try {
    const { productId, fcmToken } = req.body ?? {};
    if (!mongoose.isValidObjectId(productId)) {
      return res.status(400).json({ message: "productId is required" });
    }
    const q = { user: req.user._id, product: productId };
    if (fcmToken && typeof fcmToken === "string") {
      q.fcmToken = fcmToken.trim();
    }
    await PriceWatchSubscription.updateMany(q, { $set: { active: false } });
    res.json({ ok: true });
  } catch (e) {
    next(e);
  }
}
