/* ===================================================================
 * STORE - small memory kept in this browser (localStorage).
 * Remembers what you ate (and an optional pasted API key). Dishes you
 * turn down are kept for the current chat only, never saved.
 * Every access is wrapped: if storage is blocked, it silently falls
 * back to memory for the current page load.
 * =================================================================== */
const Store = (function () {
  const TASTE_KEY = "fc_taste_v2";
  const API_KEY = "fc_key";
  let taste = { rejected: {}, eaten: [] };
  const DISHES_KEY = "fc_dishes_v3"; // v3 = milky/meaty/pareve format
  let memKey = "";
  let memDishes = null;

  try {
    const raw = localStorage.getItem(TASTE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      // Turned-down dishes are this chat only: never loaded from, or saved to, storage.
      taste = { rejected: {}, eaten: parsed.eaten || [] };
    }
  } catch (e) { /* storage unavailable */ }

  function save() {
    try { localStorage.setItem(TASTE_KEY, JSON.stringify({ eaten: taste.eaten })); } catch (e) { /* ignore */ }
  }

  return {
    getKey: function () {
      let stored = "";
      try { stored = localStorage.getItem(API_KEY) || ""; } catch (e) { stored = memKey; }
      return stored || memKey || CONFIG.OPENROUTER_API_KEY || "";
    },
    // True when AI calls are possible: a personal key, or the proxy worker.
    hasAi: function () { return !!(this.getKey() || CONFIG.PROXY_URL); },
    setKey: function (key) {
      memKey = key || "";
      try {
        if (key) localStorage.setItem(API_KEY, key); else localStorage.removeItem(API_KEY);
      } catch (e) { /* ignore */ }
    },
    hasStoredKey: function () {
      try { return !!localStorage.getItem(API_KEY); } catch (e) { return !!memKey; }
    },
    getDishes: function () {
      try {
        const raw = localStorage.getItem(DISHES_KEY);
        return raw ? JSON.parse(raw) : memDishes;
      } catch (e) { return memDishes; }
    },
    // Returns false if the browser refused (storage full or blocked), e.g. with many photos.
    setDishes: function (list) {
      memDishes = list || null;
      try {
        if (list) localStorage.setItem(DISHES_KEY, JSON.stringify(list)); else localStorage.removeItem(DISHES_KEY);
        return true;
      } catch (e) { return false; }
    },
    recordReject: function (id) {
      taste.rejected[id] = (taste.rejected[id] || 0) + 1; // session only, not saved
    },
    clearRejected: function () { taste.rejected = {}; },
    recordEaten: function (id) {
      taste.eaten.push({ id: id, ts: Date.now() });
      taste.eaten = taste.eaten.slice(-200);
      save();
    },
    // Dishes to steer away from: eaten recently, or rejected repeatedly.
    avoidIds: function (now) {
      const t = now || Date.now();
      const cutoff = t - CONFIG.RECENT_HOURS * 3600 * 1000;
      const out = [];
      taste.eaten.forEach(function (e) { if (e.ts >= cutoff && out.indexOf(e.id) === -1) out.push(e.id); });
      Object.keys(taste.rejected).forEach(function (id) {
        if (taste.rejected[id] >= CONFIG.DISLIKE_AFTER && out.indexOf(id) === -1) out.push(id);
      });
      return out;
    },
    recentlyEatenIds: function (now) {
      const t = now || Date.now();
      const cutoff = t - CONFIG.RECENT_HOURS * 3600 * 1000;
      return taste.eaten.filter(function (e) { return e.ts >= cutoff; }).map(function (e) { return e.id; });
    },
    rejectedIds: function () {
      return Object.keys(taste.rejected).filter(function (id) { return taste.rejected[id] >= 1; });
    },
    // For the memory panel: what is remembered, and how to forget one thing.
    rejectedCounts: function () {
      const out = {};
      Object.keys(taste.rejected).forEach(function (id) { if (taste.rejected[id] >= 1) out[id] = taste.rejected[id]; });
      return out;
    },
    forgetRejected: function (id) {
      delete taste.rejected[id];
    },
    recentEaten: function (now) {
      const t = now || Date.now();
      const cutoff = t - CONFIG.RECENT_HOURS * 3600 * 1000;
      const latest = {};
      taste.eaten.forEach(function (e) { if (e.ts >= cutoff && (!latest[e.id] || e.ts > latest[e.id])) latest[e.id] = e.ts; });
      return Object.keys(latest).map(function (id) { return { id: id, ts: latest[id] }; }).sort(function (a, b) { return b.ts - a.ts; });
    },
    forgetEaten: function (id) {
      taste.eaten = taste.eaten.filter(function (e) { return e.id !== id; });
      save();
    },
    clearTaste: function () {
      taste = { rejected: {}, eaten: [] };
      save();
    },
    summary: function () {
      return { rejected: Object.keys(taste.rejected).length, eaten: taste.eaten.length };
    }
  };
})();
