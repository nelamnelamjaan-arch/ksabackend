import { generateProductSeoWithGemini } from "./seoService.js";
import { buildProductOpenGraphImage } from "./seoOgImage.js";

/**
 * Meta tags + OpenGraph image for Google / social sharing.
 * @param {{ title: string, description?: string, categoryName?: string, categorySlug?: string, verticalHint?: string, primaryImageUrl?: string }} input
 */
export async function generateProductSeoBundle(input) {
  const title = String(input?.title || "").trim();
  if (!title) return null;

  const gemini = await generateProductSeoWithGemini({
    title,
    categoryName: input.categoryName,
    categorySlug: input.categorySlug,
    verticalHint: input.verticalHint,
  });

  const metaTitle = gemini?.metaTitle || `${title.slice(0, 48)} | KSA Store`.slice(0, 60);
  let metaDescription =
    gemini?.metaDescription ||
    String(input?.description || title).trim().slice(0, 160);
  if (metaDescription.length > 160) metaDescription = metaDescription.slice(0, 157) + "…";

  const keywords = gemini?.keywords?.length
    ? gemini.keywords
    : [title.split(" ").slice(0, 4).join(" "), "buy online Saudi Arabia", "KSA Store"];

  const ogImageUrl = await buildProductOpenGraphImage(
    input?.primaryImageUrl || "",
    metaTitle
  );

  const imageAlts = input?.imageUrls?.length
    ? input.imageUrls.map((url, i) =>
        `${title}${input.imageUrls.length > 1 ? ` — image ${i + 1}` : ""}`.slice(0, 120)
      )
    : [];

  return {
    metaTitle,
    metaDescription,
    keywords,
    ogImageUrl,
    ogTitle: metaTitle,
    ogDescription: metaDescription,
    imageAlts,
    source: gemini?.source || "fallback",
  };
}
