/* The two things Jev is asked. Jev returns typed answers with probabilities,
 * never text, and can only choose among the dishes it is shown.
 *   readText: what does the typed message mean? (preferences, "not this one", did they name a dish)
 *   pick:     which shortlisted dish fits best right now? */
const Picker = (function () {
  const NONE = "The user expressed no preference on this.";

  function dimChoice(what, values) {
    const criteria = {};
    values.forEach(function (v) { criteria[v] = "The user wants " + what + " to be " + v + "."; });
    criteria.none = NONE;
    return Ai.choiceQ("Did the user say how " + what + " the food should be?", criteria);
  }

  function readText(ctx) {
    const state = {
      current_time: ctx.timeLabel || "unknown",
      user_message: ctx.message,
      last_suggested_dish: ctx.lastDishName || "none yet"
    };
    const questions = {
      rejects_last: Ai.noulQ("Is the user rejecting or asking to move on from the last suggested dish?",
        "The user dislikes the last suggestion or asks for something else.",
        "The user accepts it, or has not seen a suggestion yet, or is saying something unrelated."),
      kind: Ai.choiceQ("Did the user say they want a milky (dairy), meaty, or pareve (neither dairy nor meat) dish, or say they do not want meat?", {
        milky: "They want a dairy / milky dish.",
        meaty: "They want a meat dish.",
        pareve: "They want a pareve dish, neither dairy nor meat.",
        "not-meaty": "They do not want meat.",
        none: NONE
      }),
      weight: dimChoice("heavy or light", Dishes.VOCAB.weight),
      temperature: dimChoice("hot or cold", Dishes.VOCAB.temperature),
      names_dish: Ai.noulQ("Does the user ask for one specific dish or food by name (for example 'sushi' or 'pizza'), as opposed to describing what they fancy (for example 'something cold')?",
        "They name a specific dish or food.", "They do not name a specific dish or food."),
      quick: Ai.noulQ("Does the user want something fast to make?", "They want something quick.", "Speed is not mentioned."),
      healthy: Ai.noulQ("Does the user want something healthy?", "They want something healthy.", "Healthiness is not mentioned."),
      comfort: Ai.noulQ("Does the user want comfort food?", "They want something comforting.", "Comfort food is not mentioned."),
      fancy: Ai.noulQ("Does the user want something special or fancy?", "They want something special.", "Nothing special is asked for.")
    };
    return Ai.jev(state, questions, "Jev: read the message").then(function (a) {
      const prefs = [];
      ["weight", "temperature", "kind"].forEach(function (name) {
        const c = Ai.choice(a, name);
        if (c && c.value !== "none" && c.confidence >= 0.5) prefs.push({ dimension: name === "kind" ? "kosher" : name, value: c.value, src: "jev" });
      });
      ["quick", "healthy", "comfort", "fancy"].forEach(function (f) {
        if (Ai.yes(a, f) >= Config.FLAG_THRESHOLD) prefs.push({ dimension: "occasion", value: f, src: "jev" });
      });
      return { rejectsLast: Ai.yes(a, "rejects_last") >= Config.FLAG_THRESHOLD, namesDish: Ai.yes(a, "names_dish") >= Config.FLAG_THRESHOLD, prefs: prefs };
    });
  }

  /* candidates: the shortlist. ctx: { message, original, timeLabel, prefs, meals, recentlyEaten, rejected, offered, asked } (dish names, not ids) */
  function pick(candidates, ctx) {
    const criteria = {};
    candidates.forEach(function (d) {
      const t = d.tags;
      criteria[d.id] = d.name + ": " + d.description + " (" + t.kosher + ", " + t.weight + ", served " + t.temperature + ", about " + d.prepTimeMinutes + " min" +
        (t.ingredient && t.ingredient.length ? ", contains " + t.ingredient.join(" and ") : "") + ")" +
        (ctx.meals.length && !Rules.fitsMeal(d, ctx.meals) ? " [not usually eaten at this time of day]" : "") +
        (ctx.asked.indexOf(d.name) !== -1 ? " [matches what the user asked for]" : "");
    });
    const state = {
      current_time: ctx.timeLabel || "any time of day",
      user_message: ctx.message,
      original_request: ctx.original || "none",
      stated_preferences: ctx.prefs.map(function (p) { return p.dimension + ": " + p.value; }),
      recently_eaten: ctx.recentlyEaten,
      turned_down_this_chat: ctx.rejected,
      already_offered_this_chat: ctx.offered
    };
    const questions = {
      pick: Ai.choiceQ("Which dish best fits what this person wants to eat right now? original_request is what the user first asked for, and still applies if user_message is generic. If a dish is marked [matches what the user asked for], choose one of those. Otherwise prefer dishes matching their stated preferences and the time of day; choose one marked [not usually eaten at this time of day] only if nothing else fits. Dishes eaten recently are fine, just slightly less preferred than an equally good alternative.", criteria)
    };
    return Ai.jev(state, questions, "Jev: pick a dish").then(function (a) {
      const c = Ai.choice(a, "pick");
      if (!c || !criteria[c.value]) throw Ai.ApiError("http", "Jev returned a dish that is not in the list");
      const others = Object.keys(c.probabilities).filter(function (id) { return id !== c.value && criteria[id] && c.probabilities[id] > 0; })
        .sort(function (x, y) { return c.probabilities[y] - c.probabilities[x]; }).slice(0, 2);
      return { id: c.value, confidence: c.confidence, others: others };
    });
  }

  return { readText: readText, pick: pick };
})();
