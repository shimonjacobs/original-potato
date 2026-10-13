/* ===================================================================
 * CONTROLLER - one chat turn, start to finish (no DOM in here).
 *
 *   text -> offline tags -> Jev intent -> rules (what's allowed)
 *        -> clarify?  or  rank -> Jev pick -> Haiku wording
 *
 * Degrades one layer at a time: Jev fails -> offline rules decide;
 * Haiku fails -> templates word it. Dietary needs are always enforced
 * by the rules, never left to a model.
 * =================================================================== */
function newSession() {
  return { history: [], kosher: null, kosherSrc: null, skipKind: null, ignoreTime: false, prefs: [], suggestedIds: [], lastDish: null, clarifiersAsked: 0 };
}

function isDeadLink(err) {
  return err && (err.kind === "nokey" || err.kind === "network" || err.kind === "auth" || err.kind === "credits");
}

/* Public entry: wraps one turn in a debug trace (a no-op unless Debug mode is on). */
async function runTurn(S, text, opts) {
  opts = opts || {};
  const traceId = Trace.begin({ text: text || "", action: opts.action || "message", hour: typeof opts.hour === "number" ? opts.hour : new Date().getHours(), hasKey: Store.hasAi() });
  try {
    const res = await runTurnCore(S, text, opts);
    res.traceId = traceId;
    (res.errors || []).forEach(function (e) { Trace.step("Problem noted", "error", explainError(e)); });
    const d = res.decision || {};
    Trace.end({ action: d.action, dish: d.dish ? d.dish.name : null, confidence: d.confidence, reply: res.reply, usedJev: !!res.engine.jev, usedHaiku: !!res.engine.haiku });
    return res;
  } catch (err) {
    Trace.step("Unexpected failure", "error", err && err.message ? err.message : String(err));
    Trace.end({ crashed: true });
    throw err;
  }
}

