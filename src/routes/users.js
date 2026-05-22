import { Router } from "express";
import { User, USER_ROLES } from "../models/User.js";

const router = Router();

/**
 * Public registration for customers and shop owners (vendors).
 * Grand Admin accounts are created via seed / internal ops only.
 */
router.post("/register", async (req, res, next) => {
  try {
    const { email, name, role = USER_ROLES.CUSTOMER } = req.body ?? {};
    if (!email || !name) {
      return res.status(400).json({ message: "email and name are required" });
    }
    const allowed = [USER_ROLES.SELLER, USER_ROLES.CUSTOMER, "vendor_admin", "customer"];
    if (!allowed.includes(role)) {
      return res.status(400).json({
        message: "role must be vendor_admin or customer",
      });
    }

    const user = await User.create({
      email: String(email).toLowerCase().trim(),
      name: String(name).trim(),
      role,
    });

    res.status(201).json({
      id: user._id,
      email: user.email,
      name: user.name,
      role: user.role,
    });
  } catch (err) {
    if (err?.code === 11000) {
      return res.status(409).json({ message: "Email already registered" });
    }
    next(err);
  }
});

export default router;
