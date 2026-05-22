import "./src/loadRootEnv.js";
import { connectDb } from "./src/config/database.js";
import { Product } from "./src/models/Product.js";
await connectDb();
const agg = await Product.aggregate([
  { $group: { _id: "$categorySlug", n: { $sum: 1 } } },
  { $sort: { n: -1 } },
  { $limit: 15 },
]);
console.log(agg);
