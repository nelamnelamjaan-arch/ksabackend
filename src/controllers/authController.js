import { OAuth2Client } from "google-auth-library";
import { User, USER_ROLES } from "../models/User.js";
import { signAuthToken } from "../services/auth/jwt.js";
import { verifyPassword } from "../services/auth/password.js";
import { isKiranGrandAdmin, KIRAN_USERNAME } from "../services/auth/kiranAdmin.js";
import { buildFamilyNeedsRecommendations } from "../services/catalog/familyNeedsRecommendations.js";
import { hashPassword } from "../services/auth/password.js";
import { isApprovedSellerUser, normalizeRole, userHasRole } from "../utils/rbac/roles.js";
import { isOpenShopEnabled } from "../utils/openShop.js";

const FAMILY_REL = new Set(["self", "spouse", "child", "parent", "grandparent", "other"]);

function publicUserDoc(u) {
  const o = typeof u?.toObject === "function" ? u.toObject() : u;
  if (!o) return null;
  return {
    id: o._id,
    email: o.email,
    username: o.username || "",
    name: o.name,
    role: normalizeRole(o.role),
    isApproved: Boolean(o.isApproved),
    isKiranAdmin: isKiranGrandAdmin(o),
    picture: o.picture || "",
    ksaCoins: Math.max(0, Math.floor(Number(o.ksaCoins) || 0)),
    family_members: Array.isArray(o.family_members)
      ? o.family_members.map((m) => ({
          id: m._id,
          relationship: m.relationship,
          display_name: m.display_name,
          date_of_birth: m.date_of_birth || null,
          age_years: m.age_years ?? null,
        }))
      : [],
  };
}

const googleClient = () => new OAuth2Client(process.env.GOOGLE_CLIENT_ID);

/**
 * POST /api/auth/google
 * Body: { credential: string } — Google Identity Services JWT (from @react-oauth/google).
 */
export async function postGoogleLogin(req, res, next) {
  try {
    const credential = req.body?.credential;
    if (!credential || typeof credential !== "string") {
      return res.status(400).json({ message: "credential is required" });
    }
    const audience = process.env.GOOGLE_CLIENT_ID;
    if (!audience) {
      return res.status(503).json({ message: "Google sign-in is not configured (GOOGLE_CLIENT_ID)" });
    }

    const ticket = await googleClient().verifyIdToken({
      idToken: credential,
      audience,
    });
    const payload = ticket.getPayload();
    const email = String(payload?.email || "")
      .toLowerCase()
      .trim();
    const name = String(payload?.name || email.split("@")[0] || "Member").trim();
    const sub = payload?.sub;
    if (!email || !sub) {
      return res.status(401).json({ message: "Google token missing identity" });
    }

    let user = await User.findOne({ email });
    if (!user) {
      user = await User.create({
        email,
        name,
        googleSub: sub,
        picture: payload?.picture || "",
        passwordHash: null,
        role: USER_ROLES.CUSTOMER,
      });
    } else {
      if (user.googleSub && user.googleSub !== sub) {
        return res.status(409).json({ message: "This email is already linked to another Google account" });
      }
      user.googleSub = sub;
      if (payload?.picture) user.picture = payload.picture;
      if (name && !isKiranGrandAdmin(user)) user.name = name;
      await user.save();
    }

    const u = user.toObject();
    const token = signAuthToken(u);
    res.json({
      token,
      user: publicUserDoc(u),
    });
  } catch (err) {
    if (String(err?.message || "").includes("Token used too late")) {
      return res.status(401).json({ message: "Google session expired — try again" });
    }
    next(err);
  }
}

/**
 * POST /api/auth/login
 * Body: { username: string, password: string }
 */
/**
 * POST /api/auth/seller-login
 * Body: { username?: string, email?: string, password: string }
 */
/**
 * POST /api/auth/seller-register
 * Body: { email, name, username, password }
 * Creates a pending seller — Super Admin must approve before login.
 */
export async function postSellerRegister(req, res, next) {
  try {
    if (!isOpenShopEnabled()) {
      return res.status(503).json({ message: "Open Shop registration is disabled" });
    }

    const email = String(req.body?.email || "")
      .toLowerCase()
      .trim();
    const name = String(req.body?.name || "").trim();
    const username = String(req.body?.username || "").trim();
    const password = String(req.body?.password || "");

    if (!email || !name || !username || !password) {
      return res.status(400).json({
        message: "email, name, username, and password are required",
      });
    }
    if (password.length < 6) {
      return res.status(400).json({ message: "password must be at least 6 characters" });
    }

    const existing = await User.findOne({
      $or: [{ email }, { username }],
    }).lean();
    if (existing) {
      return res.status(409).json({ message: "Email or username already in use" });
    }

    const user = await User.create({
      email,
      username,
      name,
      passwordHash: hashPassword(password),
      role: USER_ROLES.SELLER,
      isApproved: false,
    });

    res.status(201).json({
      message: "Seller account created — pending Super Admin approval",
      user: publicUserDoc(user),
    });
  } catch (err) {
    if (err?.code === 11000) {
      return res.status(409).json({ message: "Email or username already in use" });
    }
    next(err);
  }
}

