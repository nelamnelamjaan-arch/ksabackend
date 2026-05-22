import { runShoppingConciergeChat } from "../services/ai/shoppingConcierge.js";
import { resolveConciergeProductHints } from "../services/catalog/conciergeProductResolver.js";

export async function postConciergeChat(req, res) {
  const raw = req.body?.messages;
  if (!Array.isArray(raw) || raw.length === 0) {
    return res.status(400).json({ message: "messages[] is required" });
  }
  if (raw.length > 24) {
    return res.status(400).json({ message: "Too many messages (max 24)" });
  }

  const messages = raw
    .map((m) => ({
      role: String(m?.role || "user"),
      content: typeof m?.content === "string" ? m.content : String(m?.content || ""),
    }))
    .filter((m) => m.content.trim());

  if (messages.length === 0) {
    return res.status(400).json({ message: "Each message needs a non-empty content string" });
  }

  const ai = await runShoppingConciergeChat({ messages });
  if (!ai.ok) {
    return res.status(ai.status || 500).json({ message: ai.error || "Concierge unavailable" });
  }

  const product_hints = await resolveConciergeProductHints(ai.search_suggestions, {
    limitPerBucket: 4,
  });

  res.json({
    assistant_message: ai.assistant_message,
    bundle_title: ai.bundle_title,
    follow_up_question: ai.follow_up_question,
    search_suggestions: ai.search_suggestions,
    product_hints,
    requestId: ai.requestId,
  });
}
