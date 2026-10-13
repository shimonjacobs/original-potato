/* The deterministic rules. Pure functions: no storage, no network, no DOM.
 *
 * Hard rule (the only one): when the user is meaty, milky dishes are never
 * offered. Everything else is a soft preference that only changes the ranking:
 * time of day, what they asked for, and what they ate recently. Jev then picks
 * among the shortlist; nothing outside the user's list is ever offered. */
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

  /* ---- did the message name a dish? ("pizza", "fish and chips") ---- */
  const FILLER = ["and", "with", "the", "a", "an", "of"];
  function nameKey(text) {
    return " " + String(text || "").toLowerCase().replace(/[^a-z0-9 ]/g, " ").split(/\s+/)
      .filter(function (w) { return w && FILLER.indexOf(w) === -1; })
      .map(function (w) { return w.replace(/s$/, ""); }).join(" ") + " ";
  }
  /* Dishes whose whole name appears in the text. "steak burgers" gives Steak Burgers, not Steak. */
  function named(text, dishes) {
    const msg = nameKey(text);
    const hits = dishes.filter(function (d) { return nameKey(d.name).trim() && msg.indexOf(nameKey(d.name)) !== -1; });
    return hits.filter(function (d) {
      return !hits.some(function (o) { return o !== d && nameKey(o.name) !== nameKey(d.name) && nameKey(o.name).indexOf(nameKey(d.name)) !== -1; });
    });
  }

  return {
    mealsForHour: mealsForHour, labelForHour: labelForHour,
    isBlocked: isBlocked, fitsMeal: fitsMeal, matchesPref: matchesPref, mergePrefs: mergePrefs,
    pool: pool, score: score, shortlist: shortlist, explain: explain, named: named
  };
})();
