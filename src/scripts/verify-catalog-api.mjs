/**
 * Verify catalog_key filters return disjoint product sets (storefront query).
 */
import "../loadRootEnv.js";
import { connectDb } from "../config/database.js";
import { Product } from "../models/Product.js";
import { Category } from "../models/Category.js";
import { PUBLIC_PRODUCT_QUERY } from "../utils/marketplace/publicCatalog.js";

async function idsForCatalogKey(ck) {
  const ids = await Category.find({ catalog_key: ck }).distinct("_id");
  if (!ids.length) {
    const bySlug = await Category.find({ slug: ck }).distinct("_id");
    return bySlug;
  }
  return ids;
}

async function sampleTitles(ck, n = 3) {
  const catIds = await idsForCatalogKey(ck);
  const rows = await Product.find({ ...PUBLIC_PRODUCT_QUERY, category: { $in: catIds } })
    .sort({ createdAt: -1 })
    .limit(n)
    .select("title")
    .lean();
  return {
    catalog_key: ck,
    total: await Product.countDocuments({
      ...PUBLIC_PRODUCT_QUERY,
      category: { $in: catIds },
    }),
    sampleTitles: rows.map((r) => r.title?.slice(0, 55)),
  };
}

await connectDb();

const jewellery = await sampleTitles("jewellery");
const drinks = await sampleTitles("drinks");
const makeup = await sampleTitles("makeup");

const jewIds = await idsForCatalogKey("jewellery");
const drinkIds = await idsForCatalogKey("drinks");
const overlap = await Product.countDocuments({
  ...PUBLIC_PRODUCT_QUERY,
  category: { $in: jewIds },
  _id: {
    $in: await Product.find({ ...PUBLIC_PRODUCT_QUERY, category: { $in: drinkIds } }).distinct(
      "_id"
    ),
  },
});

console.log(
  JSON.stringify(
    {
      jewellery,
      drinks,
      makeup,
      overlapJewelleryDrinks: overlap,
      distinct: overlap === 0 && jewellery.total > 0 && drinks.total > 0,
    },
    null,
    2
  )
);
process.exit(overlap === 0 && jewellery.total > 0 && drinks.total > 0 ? 0 : 1);
