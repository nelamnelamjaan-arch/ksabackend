import "./src/loadRootEnv.js";
import { connectDb } from "./src/config/database.js";
import { Product } from "./src/models/Product.js";
await connectDb();
const slugs = ["luxury-jewellery","luxury-shoes","luxury-makeup","fashion-women","fashion-men","fashion-kids"];
const total = await Product.countDocuments();
const by = {};
for (const s of slugs) by[s] = await Product.countDocuments({ categorySlug: s });
const sample = await Product.findOne({ ksaPrice: { $exists: true, $ne: null }, isActive: true })
  .select("name categorySlug ksaPrice isActive source")
  .lean();
console.log(JSON.stringify({ total, by, sample: sample || null }, null, 2));
