import "dotenv/config";
import mongoose from "mongoose";
import { connectDb } from "../config/database.js";
import { seedDemoUsers } from "../config/seed.js";

const connected = await connectDb();
if (!connected) {
  console.error("Set MONGODB_URI to run seed.");
  process.exit(1);
}

await seedDemoUsers();
await mongoose.disconnect();
process.exit(0);
