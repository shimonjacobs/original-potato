/* ===================================================================
 * OPENROUTER CLIENT + JEV DECISIONS
 * -------------------------------------------------------------------
 * Jev takes a "state" plus typed questions and returns typed answers
 * with probabilities (no text). We use it for:
 *   1. parseIntent - what does this message mean? (preferences, is it
 *      vague, is the user rejecting the last suggestion)
 *   2. pickDish    - which of the allowed dishes fits best right now
 * Every function rejects with an ApiError so callers can degrade to
 * the offline rules instead of leaving the user without a reply.
 * =================================================================== */
function ApiError(kind, message, status) {
  const e = new Error(message);
  e.name = "ApiError";
  e.kind = kind; // nokey | network | auth | credits | http
  e.status = status || null;
  return e;
}

function postJson(url, body, label) {
  const key = Store.getKey();
  const t0 = Date.now();
  const name = label || url;
  // A personal key goes straight to OpenRouter; otherwise use the proxy worker.
  let target = url;
  const headers = { "Content-Type": "application/json" };
  if (key) {
    headers["Authorization"] = "Bearer " + key;
  } else if (CONFIG.PROXY_URL) {
    target = CONFIG.PROXY_URL.replace(/\/+$/, "") + (url === CONFIG.JEV_URL ? "/decisions" : "/chat");
  } else {
    Trace.step("API call: " + name, "error", "No OpenRouter key set, request not sent.");
    return Promise.reject(ApiError("nokey", "No OpenRouter key set"));
  }
  return fetch(target, {
    method: "POST",
    headers: headers,
    body: JSON.stringify(body)
  }).then(function (res) {
    return res.text().then(function (raw) {
      let parsed = null;
      try { parsed = JSON.parse(raw); } catch (e) { /* not JSON */ }
      const ms = Date.now() - t0;
      if (res.ok && parsed !== null) {
        Trace.step("API call: " + name, "ok", "HTTP " + res.status + " in " + ms + " ms", { url: target, request: body, response: parsed });
        return parsed;
      }
      const kind = (res.status === 401 || res.status === 403) ? "auth" : res.status === 402 ? "credits" : "http";
      Trace.step("API call: " + name, "error", "HTTP " + res.status + " in " + ms + " ms" + (res.ok ? " (response was not JSON)" : ""), { url: target, request: body, responseText: String(raw).slice(0, 4000) });
      throw ApiError(res.ok ? "http" : kind, res.ok ? "Response was not JSON: " + String(raw).slice(0, 120) : "HTTP " + res.status + ": " + String(raw).slice(0, 200), res.status);
    });
  }, function (err) {
    Trace.step("API call: " + name, "error", "Network error after " + (Date.now() - t0) + " ms: " + (err && err.message), { url: target, request: body });
    throw ApiError("network", "Request blocked or offline (often a browser CORS restriction): " + (err && err.message));
  });
}

function callJev(state, questions, label) {
  return postJson(CONFIG.JEV_URL, { model: CONFIG.JEV_MODEL, state: state, questions: questions }, label || "Jev decisions")
    .then(function (data) {
      if (!data || !data.answers) throw ApiError("http", "Unexpected Jev response");
      return data.answers;
    });
}

/* ---- tiny question builders ---- */
function noulQ(instructions, yes, no) {
  return { type: "noul", instructions: instructions, criteria: { "true": yes, "false": no } };
}
function choiceQ(instructions, criteria) {
  return { type: "choice", instructions: instructions, criteria: criteria };
}
function yes(answers, name) {
  const a = answers && answers[name];
  return a && typeof a.noul === "number" ? a.noul : 0;
}
function choice(answers, name) {
  const a = answers && answers[name];
  return a && a.choice ? { value: a.choice, confidence: typeof a.confidence === "number" ? a.confidence : 0, probabilities: a.probabilities || {} } : null;
}

/* ===================================================================
 * 1. INTENT
 * =================================================================== */