async function runTurnCore(S, text, opts) {
  opts = opts || {};
  const errors = [];
  const hour = typeof opts.hour === "number" ? opts.hour : new Date().getHours();
  const timeLabel = labelForHour(hour);
  const isReject = opts.action === "reject";
  const isRefresh = opts.action === "refresh"; // "Update suggestion" after the memory panel changed
  const skipText = isReject || isRefresh;
  const kwTags = text && !skipText ? extractTags(text).map(function (t) { return { dimension: t.dimension, value: t.value, src: "typed" }; }) : [];
  const lastAssistant = S.history.slice().reverse().filter(function (m) { return m.role === "assistant"; })[0];

  // 0. The user named a dish ("cereal", "pizza")? Give them exactly that, whatever
  //    the time of day. No model call is needed to decide. If they also asked for
  //    milky/meaty/pareve in the same message and the dish conflicts, ignore the match.
  if (!skipText && text) {
    const named = findNamedDishes(text, DISHES).filter(function (d) { return kosherAllows(d.tags.kosher, pickKosher(null, kwTags, null)); });
    if (named.length) {
      const dish = named[0];
      const timeMeals = mealTypesForHour(hour);
      const usual = dish.tags.mealType;
      const outside = !S.ignoreTime && !usual.some(function (m) { return timeMeals.indexOf(m) !== -1; });
      updateKosher(S, kwTags, null);
      Trace.step("Dish named by user", "ok", "Matched \"" + dish.name + "\" by name, so no model was needed to decide.", { matches: named.map(function (d) { return d.name; }), usualMeals: usual, outsideUsualTime: outside });
      const decision = {
        action: "recommend", dish: dish, backups: named.slice(1), confidence: null, timeLabel: S.ignoreTime ? null : timeLabel,
        notes: {
          namedByUser: true, ignoreTime: S.ignoreTime,
          outsideUsualTime: outside, usualMeals: usual.join("/"),
          kosherMismatch: S.kosher && !kosherAllows(dish.tags.kosher, S.kosher) ? dish.tags.kosher + " (you'd asked for " + kosherPhrase(S.kosher) + ")" : null
        },
        preferences: []
      };
      if (S.suggestedIds.indexOf(dish.id) === -1) S.suggestedIds.push(dish.id);
      S.lastDish = dish;
      const r = await finishTurn(S, decision, errors, Store.hasAi(), false, opts);
      r.engine.named = true;
      return r;
    }
  }

  Trace.step("Typed words read offline", kwTags.length ? "ok" : "info", kwTags.length ? kwTags.map(function (t) { return t.dimension + ": " + t.value; }).join(", ") : "No known keywords found in the message.", { tags: kwTags, time: timeLabel, hour: hour, state: { kosher: S.kosher, prefs: S.prefs, ignoreTime: S.ignoreTime, suggested: S.suggestedIds } });

  // 1. Jev reads the message (skipped for the "Not this one" button).
  let intent = null;
  let jevUsable = Store.hasAi();
  if (!skipText && text && jevUsable) {
    try {
      intent = await parseIntent({
        message: text, timeLabel: timeLabel,
        lastDishName: S.lastDish ? S.lastDish.name : null,
        lastAssistantText: lastAssistant ? lastAssistant.content : null
      });
      Trace.step("Jev's reading of the message", "ok", "vague " + (intent.vague == null ? "?" : intent.vague) + (intent.rejectsLast ? ", rejects last dish" : "") + (intent.kosher ? ", kosher: " + intent.kosher : ""), intent);
    } catch (e) { errors.push(e); if (isDeadLink(e)) jevUsable = false; Trace.step("Jev's reading of the message", "error", explainError(e)); }
  } else {
    Trace.step("Jev's reading of the message", "skip", skipText ? "Skipped (button press, no new text)." : (!jevUsable ? "Skipped (no key)." : "Skipped (no text)."));
  }

  // 2. Rejection feedback.
  const rejected = !!((isReject || (intent && intent.rejectsLast)) && S.lastDish);
  if (rejected) Store.recordReject(S.lastDish.id);

  // 3. Merge what we learned. Milky/meaty/pareve = typed keywords, else (very sure) Jev.
  updateKosher(S, kwTags, intent ? intent.kosher : null, text);
  // Jev's reading goes in first and what you typed goes in last, so typed words win.
  if (intent) S.prefs = mergePrefs(S.prefs, intent.prefs.map(function (p) { return { dimension: p.dimension, value: p.value, src: "jev" }; }));
  S.prefs = mergePrefs(S.prefs, kwTags);
  Trace.step("Preferences after merging", "ok", "Typed words override Jev's. Milky/meaty/pareve is a hard rule.", { kosher: S.kosher, kosherSource: S.kosherSrc, prefs: S.prefs, rejectedLast: rejected });

  // 4. Too vague on a fresh chat? Ask one question instead of guessing.
  const vague = intent ? intent.vague >= CONFIG.VAGUE_THRESHOLD : (kwTags.length === 0 && S.history.filter(function (m) { return m.role === "user"; }).length <= 1);
  if (!skipText && vague && S.prefs.length === 0 && !S.kosher && !rejected && S.clarifiersAsked < 1 && !S.lastDish) {
    S.clarifiersAsked += 1;
    Trace.step("Decision: ask a clarifying question", "ok", "Message was too vague and nothing is known yet. Topic: " + (intent ? intent.clarifyTopic : "kosher"));
    return finishTurn(S, { action: "clarify", dish: null, backups: [], confidence: null, timeLabel: timeLabel,
      clarifyTopic: intent ? intent.clarifyTopic : "kosher", notes: {}, preferences: [] }, errors, jevUsable, false, opts);
  }

  // 5. What is allowed?
  const sel = selectPool(DISHES, { hour: hour, kosher: S.kosher, ignoreTime: S.ignoreTime, prefs: S.prefs, skipKind: S.skipKind, sessionIds: S.suggestedIds, softAvoidIds: Store.avoidIds() });
  Trace.step("Rules: which dishes are allowed", sel.pool.length ? "ok" : "warn",
    sel.pool.length + " of " + DISHES.length + " dishes allowed" + (sel.broadenedMealType ? " (requested meal type matched nothing, so broadened)" : "") + (sel.recycled ? " (had to repeat earlier suggestions)" : ""),
    { kosherRule: kosherPhrase(S.kosher), mealsFavoured: sel.fitMeals, timeOverridden: sel.timeOverridden, allowed: sel.pool.map(function (d) { return d.name; }),
      excluded: DISHES.filter(function (d) { return sel.pool.indexOf(d) === -1; }).map(function (d) { return d.name + " (" + excludeReason(d, S, sel) + ")"; }) });
  if (!sel.pool.length) {
    return finishTurn(S, { action: "nothing", dish: null, backups: [], confidence: null, timeLabel: timeLabel, notes: {}, preferences: S.prefs.map(describePref) }, errors, jevUsable, false, opts);
  }
  const rankPrefs = S.kosher ? S.prefs.concat([{ dimension: "kosher", value: S.kosher }]) : S.prefs;
  const ranked = rankCandidates(sel.pool, rankPrefs, CONFIG.MAX_CANDIDATES, opts.rng, sel.fitMeals);

  Trace.step("Ranking: shortlist for Jev", "ok", ranked.length + " candidates. Each preference matched = 1 point, suits the meal = " + TIME_WEIGHT + ".", explainRanking(sel.pool, rankPrefs, sel.fitMeals).slice(0, 20).map(function (r) {
    return r.name + ": " + r.score + (ranked.some(function (d) { return d.name === r.name; }) ? " (shortlisted)" : "");
  }));

  // 6. Jev picks (or the offline picker).
  let pick = null;
  if (ranked.length === 1) {
    pick = { id: ranked[0].id, confidence: 1, others: [], fromJev: false };
  } else if (jevUsable) {
    try {
      pick = await pickDish(ranked, {
        message: text || "Show me something different.", timeLabel: S.ignoreTime ? "any time of day" : timeLabel, prefs: rankPrefs, kosher: S.kosher, skip: S.skipKind,
        fitMeals: sel.fitMeals.length ? sel.fitMeals : null, recentlyEaten: Store.recentlyEatenIds().map(nameOf), rejected: Store.rejectedIds().map(nameOf),
        offered: S.suggestedIds.filter(function (id, i, a) { return a.indexOf(id) === i; }).map(nameOf)
      });
      Trace.step("Jev's pick", "ok", "Chose " + nameOf(pick.id) + (typeof pick.confidence === "number" ? " at " + Math.round(pick.confidence * 100) + "% confidence" : ""), pick);
    } catch (e) { errors.push(e); if (isDeadLink(e)) jevUsable = false; Trace.step("Jev's pick", "error", explainError(e)); }
  }
  const usedJev = !!(pick && pick.fromJev) || !!intent;
  if (!pick) { pick = fallbackPick(ranked); Trace.step("Offline pick", "warn", "Jev did not choose, so the top-ranked dish was used: " + nameOf(pick.id)); }
  else if (ranked.length === 1) Trace.step("Jev's pick", "skip", "Only one candidate left, so no model call was needed.");

  const dish = dishById(pick.id);
  let backupIds = pick.others.filter(function (id) { return id !== dish.id; });
  if (backupIds.length < 2) {
    ranked.forEach(function (d) { if (d.id !== dish.id && backupIds.indexOf(d.id) === -1 && backupIds.length < 2) backupIds.push(d.id); });
  }
  const lowConfidence = typeof pick.confidence === "number" && pick.confidence < CONFIG.PICK_MIN_CONFIDENCE;

  const decision = {
    action: "recommend", dish: dish, backups: backupIds.map(dishById), confidence: pick.confidence,
    timeLabel: S.ignoreTime ? null : timeLabel,
    notes: { ignoreTime: S.ignoreTime, skippingKind: S.skipKind || undefined, rejectedPrevious: rejected, lowConfidence: lowConfidence, broadenedMealType: sel.broadenedMealType, recycled: sel.recycled, timeOverridden: sel.timeOverridden,
      outsideUsualTime: sel.fitMeals.length > 0 && !fitsMeal(dish, sel.fitMeals), usualMeals: dish.tags.mealType.join("/") },
    preferences: rankPrefs.map(describePref)
  };
  Trace.step("Decision", lowConfidence ? "warn" : "ok", dish.name + (lowConfidence ? " (low confidence, reply will hedge)" : ""), { dish: dish.name, backups: decision.backups.map(function (d) { return d.name; }), confidence: pick.confidence, notes: decision.notes });
  S.suggestedIds.push(dish.id);
  S.lastDish = dish;
  return finishTurn(S, decision, errors, jevUsable, usedJev, opts);
}

