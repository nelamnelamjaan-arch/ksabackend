import "./src/loadRootEnv.js";
import { connectDb } from "./src/config/database.js";
import { Product } from "./src/models/Product.js";
import { Category } from "./src/models/Category.js";
await connectDb();
const cat = await Category.findOne({ slug: "fast-food" }).lean();
const wrong = await Product.countDocuments({ catalog_key: "fast-food", category: { $ne: cat._id } });
const correct = await Product.countDocuments({ catalog_key: "fast-food", category: cat._id });
console.log({ wrong, correct, fastFoodCat: String(cat._id) });