export async function postSellerLogin(req, res, next) {
  try {
    if (!isOpenShopEnabled()) {
      return res.status(503).json({ message: "Open Shop is disabled on this deployment" });
    }

    const username = String(req.body?.username || "").trim();
    const email = String(req.body?.email || "")
      .toLowerCase()
      .trim();
    const password = String(req.body?.password || "");
    if ((!username && !email) || !password) {
      return res.status(400).json({ message: "username or email, and password are required" });
    }

    const identityQuery = username
      ? { $or: [{ username }, { email: username.toLowerCase() }] }
      : { email };

    const user = await User.findOne(identityQuery);
    if (!user) {
      return res.status(401).json({ message: "Invalid credentials" });
    }

    const role = normalizeRole(user.role);
    if (!userHasRole(user, USER_ROLES.SELLER)) {
      return res.status(403).json({
        message: "This account is not a seller — register at /seller/register or use admin login",
      });
    }

    if (!user.passwordHash) {
      return res.status(401).json({
        message: "No password on file — register again or ask Super Admin to reset your seller password",
      });
    }

    if (!verifyPassword(password, user.passwordHash)) {
      return res.status(401).json({ message: "Invalid credentials" });
    }

    if (role !== user.role) {
      user.role = role;
      await user.save();
    }

    if (!isApprovedSellerUser(user)) {
      return res.status(403).json({
        message: "Seller account pending Super Admin approval",
        isApproved: false,
      });
    }

    const u = user.toObject();
    const token = signAuthToken(u);
    res.json({ token, user: publicUserDoc(u) });
  } catch (err) {
    next(err);
  }
}

export async function postAdminLogin(req, res, next) {
  try {
    const username = String(req.body?.username || "").trim();
    const password = String(req.body?.password || "");
    if (!username || !password) {
      return res.status(400).json({ message: "username and password are required" });
    }

    const adminUsername = String(process.env.ADMIN_USERNAME || KIRAN_USERNAME).trim();
    if (username.toLowerCase() !== adminUsername.toLowerCase()) {
      return res.status(401).json({ message: "Invalid credentials" });
    }

    const user = await User.findOne({
      $or: [{ username: KIRAN_USERNAME }, { name: KIRAN_USERNAME }, { email: "kiran@ksa.store" }],
    });
    if (!user) {
      return res.status(401).json({ message: "Admin account not seeded — restart API with MongoDB" });
    }

    const envPass = process.env.ADMIN_PASSWORD || process.env.KIRAN_ADMIN_PASSWORD;
    const envMatch = Boolean(envPass && password === envPass);
    const hashMatch = verifyPassword(password, user.passwordHash);
    if (!envMatch && !hashMatch) {
      return res.status(401).json({ message: "Invalid credentials" });
    }
    if (!isKiranGrandAdmin(user)) {
      return res.status(403).json({ message: "This account is not authorized for Grand Admin" });
    }

    const u = user.toObject();
    const token = signAuthToken(u);
    res.json({ token, user: publicUserDoc(u) });
  } catch (err) {
    next(err);
  }
}

export async function getMe(req, res) {
  res.json({ user: publicUserDoc(req.user) });
}

export async function patchMe(req, res, next) {
  try {
    const u = await User.findById(req.user._id);
    if (!u) return res.status(404).json({ message: "User not found" });

    const { family_members } = req.body ?? {};
    if (family_members !== undefined) {
      if (!Array.isArray(family_members) || family_members.length > 24) {
        return res.status(400).json({ message: "family_members must be an array (max 24)" });
      }
      const sanitized = family_members
        .map((m) => {
          const rel = FAMILY_REL.has(String(m?.relationship)) ? String(m.relationship) : "other";
          let dob = null;
          if (m?.date_of_birth) {
            const d = new Date(m.date_of_birth);
            if (!Number.isNaN(d.getTime())) dob = d;
          }
          let age = null;
          if (m?.age_years != null && !Number.isNaN(Number(m.age_years))) {
            age = Math.min(125, Math.max(0, Math.floor(Number(m.age_years))));
          }
          return {
            relationship: rel,
            display_name: String(m?.display_name || "").trim().slice(0, 80),
            date_of_birth: dob,
            age_years: age,
          };
        })
        .filter((m) => m.display_name || m.date_of_birth || m.age_years != null);
      u.family_members = sanitized;
    }

    await u.save();
    res.json({ user: publicUserDoc(u) });
  } catch (err) {
    next(err);
  }
}

export async function getFamilyNeeds(req, res, next) {
  try {
    const data = await buildFamilyNeedsRecommendations(req.user._id);
    res.json(data);
  } catch (err) {
    next(err);
  }
}