/* milky/meaty/pareve: typed words win; Jev's reading only counts if it was very sure. */
function updateKosher(S, kwTags, jevKosher, text) {
  const prev = S.kosher;
  S.kosher = pickKosher(S.kosher, kwTags, jevKosher);
  // Safety net: the typed words found a plain "meaty" but the sentence is negated in a way the
  // offline reader couldn't parse, and Jev (very sure) read something else. Trust Jev then.
  const typed = kwTags.filter(function (t) { return t.dimension === "kosher"; });
  const typedVal = typed.length ? typed[typed.length - 1].value : null;
  if (typedVal && typedVal.indexOf("not-") !== 0 && jevKosher && jevKosher !== typedVal && hasNegation(text)) {
    S.kosher = jevKosher; S.kosherSrc = "jev";
    Trace.step("Negation safety net", "warn", "Your message has a negating word and Jev read it differently from the keywords, so Jev's reading (" + jevKosher + ") is used.", { typed: typedVal, jev: jevKosher });
    return;
  }
  // "I dont want meaty" from someone who IS meaty means "not a meaty dish right now", not
  // "I've stopped being meaty". Keep the requirement (so milky never appears) and just skip that kind.
  if (typedVal && typedVal.indexOf("not-") === 0) {
    const kind = typedVal.slice(4);
    if (prev && prev.indexOf("not-") !== 0) {
      S.kosher = prev;
      if (prev === kind) { S.skipKind = kind; Trace.step("Skipping a kind, keeping the requirement", "ok", "You are " + prev + ", so \"not " + kind + "\" means skip " + kind + " dishes for now. The " + prev + " rule stays."); }
      return;
    }
    S.skipKind = null;
  } else if (typedVal) S.skipKind = null;
  if (typed.length) S.kosherSrc = "typed";
  else if (S.kosher && S.kosher !== prev) S.kosherSrc = "jev";
  if (!S.kosher) S.kosherSrc = null;
}

