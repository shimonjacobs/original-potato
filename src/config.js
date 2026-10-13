/* ===================================================================
 * CONFIG
 * -------------------------------------------------------------------
 * One OpenRouter key powers both models:
 *   - Jev (typesafe/jev-1.13): makes the decisions (what to eat, what
 *     the user means, whether to ask a clarifying question).
 *   - Claude Haiku: turns each decision into a friendly reply.
 *
 * The key can live here (shared with anyone who has the file) OR be
 * pasted into the Settings panel in the app, which keeps it only in
 * that browser. Leave it blank here if you'd rather not ship a key.
 * With no key at all the app still works, using the built-in rules.
 * =================================================================== */
const CONFIG = {
  OPENROUTER_API_KEY: "",

  // Cloudflare Worker that holds the key server-side. Used whenever no personal key
  // is set (key box in Settings). Leave blank to disable.
  PROXY_URL: "https://my-proxy.shimon-jacobs-apps.workers.dev",

  JEV_URL: "https://openrouter.ai/api/alpha/decisions",
  JEV_MODEL: "typesafe/jev-1.13",

  CHAT_URL: "https://openrouter.ai/api/v1/chat/completions",
  CHAT_MODEL: "~anthropic/claude-haiku-latest",

  // Below this Jev confidence the reply offers two options equally.
  PICK_MIN_CONFIDENCE: 0.4,
  // Jev "is the message too vague?" probability that triggers a clarifier.
  VAGUE_THRESHOLD: 0.6,
  // Probability needed before a yes/no preference is applied.
  FLAG_THRESHOLD: 0.7,
  // Jev must be this sure to apply milky/meaty/pareve from a message
  // (typed keywords like "meaty" always count).
  KOSHER_CONFIDENCE: 0.85,
  // Max dishes handed to Jev when it picks.
  MAX_CANDIDATES: 12,
  // A dish you ate within this many hours is skipped (if alternatives exist).
  RECENT_HOURS: 36,
  // A dish rejected this many times is skipped in future chats.
  DISLIKE_AFTER: 2
};
