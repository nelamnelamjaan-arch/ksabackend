import "./src/loadRootEnv.js";
import { connectDb } from "./src/config/database.js";
import { Product } from "./src/models/Product.js";
import { Category } from "./src/models/Category.js";
await connectDb();
const id = "6a0c46ffeacf661a890b65ea";
const p = await Product.findById(id).select("category categorySlug catalog_key title").lean();
const cat = await Category.findOne({ slug: "fast-food" }).lean();
console.log({ p, fastFoodCat: String(cat._id) });
