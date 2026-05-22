import "../loadRootEnv.js";
import { connectDb } from "../config/database.js";
import { Product } from "../models/Product.js";
import { Category } from "../models/Category.js";

await connectDb();

const agg = await Product.aggregate([
  {
    $project: {
      conn: "$automation.importConnector",
      cat: "$category",
      slug: "$categorySlug",
    },
  },
  {
    $group: {
      _id: {
        connPrefix: {
          $substrCP: ["$conn", 0, { $min: [{ $strLenCP: { $ifNull: ["$conn", ""] } }, 28] }],
        },
        categorySlug: "$slug",
      },
      count: { $sum: 1 },
    },
  },
  { $sort: { count: -1 } },
  { $limit: 40 },
]);

const drinks = await Category.findOne({ slug: "drinks" }).lean();
const withDrinksCat = await Product.countDocuments({ category: drinks._id });

console.log(JSON.stringify({ top: agg, withDrinksCat, total: await Product.countDocuments() }, null, 2));
process.exit(0);
