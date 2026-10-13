/* Settings you might change. The proxy holds the OpenRouter key server-side;
 * a key typed into Developer settings overrides it (stays in that browser). */
const Config = Object.freeze({
  PROXY_URL: "https://my-proxy.shimon-jacobs-apps.workers.dev",

  JEV_URL: "https://openrouter.ai/api/alpha/decisions",
  JEV_MODEL: "typesafe/jev-1.13",
  CHAT_URL: "https://openrouter.ai/api/v1/chat/completions",
  CHAT_MODEL: "~anthropic/claude-haiku-latest",

  FLAG_THRESHOLD: 0.7,     // Jev probability needed before a yes/no preference counts
  MAX_CANDIDATES: 12,      // most dishes handed to Jev when it picks
  RECENT_HOURS: 36,        // how long a meal counts as "recent"
  RECENT_PENALTY: 0.5,     // weak ranking nudge away from recent meals (never excludes)
  TIME_WEIGHT: 0.75,       // ranking boost for dishes that suit the time of day
  REJECTS_BEFORE_LIST: 3   // after this many "Not this one", also offer the list
});