/* Why was a dish left out of the pool? (debug only) */
function excludeReason(d, S, sel) {
  if (!kosherAllows(d.tags.kosher, S.kosher)) return d.tags.kosher + " clashes with " + kosherPhrase(S.kosher);
  if (S.skipKind && d.tags.kosher === S.skipKind) return "skipping " + S.skipKind + " dishes for now";
  if (S.suggestedIds.indexOf(d.id) !== -1) return "already suggested";
  if (Store.avoidIds().indexOf(d.id) !== -1) return "eaten recently or turned down";
  return "not the requested meal type";
}

function nameOf(id) { const d = dishById(id); return d ? d.name : id; }

async function finishTurn(S, decision, errors, linkOk, usedJev, opts) {
  let reply = null;
  let usedHaiku = false;
  if (linkOk && Store.hasAi() && !opts.noHaiku) {
    try { reply = await haikuReply(decision, S.history); usedHaiku = true; Trace.step("Haiku wrote the reply", "ok", reply); }
    catch (e) { errors.push(e); Trace.step("Haiku wrote the reply", "error", explainError(e)); }
  } else {
    Trace.step("Haiku wrote the reply", "skip", !linkOk ? "Skipped (no working connection)." : "Skipped.");
  }
  if (!reply) { reply = templateReply(decision); Trace.step("Template reply used", "warn", reply); }
  return { decision: decision, reply: reply, engine: { jev: usedJev, haiku: usedHaiku }, errors: errors };
}

/* ---- connection test for the Settings panel ---- */
async function testConnection() {
  const out = [];
  try {
    const a = await callJev({ message: "I'd like a hot, spicy dinner." }, {
      spicy: noulQ("Does the user want spicy food?", "They want spicy food.", "They do not.")
    });
    out.push({ name: "Jev decisions", ok: true, detail: "Working (spicy = " + (a.spicy && a.spicy.noul) + ")" });
  } catch (e) { out.push({ name: "Jev decisions", ok: false, detail: explainError(e) }); }
  try {
    const t = await postJson(CONFIG.CHAT_URL, { model: CONFIG.CHAT_MODEL, max_tokens: 20, messages: [{ role: "user", content: "Say OK." }] });
    out.push({ name: "Claude Haiku replies", ok: true, detail: "Working" });
  } catch (e) { out.push({ name: "Claude Haiku replies", ok: false, detail: explainError(e) }); }
  return out;
}

function explainError(e) {
  if (!e) return "Unknown error";
  if (e.kind === "nokey") return "No key set. Paste your OpenRouter key above.";
  if (e.kind === "network") return "The browser blocked or couldn't send the request. If your internet is fine, this is usually CORS: OpenRouter's decisions endpoint may not allow calls from a web page. Chat will fall back to the built-in rules for that part.";
  if (e.kind === "auth") return "OpenRouter rejected the key (" + e.message + ").";
  if (e.kind === "credits") return "Out of OpenRouter credits.";
  return e.message || String(e);
}
