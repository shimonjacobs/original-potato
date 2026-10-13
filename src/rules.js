/* The deterministic rules. Pure functions: no storage, no network, no DOM.
 *
 * Hard rule: when the user is meaty, milky dishes are never offered.
 * What they ask for ("cold", "light") narrows the choice while any matching dish
 * is left (see narrow). Time of day and recent meals only change the ranking.
 * Jev then picks among the shortlist; nothing outside the user's list is ever offered. */
const Rules = (function () {
  /* [from hour, to hour, meal types that suit it, label] */
  const WINDOWS = [
    [0, 5, ["snack", "dessert"], "the middle of the night"],
    [5, 10, ["breakfast"], "breakfast time"],
    [10, 12, ["breakfast", "brunch", "lunch"], "late morning"],
    [12, 15, ["lunch"], "lunchtime"],
    [15, 17, ["snack"], "mid-afternoon"],
    [17, 21, ["dinner"], "dinnertime"],
    [21, 24, ["snack", "dessert"], "late evening"]
  ];
  function windowFor(hour) {
    return WINDOWS.filter(function (w) { return hour >= w[0] && hour < w[1]; })[0];
  }
  function mealsForHour(hour) { return windowFor(hour)[2]; }
  function labelForHour(hour) { return windowFor(hour)[3]; }

  function isBlocked(dish, meaty) { return !!meaty && dish.tags.kosher === "milky"; }

  function fitsMeal(dish, meals) {
    return dish.tags.mealType.some(function (m) { return meals.indexOf(m) !== -1; });
  }

  /* A soft preference is { dimension, value }. For "kosher", "not-meaty" means any dish that isn't meaty. */
  function matchesPref(dish, pref) {
    const v = dish.tags[pref.dimension];
    if (pref.dimension === "kosher" && pref.value === "not-meaty") return v !== "meaty";
    return Array.isArray(v) ? v.indexOf(pref.value) !== -1 : v === pref.value;
  }

  /* One value per dimension (newest wins), except occasion, which stacks. */
  function mergePrefs(existing, incoming) {
    let out = existing.slice();
    incoming.forEach(function (p) {
      out = out.filter(function (o) { return o.dimension !== p.dimension || (p.dimension === "occasion" && o.value !== p.value); });
      out.push(p);
    });
    return out;
  }

  /* What may be offered: not blocked by the hard rule, and not already offered this chat.
   * If everything allowed has been offered, start the allowed dishes over. */
  function pool(dishes, o) {
    const allowed = dishes.filter(function (d) { return !isBlocked(d, o.meaty); });
    const fresh = allowed.filter(function (d) { return o.offeredIds.indexOf(d.id) === -1; });
    return fresh.length ? fresh : allowed;
  }

  /* What the user asked for decides what is offered while any matching dish is left, so a
   * "cold" or "eggs" request never turns into something else just because the matching
   * dish was used up. o.asked is the ids of dishes their words matched (see findAsked).
   *   mode "all":       nothing asked for, so use the pool as it is
   *   mode "match":     dishes that match what they asked for and haven't been offered
   *   mode "exhausted": matching dishes exist but all were offered, so there is nothing more to suggest
   *   mode "closest":   no dish matches every preference, so rank by how many each matches */
  function narrow(dishes, o) {
    if (o.asked.length) {
      const wanted = dishes.filter(function (d) { return o.asked.indexOf(d.id) !== -1 && !isBlocked(d, o.meaty); });
      const left = wanted.filter(function (d) { return o.offeredIds.indexOf(d.id) === -1; });
      if (left.length) return { mode: "match", pool: left };
      if (wanted.length) return { mode: "exhausted", pool: [] };
    }
    if (!o.prefs.length) return { mode: "all", pool: pool(dishes, o) };
    const matching = dishes.filter(function (d) { return !isBlocked(d, o.meaty) && o.prefs.every(function (p) { return matchesPref(d, p); }); });
    const fresh = matching.filter(function (d) { return o.offeredIds.indexOf(d.id) === -1; });
    if (fresh.length) return { mode: "match", pool: fresh };
    if (matching.length) return { mode: "exhausted", pool: [] };
    return { mode: "closest", pool: pool(dishes, o) };
  }

  /* "cold and heavy", for replies. */
  function describePrefs(prefs) {
    const words = { "not-meaty": "meat-free", comfort: "comfort food" };
    return prefs.map(function (p) { return words[p.value] || p.value; }).join(" and ");
  }

  /* Each matched preference is worth 1, suiting the meal is worth TIME_WEIGHT,
   * a recent meal loses RECENT_PENALTY. Weak on purpose: regular foods stay on the table. */
  function score(dish, o) {
    let s = o.prefs.filter(function (p) { return matchesPref(dish, p); }).length;
    if (fitsMeal(dish, o.meals)) s += Config.TIME_WEIGHT;
    if (o.recentIds.indexOf(dish.id) !== -1) s -= Config.RECENT_PENALTY;
    return s;
  }

  /* The `max` best-scoring dishes, so Jev has real options. Ties are shuffled for variety. */
  function shortlist(candidates, o, max, rng) {
    const rand = rng || Math.random;
    return candidates
      .map(function (d) { return { d: d, s: score(d, o), r: rand() }; })
      .sort(function (a, b) { return b.s - a.s || a.r - b.r; })
      .slice(0, max)
      .map(function (x) { return x.d; });
  }

  function explain(candidates, o) {
    return candidates.map(function (d) { return { name: d.name, score: score(d, o) }; }).sort(function (a, b) { return b.score - a.score; });
  }

  /* ---- did the message ask for a dish or an ingredient? ("pizza", "fish and chips", "eggs") ---- */
  const FILLER = ["and", "with", "the", "a", "an", "of", "up", "side", "on", "in"];
  /* [{ raw, key }]: the words of a text without filler, and each word without a plural s. */
  function words(text) {
    return String(text || "").toLowerCase().replace(/[^a-z0-9 ]/g, " ").split(/\s+/)
      .filter(function (w) { return w && FILLER.indexOf(w) === -1; })
      .map(function (w) { return { raw: w, key: w.replace(/s$/, "") }; });
  }
  function keyOf(text) { return words(text).map(function (w) { return w.key; }).join(" "); }

  /* { dishes, term }. First choice: dishes whose whole name is in the text ("steak burgers" gives
   * Steak Burgers, not Steak). Otherwise any single word (3+ letters) that is in a dish's name or is
   * one of its ingredient tags ("eggs" gives every egg dish). term is the matched wording, for replies. */
  function findAsked(text, dishes) {
    const msg = words(text);
    const msgKey = " " + keyOf(text) + " ";
    const full = dishes.filter(function (d) { const k = keyOf(d.name); return k && msgKey.indexOf(" " + k + " ") !== -1; });
    const whole = full.filter(function (d) {
      return !full.some(function (o) { return o !== d && keyOf(o.name) !== keyOf(d.name) && keyOf(o.name).indexOf(keyOf(d.name)) !== -1; });
    });
    if (whole.length) return { dishes: whole, term: whole.map(function (d) { return d.name.toLowerCase(); }).join(" or ") };

    const matched = [], terms = [];
    dishes.forEach(function (d) {
      const keys = words(d.name).map(function (w) { return w.key; }).concat((d.tags.ingredient || []).map(function (i) { return i.replace(/s$/, ""); }));
      msg.forEach(function (m) {
        if (m.key.length < 3 || keys.indexOf(m.key) === -1) return;
        if (matched.indexOf(d) === -1) matched.push(d);
        if (terms.indexOf(m.raw) === -1) terms.push(m.raw);
      });
    });
    return { dishes: matched, term: terms.join(" ") };
  }

  return {
    mealsForHour: mealsForHour, labelForHour: labelForHour,
    isBlocked: isBlocked, fitsMeal: fitsMeal, matchesPref: matchesPref, mergePrefs: mergePrefs,
    pool: pool, narrow: narrow, describePrefs: describePrefs, score: score, shortlist: shortlist, explain: explain, findAsked: findAsked
  };
})();
