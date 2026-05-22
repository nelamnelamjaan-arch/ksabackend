import "./src/loadRootEnv.js";
import { connectDb } from "./src/config/database.js";
import { Category } from "./src/models/Category.js";
import { Product } from "./src/models/Product.js";
await connectDb();
const slugs = ["fast-food", "desi-food", "drinks"];
for (const slug of slugs) {
  const cat = await Category.findOne({ slug }).lean();
  const r = await Product.updateMany(
    { $or: [{ categorySlug: slug }, { catalog_key: slug }], category: { $ne: cat._id } },
    { $set: { category: cat._id, categorySlug: slug } }
  );
  console.log(slug, r.modifiedCount);
}
