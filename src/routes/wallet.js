import { Router } from "express";
import { requireUser, requireRoles } from "../middleware/auth.js";
import { USER_ROLES } from "../models/User.js";
import { Shop } from "../models/Shop.js";
import { VendorWallet } from "../models/VendorWallet.js";
import { PlatformSettings } from "../models/PlatformSettings.js";

const router = Router();

router.get("/", requireUser, requireRoles(USER_ROLES.SELLER), async (req, res, next) => {
  try {
    const shop = await Shop.findOne({ owner: req.user._id }).lean();
    if (!shop) {
      return res.status(404).json({ message: "No shop found for this vendor" });
    }
    let wallet = await VendorWallet.findOne({ shop: shop._id }).lean();
    if (!wallet) {
      wallet = {
        shop: shop._id,
        availableSAR: 0,
        pendingWithdrawalSAR: 0,
        transactions: [],
      };
    }
    res.json(wallet);
  } catch (e) {
    next(e);
  }
});

router.post("/withdraw", requireUser, requireRoles(USER_ROLES.SELLER), async (req, res, next) => {
  try {
    const amount = Number(req.body?.amountSAR);
    if (Number.isNaN(amount) || amount <= 0) {
      return res.status(400).json({ message: "amountSAR must be a positive number" });
    }

    const settings = await PlatformSettings.getSingleton();
    const min = settings.minWithdrawalSAR ?? 100;
    if (amount < min) {
      return res.status(400).json({
        message: `Minimum withdrawal is ${min} SAR`,
        minWithdrawalSAR: min,
      });
    }

    const shop = await Shop.findOne({ owner: req.user._id });
    if (!shop) return res.status(404).json({ message: "No shop found" });

    const wallet = await VendorWallet.findOne({ shop: shop._id });
    if (!wallet || wallet.availableSAR < amount) {
      return res.status(400).json({
        message: "Insufficient available balance",
        availableSAR: wallet?.availableSAR ?? 0,
      });
    }

    wallet.availableSAR = Math.round((wallet.availableSAR - amount) * 100) / 100;
    wallet.pushTransaction({
      type: "withdrawal",
      amountSAR: amount,
      note: "Vendor withdrawal request (process off-platform payout separately)",
    });
    await wallet.save();

    res.json({
      ok: true,
      withdrawnSAR: amount,
      availableSAR: wallet.availableSAR,
      message:
        "Withdrawal recorded. Wire/crypto payout to vendor is handled outside this API in production.",
    });
  } catch (e) {
    next(e);
  }
});

export default router;
