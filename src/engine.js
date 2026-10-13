/* ===================================================================
 * RULE ENGINE - deterministic parts. Jev decides *between* dishes;
 * these rules decide what is allowed to be on the table at all
 * (time of day, milky/meaty/pareve, repeats).
 * =================================================================== */
function mealTypesForHour(hour) {
  if (hour >= 5 && hour < 10) return ["breakfast"];
  if (hour >= 10 && hour < 12) return ["breakfast", "brunch", "lunch"];
  if (hour >= 12 && hour < 15) return ["lunch"];
  if (hour >= 15 && hour < 17) return ["snack"];
  if (hour >= 17 && hour < 21) return ["dinner"];
  return ["snack", "dessert"]; // 21:00 - 05:00
}

function labelForHour(hour) {
  if (hour >= 5 && hour < 10) return "breakfast time";
  if (hour >= 10 && hour < 12) return "late morning";
  if (hour >= 12 && hour < 15) return "lunchtime";
  if (hour >= 15 && hour < 17) return "mid-afternoon";
  if (hour >= 17 && hour < 21) return "dinnertime";
  if (hour >= 21 && hour < 24) return "late evening";
  return "the middle of the night";
}

/* ---- free text -> tags (offline) ---- */
let KEYWORDS_BY_LENGTH = [];
function rebuildKeywordOrder() {
  KEYWORDS_BY_LENGTH = Object.keys(KEYWORD_TO_TAG).sort(function (a, b) { return b.length - a.length; });
}
rebuildKeywordOrder();

/* "i dont want meaty", "no dairy", "anything but meat": a negated milky/meaty/pareve
 * word becomes "not-meaty" etc. (anything except that kind). */
const NEGATORS = ["dont", "don't", "not", "no", "never", "without", "hate", "avoid", "isnt", "isn't", "cant", "can't", "wont", "won't", "nothing", "skip"];
const NEG_FILLER = ["do", "want", "wanna", "like", "feel", "fancy", "need", "eat", "have", "any", "anything", "something", "a", "the", "really", "to", "be", "in", "mood", "for", "more", "i", "id", "i'd", "im", "i'm", "much", "too", "that", "it", "is", "its", "it's", "something", "actually", "now", "today", "tonight"];
function isNegatedAt(before) {
  const w = before.trim().split(" ").filter(Boolean);
  let i = w.length - 1;
  while (i >= 0 && NEG_FILLER.indexOf(w[i]) !== -1) i--;
  if (i < 0) return false;
  if (NEGATORS.indexOf(w[i]) !== -1) return true;
  if (w[i] === "but" && w[i - 1] === "anything") return true;        // "anything but meat"
  if (w[i] === "than" && w[i - 1] === "other") return true;          // "other than meat"
  if (w[i] === "of" && (w[i - 1] === "tired" || w[i - 1] === "sick")) return true; // "sick of meat"
  return false;
}

