import { isOpenShopEnabled } from "../utils/openShop.js";

export function requireOpenShopEnabled(req, res, next) {
  if (!isOpenShopEnabled()) {
    return res.status(503).json({
      message: "Open Shop is disabled on this deployment (ENABLE_OPEN_SHOP=false)",
    });
  }
  next();
}
