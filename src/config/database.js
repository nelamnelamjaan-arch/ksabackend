import mongoose from "mongoose";

const MONGODB_URI = process.env.MONGODB_URI;

/**
 * @returns {Promise<boolean>} true if connected
 */
export async function connectDb() {
  if (!MONGODB_URI) {
    console.warn("MONGODB_URI not set — API routes that need MongoDB will fail.");
    return false;
  }
  mongoose.set("strictQuery", true);
  try {
    await mongoose.connect(MONGODB_URI);
  } catch (err) {
    console.warn("MongoDB connection failed:", err?.message || err);
    console.warn("API routes that need the database will fail until MONGODB_URI is valid.");
    return false;
  }
  console.log("MongoDB connected");
  try {
    const { ensureProductIndexes } = await import("./ensureProductIndexes.js");
    await ensureProductIndexes();
  } catch (err) {
    console.warn("[mongodb] Product index sync:", err.message);
  }
  return true;
}