/* Any negating word at all? Used as a safety net when the offline reader can't parse the phrasing. */
function hasNegation(text) {
  const w = String(text || "").toLowerCase().replace(/[\u2018\u2019]/g, "'").replace(/[^a-z0-9' ]/g, " ").split(/\s+/);
  return w.some(function (x) { return NEGATORS.indexOf(x) !== -1 || x === "rather" || x === "instead" || x === "except" || x === "but"; });
}

function extractTags(text) {
  let s = " " + String(text || "").toLowerCase().replace(/[\u2018\u2019]/g, "'").replace(/[^a-z0-9\- ']/g, " ").replace(/\s+/g, " ") + " ";
  const found = [];
  KEYWORDS_BY_LENGTH.forEach(function (keyword) {
    if (!KEYWORD_TO_TAG[keyword]) return;
    const needle = " " + keyword + " ";
    const at = s.indexOf(needle);
    if (at !== -1) {
      const tag = KEYWORD_TO_TAG[keyword];
      if (tag.dimension === "kosher" && isNegatedAt(s.slice(0, at))) found.push({ dimension: "kosher", value: "not-" + tag.value });
      else found.push(tag);
      s = s.split(needle).join(" "); // consume, so "not spicy" doesn't also match "spicy"
    }
  });
  const seen = {};
  return found.filter(function (t) {
    const k = t.dimension + ":" + t.value;
    if (seen[k]) return false;
    seen[k] = true;
    return true;
  });
}

function dishMatchesTag(dish, tag) {
  const v = dish.tags[tag.dimension];
  return Array.isArray(v) ? v.indexOf(tag.value) !== -1 : v === tag.value;
}

/* ---- sticky preferences ----
 * One value per dimension (newest wins), except occasion which can stack. */
function mergePrefs(existing, incoming) {
  let out = existing.slice();
  incoming.forEach(function (tag) {
    if (tag.dimension === "kosher") return; // handled separately (hard rule)
    out = out.filter(function (t) {
      if (tag.dimension === "occasion") return !(t.dimension === "occasion" && t.value === tag.value);
      return t.dimension !== tag.dimension;
    });
    out.push(tag);
  });
  return out;
}

/* milky / meaty / pareve: one at a time, newest wins. `extra` is what Jev
 * heard (only passed when it is very sure); typed keywords win over it. */
function pickKosher(existing, tags, extra) {
  const typed = tags.filter(function (t) { return t.dimension === "kosher"; }).map(function (t) { return t.value; });
  if (typed.length) return typed[typed.length - 1];
  return extra || existing || null;
}

/* Plain-English version of the requirement (for chips, Jev and logs). */
function kosherPhrase(k) {
  if (!k) return "none";
  return k.indexOf("not-") === 0 ? "anything except " + k.slice(4) : k;
}

/* Hard rule. Asking for milky never returns a meaty dish and asking for
 * meaty never returns a milky one. Pareve dishes go with either, so they
 * stay in the pool (ranked below an exact match). Asking for pareve
 * returns pareve dishes only. */
function kosherAllows(dishKosher, wanted) {
  if (!wanted) return true;
  if (wanted.indexOf("not-") === 0) return dishKosher !== wanted.slice(4); // "not meaty": milky and pareve both fine
  if (wanted === "pareve") return dishKosher === "pareve";
  return dishKosher === wanted || dishKosher === "pareve";
}

/* ---- what may be suggested ----
 * milky/meaty/pareve: hard, never relaxed.
 * time of day: a SUPPORTING factor, not a rule. Every dish stays in the
 *   pool; dishes that suit the current meal get a boost in rankCandidates,
 *   so they come first and the others only appear once those are used up
 *   (or when the user's own preferences point at them).
 * explicitly asked-for meal type ("dessert", "breakfast"): that IS a
 *   request, so it filters (and is only dropped if nothing matches).
 * repeats: dishes already suggested this chat are left out; dishes you
 *   ate recently or keep rejecting are left out if alternatives exist. */
function selectPool(dishes, o) {
  const requestedMeals = (o.prefs || []).filter(function (p) { return p.dimension === "mealType"; }).map(function (p) { return p.value; });
  const timeMeals = mealTypesForHour(o.hour);
  const kosher = o.kosher || null;
  const sessionIds = o.sessionIds || [];
  const softAvoid = o.softAvoidIds || [];

  let base = dishes.filter(function (d) { return kosherAllows(d.tags.kosher, kosher); });

  // "skip meaty for now" (said by a meaty person): leave that kind out unless nothing else is left
  if (o.skipKind) {
    const rest = base.filter(function (d) { return d.tags.kosher !== o.skipKind; });
    if (rest.length) base = rest;
  }

  let broadenedMealType = false;
  if (requestedMeals.length) {
    const wanted = base.filter(function (d) { return d.tags.mealType.some(function (m) { return requestedMeals.indexOf(m) !== -1; }); });
    if (wanted.length) base = wanted; else broadenedMealType = true;
  }

  let recycled = false;
  let pool = base.filter(function (d) { return sessionIds.indexOf(d.id) === -1 && softAvoid.indexOf(d.id) === -1; });
  if (!pool.length) pool = base.filter(function (d) { return sessionIds.indexOf(d.id) === -1; });
  if (!pool.length && base.length) { pool = base; recycled = true; }

  return {
    pool: pool,
    broadenedMealType: broadenedMealType,
    recycled: recycled,
    // ignoreTime: the user switched time-of-day off in the memory panel (no boost at all)
    fitMeals: requestedMeals.length && !broadenedMealType ? requestedMeals : (o.ignoreTime ? [] : timeMeals),
    timeOverridden: !o.ignoreTime && requestedMeals.length > 0 && !broadenedMealType && requestedMeals.join() !== timeMeals.join(),
    timeLabel: labelForHour(o.hour)
  };
}

function fitsMeal(dish, fitMeals) {
  return dish.tags.mealType.some(function (m) { return fitMeals.indexOf(m) !== -1; });
}

/* ---- rank: each stated preference a dish satisfies is worth 1; suiting the
 * current meal is worth TIME_WEIGHT (less than one preference, more than
 * nothing). Keeps the best tier (at least 4 dishes, at most max) so Jev has
 * real options to choose between. Ties are shuffled for variety. */
const TIME_WEIGHT = 0.75;

function rankCandidates(pool, prefs, max, rng, fitMeals) {
  const rand = rng || Math.random;
  const scored = pool.map(function (d) {
    let s = prefs.filter(function (p) { return p.dimension !== "mealType" && p.dimension !== "kosher" && dishMatchesTag(d, p); }).length;
    if (fitMeals && fitsMeal(d, fitMeals)) s += TIME_WEIGHT;
    return { d: d, s: s, r: rand() };
  });
  scored.sort(function (a, b) { return b.s - a.s || a.r - b.r; });
  const top = scored.length ? scored[0].s : 0;
  const out = [];
  for (let i = 0; i < scored.length && out.length < max; i++) {
    if (out.length >= 4 && scored[i].s < top) break;
    out.push(scored[i].d);
  }
  return out;
}

/* Debug: the same scores rankCandidates uses, without the shuffle. */
function explainRanking(pool, prefs, fitMeals) {
  return pool.map(function (d) {
    const matched = prefs.filter(function (p) { return p.dimension !== "mealType" && p.dimension !== "kosher" && dishMatchesTag(d, p); });
    const fits = !!(fitMeals && fitsMeal(d, fitMeals));
    return { name: d.name, score: matched.length + (fits ? TIME_WEIGHT : 0), matched: matched.map(describePref), suitsMeal: fits };
  }).sort(function (a, b) { return b.score - a.score; });
}

/* ---- offline picker (no key, or Jev unavailable) ---- */
function fallbackPick(ranked) {
  if (!ranked.length) return null;
  return { id: ranked[0].id, confidence: null, others: ranked.slice(1, 3).map(function (d) { return d.id; }), fromJev: false };
}

const CLARIFY_TOPICS = ["kosher", "weight", "temperature", "speed"];

function describePref(p) {
  if (p.dimension === "occasion") return p.value;
  if (p.dimension === "kosher") return kosherPhrase(p.value);
  return p.dimension + ": " + p.value;
}

/* ===================================================================
 * ASKING FOR A DISH BY NAME ("cereal", "pizza", "fish and chips")
 * -------------------------------------------------------------------
 * Matches whole dish names first (ignoring little words like "and"),
 * then single distinctive words, but only in short messages so a long
 * sentence ("something quick with chicken for dinner") isn't hijacked.
 * =================================================================== */
const NAME_STOPWORDS = ["and", "with", "the", "a", "an", "of", "up", "side", "in", "on", "for", "to", "i", "id", "ill", "want", "have", "like", "please", "some", "can", "could", "get", "me", "my"];

function nameTokens(text) {
  return String(text || "").toLowerCase().replace(/[^a-z0-9 ]/g, " ").split(/\s+/).filter(function (w) { return w && NAME_STOPWORDS.indexOf(w) === -1; });
}
function wordVariants(w) {
  const v = [w];
  if (w.length > 3 && /s$/.test(w)) v.push(w.slice(0, -1));
  if (w.length > 4 && /es$/.test(w)) v.push(w.slice(0, -2));
  if (w.length > 4 && /ies$/.test(w)) v.push(w.slice(0, -3) + "y");
  return v;
}
function wordsMatch(a, b) {
  const va = wordVariants(a), vb = wordVariants(b);
  return va.some(function (x) { return vb.indexOf(x) !== -1; });
}

/* Returns dishes the message names, best match first (max 3). */
function findNamedDishes(text, dishes) {
  const msg = nameTokens(text);
  if (!msg.length) return [];
  const short = msg.length <= 3;
  const phrase = [], words = [];
  dishes.forEach(function (d, order) {
    const dt = nameTokens(d.name);
    if (!dt.length) return;
    // whole name (content words, in order, back to back)
    let found = false;
    for (let i = 0; i + dt.length <= msg.length && !found; i++) {
      found = dt.every(function (w, j) { return wordsMatch(msg[i + j], w); });
    }
    if (found) { phrase.push({ d: d, score: dt.length, order: order }); return; }
    if (short) {
      const overlap = dt.filter(function (w) { return w.length >= 4 && msg.some(function (m) { return wordsMatch(m, w); }); }).length;
      if (overlap > 0) words.push({ d: d, score: overlap, order: order });
    }
  });
  const pick = phrase.length ? phrase : words;
  pick.sort(function (a, b) { return b.score - a.score || a.order - b.order; });
  const best = pick.length ? pick[0].score : 0;
  return pick.filter(function (p) { return p.score === best; }).slice(0, 3).map(function (p) { return p.d; });
}