function parseIntent(ctx) {
  const state = {
    current_time: ctx.timeLabel,
    user_message: ctx.message,
    last_suggested_dish: ctx.lastDishName || "none yet",
    previous_assistant_message: ctx.lastAssistantText || "none"
  };

  const none = "The user expressed no preference on this.";
  const dimChoice = function (what, values) {
    const crit = {};
    values.forEach(function (v) { crit[v] = "The user wants " + what + " to be " + v + "."; });
    crit.none = none;
    return choiceQ("Did the user say how " + what + " the food should be?", crit);
  };

  const questions = {
    vague: noulQ(
      "Is the user's message too vague to choose a dish, with no food preference at all (for example just 'I'm hungry')?",
      "No preference or mood about food is given.",
      "At least one food preference, mood, constraint or request is given."),
    rejects_last: noulQ(
      "Is the user rejecting or asking to move on from the last suggested dish?",
      "The user dislikes the last suggestion or asks for something else.",
      "The user accepts it, or has not seen a suggestion yet, or is saying something unrelated."),
    kosher: choiceQ("Did the user ask for a milky (dairy), meaty (meat) or pareve (neither dairy nor meat) meal?", {
      milky: "They want a dairy / milky meal.",
      meaty: "They want a meat / meaty meal.",
      pareve: "They want a pareve meal, neither dairy nor meat.",
      none: none
    }),
    weight: dimChoice("heavy or light", TAG_VOCAB.weight),
    temperature: dimChoice("hot or cold", TAG_VOCAB.temperature),
    quick: noulQ("Does the user want something fast to make?", "They want something quick.", "Speed is not mentioned."),
    healthy: noulQ("Does the user want something healthy?", "They want something healthy.", "Healthiness is not mentioned."),
    comfort: noulQ("Does the user want comfort food?", "They want something comforting.", "Comfort food is not mentioned."),
    fancy: noulQ("Does the user want something special or fancy?", "They want something special.", "Nothing special is asked for."),
    clarify_topic: choiceQ(
      "If the user's request were too vague, which single question would help narrow down a dish the most?",
      {
        kosher: "Ask whether they want something milky, meaty or pareve.",
        weight: "Ask whether they want something light or filling.",
        temperature: "Ask whether they want something hot or cold.",
        speed: "Ask whether they are in a hurry."
      })
  };

  return callJev(state, questions, "Jev: read the message").then(function (a) {
    const prefs = [];
    [["weight", "weight"], ["temperature", "temperature"]].forEach(function (pair) {
      const c = choice(a, pair[0]);
      if (c && c.value !== "none" && c.confidence >= 0.5) prefs.push({ dimension: pair[1], value: c.value });
    });
    ["quick", "healthy", "comfort", "fancy"].forEach(function (f) {
      if (yes(a, f) >= CONFIG.FLAG_THRESHOLD) prefs.push({ dimension: "occasion", value: f });
    });
    const k = choice(a, "kosher");
    const kosher = k && k.value !== "none" && TAG_VOCAB.kosher.indexOf(k.value) !== -1 && k.confidence >= CONFIG.KOSHER_CONFIDENCE ? k.value : null;
    const topic = choice(a, "clarify_topic");
    return {
      vague: yes(a, "vague"),
      rejectsLast: yes(a, "rejects_last") >= CONFIG.FLAG_THRESHOLD,
      prefs: prefs,
      kosher: kosher,
      clarifyTopic: topic && CLARIFY_TOPICS.indexOf(topic.value) !== -1 ? topic.value : "kosher"
    };
  });
}

/* ===================================================================
 * 2. PICK
 * =================================================================== */
function pickDish(candidates, ctx) {
  const criteria = {};
  candidates.forEach(function (d) {
    const t = d.tags;
    criteria[d.id] = d.name + ": " + d.description + " (" + t.kosher + ", " + t.weight + ", served " + t.temperature +
      ", about " + d.prepTimeMinutes + " min)" +
      (ctx.fitMeals && !fitsMeal(d, ctx.fitMeals) ? " [not usually eaten at this time of day]" : "");
  });

  const state = {
    current_time: ctx.timeLabel,
    user_message: ctx.message,
    stated_preferences: ctx.prefs.map(describePref),
    milky_meaty_or_pareve_requirement: kosherPhrase(ctx.kosher) + (ctx.skip ? ", but not " + ctx.skip + " dishes right now" : "") + (ctx.kosher && ctx.kosher !== "pareve" ? " (pareve dishes are equally acceptable)" : ""),
    recently_eaten: ctx.recentlyEaten,
    turned_down_this_chat: ctx.rejected,
    already_offered_this_chat: ctx.offered || []
  };
  const questions = {
    pick: choiceQ("Which dish best fits what this person wants to eat right now? Prefer dishes matching their stated preferences. Pareve dishes are as good as an exact milky or meaty match. Strongly prefer dishes that suit the current time of day, and choose one marked [not usually eaten at this time of day] only if nothing else fits what they want. Avoid recently eaten or rejected dishes.", criteria)
  };

  return callJev(state, questions, "Jev: pick a dish").then(function (a) {
    const c = choice(a, "pick");
    if (!c || !criteria[c.value]) throw ApiError("http", "Jev returned a dish that is not in the list");
    const others = Object.keys(c.probabilities)
      .filter(function (id) { return id !== c.value && criteria[id]; })
      .sort(function (x, y) { return c.probabilities[y] - c.probabilities[x]; })
      .filter(function (id) { return c.probabilities[id] > 0; })
      .slice(0, 2);
    return { id: c.value, confidence: c.confidence, others: others, fromJev: true };
  });
}
