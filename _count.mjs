import "./src/loadRootEnv.js";
import { connectDb } from "./src/config/database.js";
import { Category } from "./src/models/Category.js";
import { Product } from "./src/models/Product.js";
import { withRealCatalogFilter } from "./src/utils/catalog/demoProductFilter.js";
await connectDb();
for (const slug of ["fast-food", "desi-food", "drinks"]) {
  const cat = await Category.findOne({ slug }).lean();
  const n = cat ? await Product.countDocuments(withRealCatalogFilter({ category: cat._id })) : 0;
  console.log(slug, n);
}
