/* One chat turn, start to finish (no DOM in here).
 *
 *   typed words -> Jev reads them -> rules (what is allowed, what ranks first)
 *               -> Jev picks from the shortlist -> Haiku words it (or a template)
 *
 * If Jev can't be reached the turn comes back { offline: true } and the app
 * falls back to the plain list. If only Haiku fails, the template words it.
 * The meaty rule is enforced here by Rules, never left to a model. If every dish
 * matching what they asked for has been offered, the turn comes back
 * { action: "exhausted" } with no dish instead of offering something they ruled out. */
const Turn = (function () {
  function newSession() {
    return {
      history: [], meaty: false, ignoreTime: false, prefs: [], offeredIds: [], rejectedIds: [], lastDish: null,
      lastRequest: "",  // the last thing they typed, kept so "Not this one" still knows what they wanted
      asked: [], askedLabel: ""  // ids of the dishes their words matched ("eggs" gives every egg dish), and the wording
    };
  }

  /* opts: { action: "open" (the I'm hungry button) | "reject" | "refresh" (omit for typed text), chip (text came from a quick chip), hour, rng } */
  async function run(S, text, opts) {
    opts = opts || {};
    const hour = typeof opts.hour === "number" ? opts.hour : new Date().getHours();
    Debug.begin({ text: text || "", action: opts.action || "message", hour: hour });
    try {
      const res = await core(S, text || "", opts, hour);
      const d = res.decision || {};
      Debug.end({ offline: !!res.offline, dish: d.dish ? d.dish.name : null, blocked: d.blocked ? d.blocked.name : null, confidence: d.confidence, reply: res.reply, usedHaiku: res.usedHaiku });
      return res;
    } catch (err) {
      Debug.step("Unexpected failure", "error", err && err.message ? err.message : String(err));
      Debug.end({ crashed: true });
      throw err;
    }
  }

  async function core(S, text, opts, hour) {
    const errors = [];
    const dishes = Dishes.all();
    const timeLabel = S.ignoreTime ? null : Rules.labelForHour(hour);
    const meals = S.ignoreTime ? [] : Rules.mealsForHour(hour);
    let linkUp = Ai.available();
    let rejectsLast = opts.action === "reject";
    let namesDish = false;
    const failed = function (step, e) { errors.push(e); if (Ai.isDead(e)) linkUp = false; Debug.step(step, "error", Ai.explain(e)); };

    S.history.push({ role: "user", content: text || (rejectsLast ? "Not this one." : opts.action === "open" ? "I'm hungry." : "(suggest something)") });

    // 1. Jev reads typed words into preferences.
    if (text && linkUp) {
      try {
        const intent = await Picker.readText({ message: text, timeLabel: timeLabel, lastDishName: S.lastDish ? S.lastDish.name : null });
        if (intent.rejectsLast) rejectsLast = true;
        namesDish = intent.namesDish;
        S.prefs = Rules.mergePrefs(S.prefs, intent.prefs);
        Debug.step("Jev's reading of the message", "ok", intent.prefs.map(function (p) { return p.dimension + ": " + p.value; }).join(", ") || "no preferences", intent);
      } catch (e) { failed("Jev's reading of the message", e); }
    }
    if (rejectsLast && S.lastDish && S.rejectedIds.indexOf(S.lastDish.id) === -1) S.rejectedIds.push(S.lastDish.id);

    // 2. Remember what they asked for. A new request that names dishes or ingredients replaces the
    //    old one; a request for a food that isn't on the list clears it. Either way "Not this one"
    //    keeps working from the current request.
    const typed = text ? Rules.findAsked(text, dishes) : { dishes: [], term: "" };
    if (typed.dishes.length) {
      S.asked = typed.dishes.map(function (d) { return d.id; });
      S.askedLabel = typed.term;
      // asking for a dish again after turning it down counts as changing their mind
      S.offeredIds = S.offeredIds.filter(function (id) { return S.asked.indexOf(id) === -1; });
      S.rejectedIds = S.rejectedIds.filter(function (id) { return S.asked.indexOf(id) === -1; });
    } else if (namesDish) { S.asked = []; S.askedLabel = ""; }
    if (text && !opts.chip) S.lastRequest = text;

    // 3. Rules: what is allowed, and a ranked shortlist.
    const recentIds = Store.recentEaten().map(function (e) { return e.id; });
    const rank = { prefs: S.prefs, meals: meals, recentIds: recentIds };
    const askedDishes = S.asked.map(Dishes.byId).filter(Boolean);
    const askedOk = askedDishes.filter(function (d) { return !Rules.isBlocked(d, S.meaty); });
    const blocked = typed.dishes.length && !askedOk.length ? askedDishes[0] : null; // they asked for something the meaty rule blocks
    const narrowed = Rules.narrow(dishes, { meaty: S.meaty, offeredIds: S.offeredIds, prefs: S.prefs, asked: askedOk.map(function (d) { return d.id; }) });
    const pool = narrowed.pool;
    const prefsText = Rules.describePrefs(S.prefs);
    Debug.step("Rules", pool.length ? "ok" : "warn", narrowed.mode + ": " + pool.length + " of " + dishes.length + " dishes allowed" + (S.meaty ? " (meaty: no milky dishes)" : ""),
      { meaty: S.meaty, mode: narrowed.mode, ranking: Rules.explain(pool, rank).slice(0, 20), asked: askedDishes.map(function (d) { return d.name; }), askedLabel: S.askedLabel, blocked: blocked ? blocked.name : null });

    // Nothing more matches what they asked for: say so, don't offer something they ruled out.
    if (narrowed.mode === "exhausted") return finish(S, { action: "exhausted", timeLabel: timeLabel, prefsText: prefsText, askedLabel: S.askedLabel }, errors, linkUp);
    if (!pool.length) return finish(S, { action: "nothing", timeLabel: timeLabel }, errors, linkUp);

    const shortlist = Rules.shortlist(pool, rank, Config.MAX_CANDIDATES, opts.rng);

    // 4. Jev picks.
    let pick = null;
    if (shortlist.length === 1) pick = { id: shortlist[0].id, confidence: 1, others: [] };
    else if (linkUp) {
      try {
        pick = await Picker.pick(shortlist, {
          message: text || "Suggest something.", original: S.lastRequest, timeLabel: timeLabel, prefs: S.prefs, meals: meals,
          asked: narrowed.mode === "match" && askedOk.length ? shortlist.map(function (d) { return d.name; }) : [],
          recentlyEaten: recentIds.map(Dishes.nameOf), rejected: S.rejectedIds.map(Dishes.nameOf), offered: S.offeredIds.map(Dishes.nameOf)
        });
        Debug.step("Jev's pick", "ok", Dishes.nameOf(pick.id) + " at " + Math.round(pick.confidence * 100) + "% confidence", pick);
      } catch (e) { failed("Jev's pick", e); }
    }
    if (!pick) return { offline: true, decision: null, reply: null, errors: errors, usedHaiku: false };

    const dish = Dishes.byId(pick.id);
    S.offeredIds.push(dish.id);
    S.lastDish = dish;
    return finish(S, {
      action: "recommend", dish: dish, blocked: blocked, rejectedPrevious: rejectsLast, timeLabel: timeLabel,
      notOnList: namesDish && !typed.dishes.length, closest: narrowed.mode === "closest", prefsText: prefsText,
      confidence: pick.confidence, runnersUp: pick.others.map(Dishes.byId),
      offerList: S.rejectedIds.length >= Config.REJECTS_BEFORE_LIST
    }, errors, linkUp);
  }

  async function finish(S, decision, errors, linkUp) {
    let reply = null;
    if (linkUp) {
      try { reply = await Ai.chat(Wording.messages(decision, S.history), "Haiku: write the reply"); Debug.step("Haiku wrote the reply", "ok", reply); }
      catch (e) { errors.push(e); Debug.step("Haiku wrote the reply", "error", Ai.explain(e)); }
    }
    const usedHaiku = !!reply;
    if (!reply) { reply = Wording.template(decision); Debug.step("Template reply used", "warn", reply); }
    S.history.push({ role: "assistant", content: reply });
    return { decision: decision, reply: reply, errors: errors, usedHaiku: usedHaiku };
  }

  /* Shows a dish without asking Jev (e.g. after "I'm not meaty now" for a dish they named). */
  function offerDirect(S, dish, reply) {
    if (S.offeredIds.indexOf(dish.id) === -1) S.offeredIds.push(dish.id);
    S.lastDish = dish;
    S.history.push({ role: "assistant", content: reply });
  }

  return { newSession: newSession, run: run, offerDirect: offerDirect };
})();
