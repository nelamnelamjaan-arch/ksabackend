const WATERMARK_URL_KEYWORDS = [
  "watermark",
  "wm_",
  "wm-",
  "getty",
  "shutterstock",
  "istock",
  "alamy",
  "depositphotos",
  "dreamstime",
  "preview_watermark",
  "stamped",
];

const WATERMARK_QUERY_KEYS = ["watermark", "wm", "overlay"];

/**
 * Heuristic: URL / path signals stock watermarks. Grand Admin should review.
 * Replace with CV / perceptual hash when you add image processing.
 * @param {string} imageUrl
 * @returns {{ suspectWatermark: boolean, reason?: string }}
 */
export function evaluateImageWatermarkRisk(imageUrl) {
  if (!imageUrl || typeof imageUrl !== "string") {
    return { suspectWatermark: false };
  }
  const lower = imageUrl.toLowerCase();

  for (const kw of WATERMARK_URL_KEYWORDS) {
    if (lower.includes(kw)) {
      return { suspectWatermark: true, reason: `URL contains “${kw}”` };
    }
  }

  try {
    const u = new URL(imageUrl);
    for (const q of WATERMARK_QUERY_KEYS) {
      if (u.searchParams.has(q)) {
        return { suspectWatermark: true, reason: `Query param “${q}” present` };
      }
    }
  } catch {
    /* relative URL */
  }

  return { suspectWatermark: false };
}

/**
 * @param {string[]} imageUrls
 * @returns {{ cleanUrls: string[], flags: { url: string, suspectWatermark: boolean, reason?: string }[] }}
 */
export function flagImagesForReview(imageUrls) {
  const flags = [];
  const cleanUrls = [];
  for (const url of imageUrls || []) {
    const verdict = evaluateImageWatermarkRisk(url);
    if (verdict.suspectWatermark) {
      flags.push({ url, suspectWatermark: true, reason: verdict.reason });
    } else {
      cleanUrls.push(url);
    }
  }
  return { cleanUrls, flags };
}
