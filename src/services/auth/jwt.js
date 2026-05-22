import jwt from "jsonwebtoken";

function secret() {
  return process.env.JWT_SECRET || "ksa-dev-only-change-in-production";
}

/**
 * @param {{ _id: unknown, email: string, role: string }} user
 */
export function signAuthToken(user) {
  const sub = String(user._id);
  return jwt.sign({ sub, email: user.email, role: user.role }, secret(), {
    expiresIn: process.env.JWT_EXPIRES_IN || "7d",
  });
}

export function verifyAuthToken(token) {
  return jwt.verify(token, secret());
}
