import { User, USER_ROLES } from "../models/User.js";
import { hashPassword } from "../services/auth/password.js";

const DEFAULT_EMAIL = "seller@ksa.store";
const DEFAULT_USERNAME = "seller";
const DEFAULT_PASSWORD = "seller123";

/**
 * Idempotent approved seller for local Open Shop testing (SEED_APPROVED_SELLER=true).
 */
export async function ensureApprovedSeller() {
  if (process.env.SEED_APPROVED_SELLER !== "true") return null;

  const email = String(process.env.SEED_SELLER_EMAIL || DEFAULT_EMAIL)
    .toLowerCase()
    .trim();
  const username = String(process.env.SEED_SELLER_USERNAME || DEFAULT_USERNAME).trim();
  const passwordPlain = String(process.env.SEED_SELLER_PASSWORD || DEFAULT_PASSWORD);
  const passwordHash = hashPassword(passwordPlain);

  let user = await User.findOne({
    $or: [{ email }, { username }],
  });

  if (!user) {
    user = await User.create({
      email,
      username,
      name: "Approved Seller",
      role: USER_ROLES.SELLER,
      isApproved: true,
      passwordHash,
    });
    console.log("[KSA Store] Created approved seller:", username, `(${email})`);
  } else {
    user.role = USER_ROLES.SELLER;
    user.isApproved = true;
    user.passwordHash = passwordHash;
    if (!user.username) user.username = username;
    if (!user.email) user.email = email;
    await user.save();
    console.log("[KSA Store] Updated approved seller:", username);
  }

  return user;
}
