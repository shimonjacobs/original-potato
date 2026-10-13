// Logic tests with a mocked OpenRouter. Run: node test/test.js
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const FILES = ["config.js", "store.js", "trace.js", "data.js", "engine.js", "dishes.js", "jev.js", "chat.js", "controller.js", "memory.js"];
const code = FILES.map(function (f) { return fs.readFileSync(path.join(__dirname, "..", "src", f), "utf8"); }).join("\n") +
  "\n;globalThis.__api = { storageDump: function () { return localStorage.getItem('fc_taste_v2'); }, kosherAllows, Trace, CONFIG, Store, DISHES, TAG_VOCAB, extractTags, selectPool, rankCandidates, mealTypesForHour, newSession, runTurn, testConnection, dishById, findNamedDishes, memoryChips, removeChip, validateDish, importDishesJson, exportDishesJson, bakeIntoSource, setLiveDishes, persistDishes, cleanList, builtinDishes, BAKED_DISHES: BAKED_DISHES };";

let passed = 0, failed = 0;
function ok(cond, msg) { if (cond) { passed++; console.log("  ok   " + msg); } else { failed++; console.log("  FAIL " + msg); } }

function makeEnv(fetchImpl, withKey, proxyOn) {
  const storage = {};
  const ctx = {
    console: console, Promise: Promise, JSON: JSON, Math: Math, Date: Date, Object: Object, Array: Array, String: String, Error: Error, Number: Number,
    localStorage: { getItem: function (k) { return k in storage ? storage[k] : null; }, setItem: function (k, v) { storage[k] = String(v); }, removeItem: function (k) { delete storage[k]; } },
    fetch: fetchImpl
  };
  ctx.globalThis = ctx;
  vm.createContext(ctx);
  vm.runInContext(code, ctx);
  if (!proxyOn) ctx.__api.CONFIG.PROXY_URL = "";
  if (withKey) ctx.__api.Store.setKey("test-key");
  return ctx.__api;
}

/* Mock OpenRouter. */
function mockFetch(behaviour, log) {
  behaviour = behaviour || {};
  const inner = async function (url, init) {
    const body = JSON.parse(init.body);
    log.push({ url: url, body: body, headers: init.headers });
    if (behaviour.networkFail) throw new TypeError("Failed to fetch");
    if (/\/(alpha\/)?decisions$/.test(url)) {
      const answers = {};
      const msg = String(body.state.user_message || "").toLowerCase();
      for (const name in body.questions) {
        const q = body.questions[name];
        if (q.type === "noul") {
          let p = 0.02;
          if (name === "vague") p = msg.indexOf("hungry") !== -1 && msg.length < 20 ? 0.95 : 0.05;
          if (name === "rejects_last") p = msg.indexOf("different") !== -1 || msg.indexOf("not this") !== -1 ? 0.95 : 0.02;
          if (name === "quick" && msg.indexOf("quick") !== -1) p = 0.9;
          if (name === "comfort" && msg.indexOf("nostalgic") !== -1) p = 0.9;
          answers[name] = { type: "noul", noul: p };
        } else if (q.type === "choice") {
          const keys = Object.keys(q.criteria);
          if (name === "pick") {
            let chosen = behaviour.pickId || keys[0];
            if (behaviour.pickBogus) chosen = "not-a-dish";
            const probs = {};
            keys.forEach(function (k) { probs[k] = 0; });
            probs[keys[0]] = 0.5; if (keys[1]) probs[keys[1]] = 0.3; if (keys[2]) probs[keys[2]] = 0.2;
            answers[name] = { type: "choice", choice: chosen, confidence: behaviour.pickConfidence != null ? behaviour.pickConfidence : 0.8, probabilities: probs };
          } else if (name === "kosher" && behaviour.jevKosher) {
            answers[name] = { type: "choice", choice: behaviour.jevKosher, confidence: 0.95, probabilities: {} };
          } else if (name === "clarify_topic") {
            answers[name] = { type: "choice", choice: "temperature", confidence: 0.6, probabilities: {} };
          } else {
            answers[name] = { type: "choice", choice: "none", confidence: 0.95, probabilities: {} };
          }
        }
      }
      return { ok: true, status: 200, json: async function () { return { id: "x", model: "typesafe/jev-1.13", answers: answers }; } };
    }
    if ((url.indexOf("/chat/completions") !== -1 || /workers\.dev\/chat$/.test(url))) {
      if (behaviour.chatFail) return { ok: false, status: 500, text: async function () { return "boom"; } };
      const parts = body.messages[body.messages.length - 1].content.split("do not mention it]\n");
      if (parts.length < 2) return { ok: true, status: 200, json: async function () { return { choices: [{ message: { content: "OK" } }] }; } };
      const dec = JSON.parse(parts[1]);
      const text = dec.action === "recommend" ? "How about " + dec.dish.name + "?" : dec.action === "clarify" ? "Quick question about " + dec.clarifyTopic + "?" : "Nothing fits.";
      return { ok: true, status: 200, json: async function () { return { choices: [{ message: { content: text } }] }; } };
    }
    throw new Error("unexpected url " + url);
  };
  // Behave like a real Response: text() as well as json().
  return async function (url, init) {
    const r = await inner(url, init);
    if (!r.text && r.json) { r.text = async function () { return JSON.stringify(await r.json()); }; }
    return r;
  };
}

function say(S, text) { S.history.push({ role: "user", content: text }); }
async function turn(api, S, text, opts) {
  if (!(opts && opts.action)) say(S, text); else say(S, text || "Not this one");
  const r = await runTurnFor(api, S, text, opts);
  S.history.push({ role: "assistant", content: r.reply });
  return r;
}
function runTurnFor(api, S, text, opts) { return api.runTurn(S, text, Object.assign({ rng: function () { return 0.5; } }, opts || {})); }

(async function main() {
  console.log("data");
  {
    const api = makeEnv(null, false);
    ok(api.DISHES.length > 0 && api.DISHES.every(function (d) { return ["milky", "meaty", "pareve"].indexOf(d.tags.kosher) !== -1; }), "every dish is milky, meaty or pareve");
    ok(api.DISHES.every(function (d) { return !("cuisine" in d.tags) && !("spiceLevel" in d.tags) && !("dietary" in d.tags); }), "no cuisine / spice / dietary tags left");
    ok(Object.keys(api.TAG_VOCAB).sort().join() === "kosher,mealType,occasion,temperature,weight", "vocabulary is meal type, kosher, weight, temperature, occasion");
    const ids = api.DISHES.map(function (d) { return d.id; });
    ok(ids.every(function (i) { return /^[a-z0-9-]+$/.test(i); }) && new Set(ids).size === ids.length, "ids are clean and unique");
  }

  console.log("keyword parsing");
  {
    const api = makeEnv(null, false);
    const t = api.extractTags("something meaty and quick");
    const has = function (d, v) { return t.some(function (x) { return x.dimension === d && x.value === v; }); };
    ok(has("kosher", "meaty") && has("occasion", "quick"), "finds meaty + quick");
    ok(api.extractTags("a dairy lunch").some(function (x) { return x.dimension === "kosher" && x.value === "milky"; }), "'dairy' -> milky");
    ok(api.extractTags("something parve please").some(function (x) { return x.value === "pareve"; }), "'parve' -> pareve");
    ok(api.extractTags("fleishig dinner").some(function (x) { return x.value === "meaty"; }), "'fleishig' -> meaty");
    ok(api.extractTags("a cup of tea").length === 0, "'cup of tea' is not a dinner request");
    ok(api.extractTags("something spicy").length === 0, "spice is no longer a thing");
  }

  console.log("rules: milky / meaty / pareve is a hard filter");
  {
    const api = makeEnv(null, false);
    const pool = function (kosher, hour) { return api.selectPool(api.DISHES, { hour: hour || 13, kosher: kosher, prefs: [], sessionIds: [], softAvoidIds: [] }).pool; };
    ok(pool("meaty").length > 0 && pool("meaty").every(function (d) { return d.tags.kosher !== "milky"; }), "meaty request never returns a milky dish");
    ok(pool("milky").length > 0 && pool("milky").every(function (d) { return d.tags.kosher !== "meaty"; }), "milky request never returns a meaty dish");
    ok(pool("pareve").length > 0 && pool("pareve").every(function (d) { return d.tags.kosher === "pareve"; }), "pareve request returns only pareve");
    ok(pool("meaty").some(function (d) { return d.tags.kosher === "pareve"; }), "pareve sides stay available for a meaty request");
    for (let h = 0; h < 24; h++) {
      ok(["milky", "meaty"].every(function (k) { const o = k === "milky" ? "meaty" : "milky"; return pool(k, h).every(function (d) { return d.tags.kosher !== o; }); }), "no mixing at " + h + ":00");
      if (!(h % 8 === 0)) continue;
    }
    const dessert = api.selectPool(api.DISHES, { hour: 8, kosher: null, prefs: [{ dimension: "mealType", value: "dessert" }], sessionIds: [], softAvoidIds: [] });
    ok(dessert.timeOverridden && dessert.pool.every(function (d) { return d.tags.mealType.indexOf("dessert") !== -1; }), "asking for dessert at 8am overrides the clock");
    const all = api.selectPool(api.DISHES, { hour: 8, kosher: null, prefs: [], sessionIds: [], softAvoidIds: [] });
    ok(all.pool.length === api.DISHES.length, "the clock no longer removes dishes from the pool");
    const top8 = api.rankCandidates(all.pool, [], 12, function () { return 0.5; }, all.fitMeals);
    ok(top8.length >= 4 && top8.every(function (d) { return d.tags.mealType.indexOf("breakfast") !== -1; }), "at 8am the top-ranked dishes are breakfast dishes");
    const dinnerFirst = api.selectPool(api.DISHES, { hour: 19, kosher: null, prefs: [], sessionIds: [], softAvoidIds: [] });
    const top19 = api.rankCandidates(dinnerFirst.pool, [], 12, function () { return 0.5; }, dinnerFirst.fitMeals);
    ok(top19.every(function (d) { return d.tags.mealType.indexOf("dinner") !== -1; }), "at 7pm the top-ranked dishes are dinner dishes");
    const prefRank = api.rankCandidates(dinnerFirst.pool, [{ dimension: "temperature", value: "cold" }], 12, function () { return 0.5; }, dinnerFirst.fitMeals);
    ok(prefRank[0].tags.temperature === "cold" && prefRank[0].tags.mealType.indexOf("dinner") === -1, "a stated preference can outweigh the time of day (cold at 7pm -> cereal)");
    const ranked = api.rankCandidates(pool("milky", 13), [{ dimension: "kosher", value: "milky" }], 12, function () { return 0.5; });
    ok(ranked[0].tags.kosher === "milky", "exact milky matches rank above pareve");
  }

  console.log("mealtime is a supporting factor, not a rule");
  {
    const api = makeEnv(mockFetch({}, []), false);
    const S = api.newSession();
    const seen = [];
    await turn(api, S, "what should I eat", { hour: 19 }); // offline bot asks one clarifier first
    let r = await turn(api, S, "go on then", { hour: 19 });
    seen.push(r.decision);
    for (let i = 0; i < 20; i++) {
      r = await turn(api, S, "", { hour: 19, action: "reject" });
      seen.push(r.decision);
    }
    const dinnerCount = api.DISHES.filter(function (d) { return d.tags.mealType.indexOf("dinner") !== -1; }).length;
    const firstOff = seen.findIndex(function (d) { return d.dish.tags.mealType.indexOf("dinner") === -1; });
    ok(firstOff === dinnerCount, "all " + dinnerCount + " dinner dishes are offered before any non-dinner dish (first off-time at #" + (firstOff + 1) + ")");
    ok(seen.slice(0, dinnerCount).every(function (d) { return !d.notes.outsideUsualTime; }), "dinner dishes carry no time warning");
    ok(seen[firstOff].notes.outsideUsualTime && /usually/.test(r.reply.length ? seen[firstOff].notes.usualMeals + " usually" : ""), "first off-time dish is flagged as outside the usual time");
    ok(seen.some(function (d) { return d.dish.id === "cereal"; }), "cereal does become an option once dinner dishes are used up");
    const ids = seen.map(function (d) { return d.dish.id; });
    ok(new Set(ids.slice(0, api.DISHES.length)).size === Math.min(ids.length, api.DISHES.length), "no dish repeats until everything has been offered");

    const S2 = api.newSession();
    const tmpl = await turn(api, S2, "something cold", { hour: 19 });
    ok(tmpl.decision.dish.tags.temperature === "cold", "'something cold' at dinnertime is not blocked by the clock");
    ok(tmpl.decision.notes.outsideUsualTime && /usually a/.test(tmpl.reply), "...and the reply says it's outside the usual time");
  }

  console.log("no key: fully offline");
  {
    const log = [];
    const api = makeEnv(mockFetch({}, log), false);
    const S = api.newSession();
    const r = await turn(api, S, "something meaty", { hour: 19 });
    ok(r.decision.action === "recommend" && r.decision.dish.tags.kosher !== "milky", "recommends a non-milky dish for 'meaty'");
    ok(log.length === 0, "makes no network calls");
    ok(!r.engine.jev && !r.engine.haiku, "reports offline engine");
    const r2 = await turn(api, S, "actually milky", { hour: 19 });
    ok(r2.decision.dish.tags.kosher !== "meaty", "switching to milky never returns meaty (newest request wins)");
  }

  console.log("key: vague message asks one clarifier, then recommends");
  {
    const log = [];
    const api = makeEnv(mockFetch({}, log), true);
    const S = api.newSession();
    const r1 = await turn(api, S, "I'm hungry", { hour: 13 });
    ok(r1.decision.action === "clarify" && r1.decision.clarifyTopic === "temperature", "first vague message -> clarify (Jev chose topic)");
    ok(r1.reply.indexOf("temperature") !== -1 && r1.engine.haiku, "Haiku worded the clarifier");
    const intentCall = log.filter(function (l) { return l.url.indexOf("decisions") !== -1; })[0];
    ok(intentCall.body.model === "typesafe/jev-1.13" && intentCall.headers.Authorization === "Bearer test-key", "Jev request uses right model + bearer auth");
    const qs = intentCall.body.questions;
    ok(Object.keys(qs).every(function (k) { const q = qs[k]; return (q.type === "noul" && q.criteria["true"] && q.criteria["false"]) || (q.type === "choice" && Object.keys(q.criteria).length >= 2); }), "all questions well-formed (noul true/false, choice criteria)");
    ok(!!qs.kosher && !qs.spice && !qs.cuisine && Object.keys(qs).every(function (k) { return k.indexOf("diet_") !== 0; }), "Jev asks about milky/meaty/pareve, not cuisine/spice/diet");
    const r2 = await turn(api, S, "something quick", { hour: 13 });
    ok(r2.decision.action === "recommend" && r2.engine.jev, "next turn recommends via Jev");
    ok(S.prefs.some(function (p) { return p.dimension === "occasion" && p.value === "quick"; }), "Jev-detected preference is remembered");
    const r3 = await turn(api, S, "I'm hungry", { hour: 13 });
    ok(r3.decision.action === "recommend", "does not ask a second clarifier");
  }

  console.log("key: Jev hears milky/meaty and pick is constrained");
  {
    const log = [];
    const api = makeEnv(mockFetch({ jevKosher: "meaty" }, log), true);
    const S = api.newSession();
    const r = await turn(api, S, "I fancy a proper dinner", { hour: 19 });
    ok(S.kosher === "meaty", "very-sure Jev kosher answer is applied");
    const pickCall = log.filter(function (l) { return l.body.questions && l.body.questions.pick; })[0];
    ok(Object.keys(pickCall.body.questions.pick.criteria).every(function (id) { return api.dishById(id).tags.kosher !== "milky"; }), "Jev is only offered non-milky dishes");
    ok(pickCall.body.state.milky_meaty_or_pareve_requirement .indexOf("meaty") === 0, "requirement is passed to Jev as state");
    const typed = await turn(api, S, "milky please", { hour: 19 });
    ok(S.kosher === "milky", "typed keyword overrides Jev");
  }

  console.log("key: safety holds even if Jev picks nonsense");
  {
    const log = [];
    const api = makeEnv(mockFetch({ pickBogus: true }, log), true);
    const S = api.newSession();
    const r = await turn(api, S, "something milky", { hour: 13 });
    ok(r.decision.action === "recommend" && r.decision.dish.tags.kosher !== "meaty", "bogus Jev pick falls back to a non-meaty dish");
    ok(r.errors.length > 0, "error surfaced for the UI");
    ok(r.decision.backups.every(function (d) { return d.tags.kosher !== "meaty"; }), "backups never meaty either");
  }

  console.log("rejection feedback");
  {
    const log = [];
    const api = makeEnv(mockFetch({}, log), true);
    const S = api.newSession();
    const r1 = await turn(api, S, "something quick", { hour: 18 });
    const first = r1.decision.dish.id;
    const r2 = await turn(api, S, "", { hour: 18, action: "reject" });
    ok(r2.decision.dish.id !== first, "'Not this one' gives a different dish");
    ok(r2.decision.notes.rejectedPrevious && api.Store.rejectedIds().indexOf(first) !== -1, "rejection recorded in memory");
    const jevCalls = log.filter(function (l) { return l.url.indexOf("decisions") !== -1 && l.body.questions.vague; });
    ok(jevCalls.length === 1, "reject button skips the intent call");
    const r3 = await turn(api, S, "show me something different", { hour: 18 });
    ok(r3.decision.notes.rejectedPrevious, "Jev detects a typed rejection too");
  }

  console.log("graceful degradation");
  {
    const log = [];
    let api = makeEnv(mockFetch({ networkFail: true }, log), true);
    let S = api.newSession();
    let r = await turn(api, S, "something quick", { hour: 18 });
    ok(r.decision.action === "recommend" && !r.engine.jev && !r.engine.haiku, "network failure -> offline rules + templates");
    ok(r.errors[0].kind === "network", "error classified as network/CORS");
    ok(log.length === 1, "stops hammering a dead link (1 attempt)");
    ok(r.reply.indexOf(r.decision.dish.name) !== -1, "template reply names the dish");

    api = makeEnv(mockFetch({ chatFail: true }, []), true);
    S = api.newSession();
    r = await turn(api, S, "something quick", { hour: 18 });
    ok(r.engine.jev && !r.engine.haiku && r.reply.indexOf(r.decision.dish.name) !== -1, "Haiku failure -> Jev decision + template wording");
  }

  console.log("asking for a dish by name");
  {
    const log = [];
    const api = makeEnv(mockFetch({}, log), true);
    const names = function (txt) { return api.findNamedDishes(txt, api.DISHES).map(function (d) { return d.id; }); };
    ok(names("cereal")[0] === "cereal", "'cereal' -> Cereal");
    ok(names("Cereal please")[0] === "cereal", "'Cereal please' -> Cereal");
    ok(names("pizza")[0] === "margherita-pizza", "single word 'pizza' -> Margherita Pizza");
    ok(api.DISHES.filter(function (d) { return d.id === names("toastie")[0]; }).map(function (d) { return d.name; })[0] === "Cheese Toastie", "'toastie' -> Cheese Toastie");
    ok(names("pancake")[0] === "pancakes", "singular 'pancake' -> Pancakes");
    ok(names("steak").join() === "steak", "'steak' -> Steak only, not Steak Burgers");
    ok(names("burgers")[0] === "steak-burgers", "'burgers' -> Steak Burgers");
    ok(names("chips").join() === "chips", "'chips' -> Chips only");
    ok(names("fish chips")[0] === "fish-and-chips" && names("fish and chips")[0] === "fish-and-chips", "'fish and chips' -> Fish and Chips");
    ok(names("potatoes").length === 3, "'potatoes' -> the three potato dishes");
    ok(names("I'm hungry").length === 0 && names("something quick and light").length === 0 && names("Comfort food please").length === 0, "ordinary requests match no dish");
    ok(names("something quick with chicken for dinner").length === 0, "a long sentence is not hijacked by a single word");
    ok(names("I'd like some scrambled eggs please")[0] === "scrambled-eggs", "full dish name inside a sentence still matches");

    const S = api.newSession();
    const r = await turn(api, S, "cereal", { hour: 13 });
    ok(r.decision.dish.id === "cereal" && r.decision.notes.namedByUser, "typing 'cereal' at lunchtime gives Cereal");
    ok(r.decision.notes.outsideUsualTime && /breakfast/.test(r.decision.notes.usualMeals), "...flagged as outside its usual time");
    ok(log.filter(function (l) { return l.url.indexOf("decisions") !== -1; }).length === 0, "...with no Jev call");
    ok(r.decision.confidence === null, "...and no fake confidence score");

    const noKey = makeEnv(mockFetch({}, []), false);
    const r2 = await turn(noKey, noKey.newSession(), "cereal", { hour: 13 });
    ok(r2.decision.dish.id === "cereal" && /breakfast/.test(r2.reply) && /you asked/.test(r2.reply), "offline template explains the time mismatch");
    const r3 = await turn(noKey, noKey.newSession(), "cereal", { hour: 8 });
    ok(!r3.decision.notes.outsideUsualTime && !/outside/.test(r3.reply), "no time warning when it fits");

    const c = await turn(noKey, noKey.newSession(), "meaty pizza", { hour: 19 });
    ok(!c.decision.notes.namedByUser && c.decision.dish.tags.kosher !== "milky", "'meaty pizza' does not return the milky pizza");
    const m = await turn(noKey, noKey.newSession(), "milky cereal", { hour: 8 });
    ok(m.decision.dish.id === "cereal", "'milky cereal' still gives Cereal (no conflict)");

    const S2 = noKey.newSession();
    await turn(noKey, S2, "something meaty", { hour: 19 });
    const mm = await turn(noKey, S2, "pizza", { hour: 19 });
    ok(mm.decision.dish.id === "margherita-pizza" && /you'd asked for meaty/.test(mm.reply), "naming a milky dish after asking meaty works but warns");
    const after = await turn(noKey, S2, "something quick", { hour: 19 });
    ok(after.decision.dish.tags.kosher !== "milky", "the earlier 'meaty' request still governs later suggestions");
  }

  console.log("memory chips");
  {
    const api = makeEnv(mockFetch({}, []), true);
    const labels = function (S, h) { return api.memoryChips(S, h === undefined ? 19 : h).map(function (c) { return c.label; }); };
    const S = api.newSession();
    ok(labels(S).join() === "It's dinnertime", "a fresh chat shows only the time-of-day chip");

    await turn(api, S, "something meaty and quick", { hour: 19 });
    let chips = api.memoryChips(S, 19);
    const byId = function (id) { return chips.filter(function (c) { return c.id === id; })[0]; };
    ok(byId("kosher") && byId("kosher").label === "Does not want milky" && byId("kosher").hard && byId("kosher").source === "typed", "typing 'meaty' makes a hard, typed chip");
    ok(byId("pref:occasion:quick") && byId("pref:occasion:quick").source === "typed", "'quick' makes a typed chip");
    ok(chips.some(function (c) { return c.id === "offered"; }), "dishes already offered are listed as one chip");

    const nost = await turn(api, api.newSession(), "feeling nostalgic", { hour: 19 });
    const S2 = api.newSession();
    await turn(api, S2, "feeling nostalgic", { hour: 19 });
    const comfort = api.memoryChips(S2, 19).filter(function (c) { return c.id === "pref:occasion:comfort"; })[0];
    ok(comfort && comfort.source === "jev", "something only Jev picked up is marked as Jev's reading");
    const S3 = api.newSession();
    await turn(api, S3, "cosy and nostalgic", { hour: 19 });
    ok(api.memoryChips(S3, 19).filter(function (c) { return c.id === "pref:occasion:comfort"; })[0].source === "typed", "if you also typed it, it counts as typed");

    // removing a chip really changes decisions
    api.removeChip(S, "kosher");
    ok(S.kosher === null && !api.memoryChips(S, 19).some(function (c) { return c.id === "kosher"; }), "removing the meaty chip clears the rule");
    const open = api.selectPool(api.DISHES, { hour: 19, kosher: S.kosher, prefs: S.prefs, sessionIds: [], softAvoidIds: [] }).pool;
    ok(open.some(function (d) { return d.tags.kosher === "milky"; }), "...so milky dishes are eligible again");
    api.removeChip(S, "pref:occasion:quick");
    ok(S.prefs.length === 0, "removing a preference chip drops the preference");

    // rejections are remembered, visible, and forgettable
    const R = api.newSession();
    await turn(api, R, "go on", { hour: 19 }); // offline-style first turn may clarify
    const first = (await turn(api, R, "something quick", { hour: 19 })).decision.dish;
    await turn(api, R, "", { hour: 19, action: "reject" });
    const rej = api.memoryChips(R, 19).filter(function (c) { return c.id === "rej:" + first.id; })[0];
    ok(rej && /Turned down/.test(rej.label) && rej.group === "chat", "a rejected dish appears under This chat");
    const fresh = api.newSession();
    api.Store.clearRejected(); // what "Start over" does
    ok(!api.memoryChips(fresh, 19).some(function (c) { return c.id === "rej:" + first.id; }), "...and is forgotten when the chat starts over");
    ok(!api.memoryChips(fresh, 19).some(function (c) { return c.group === "chat"; }), "...so chat chips start empty");
    api.removeChip(R, "rej:" + first.id);
    ok(!(first.id in api.Store.rejectedCounts()) && R.suggestedIds.indexOf(first.id) === -1, "removing it forgets the dislike and allows the dish again");

    // twice rejected = avoiding
    api.Store.recordReject("toast"); api.Store.recordReject("toast");
    ok(api.memoryChips(fresh, 19).some(function (c) { return /Toast ×2 \(avoiding\)/.test(c.label); }), "rejected twice shows as 'avoiding'");
    ok(api.Store.avoidIds().indexOf("toast") !== -1, "...and is really avoided");
    api.removeChip(fresh, "rej:toast");
    ok(api.Store.avoidIds().indexOf("toast") === -1, "removing the chip really stops avoiding it");

    // eaten
    api.Store.recordEaten("steak");
    const ate = api.memoryChips(fresh, 19).filter(function (c) { return c.id === "ate:steak"; })[0];
    ok(ate && /Ate Steak just now/.test(ate.label), "'I'll have this' shows as Ate ... just now");
    api.removeChip(fresh, "ate:steak");
    ok(api.Store.recentEaten().length === 0, "removing it forgets that meal");

    // time of day chip toggles the weighting off
    const T = api.newSession();
    api.removeChip(T, "time");
    ok(T.ignoreTime && api.memoryChips(T, 19)[0].restore, "removing the time chip switches to 'Time of day ignored' (restorable)");
    const noTime = api.selectPool(api.DISHES, { hour: 19, ignoreTime: true, kosher: null, prefs: [], sessionIds: [], softAvoidIds: [] });
    ok(noTime.fitMeals.length === 0, "no time-of-day boost when ignored");
    await turn(api, T, "go on", { hour: 19 });
    const rIgnored = await turn(api, T, "something light", { hour: 19 });
    ok(!/Since it's/.test(rIgnored.reply) && !rIgnored.decision.notes.outsideUsualTime, "replies stop mentioning the time when it is ignored");
    api.removeChip(T, "time");
    ok(!T.ignoreTime, "clicking it again restores time of day");

    // refresh action: re-suggest without recording a rejection
    const F = api.newSession();
    await turn(api, F, "something quick", { hour: 19 });
    const rejBefore = Object.keys(api.Store.rejectedCounts()).length;
    const rf = await api.runTurn(F, "", { hour: 19, action: "refresh", rng: function () { return 0.5; } });
    ok(rf.decision.action === "recommend" && Object.keys(api.Store.rejectedCounts()).length === rejBefore, "'Update suggestion' re-suggests without counting as a rejection");
  }

  console.log("photos never reach the models");
  {
    const log = [];
    const api = makeEnv(mockFetch({}, log), true);
    const PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
    api.DISHES.forEach(function (d) { d.image = PNG; });
    const S = api.newSession();
    await turn(api, S, "something quick", { hour: 18 });
    ok(log.length > 0 && log.every(function (l) { return JSON.stringify(l.body).indexOf("data:image") === -1; }), "no image data is sent to Jev or Haiku");
  }

  console.log("low confidence is flagged; connection test");
  {
    const api = makeEnv(mockFetch({ pickConfidence: 0.2 }, []), true);
    const S = api.newSession();
    const r = await turn(api, S, "something quick", { hour: 18 });
    ok(r.decision.notes.lowConfidence === true, "low Jev confidence flagged to the writer");
    const res = await api.testConnection();
    ok(res.length === 2 && res.every(function (x) { return x.ok; }), "testConnection reports both services OK");
    const bad = makeEnv(mockFetch({ networkFail: true }, []), true);
    const res2 = await bad.testConnection();
    ok(res2.every(function (x) { return !x.ok && x.detail.indexOf("CORS") !== -1; }), "testConnection explains CORS failures");
  }

  console.log("editable dishes");
  {
    const log = [];
    const api = makeEnv(mockFetch({}, log), false);
    const good = { name: "Lasagne", description: "Layers of pasta, beef and sauce.", prepTimeMinutes: 60, tags: { mealType: ["dinner"], kosher: "meaty", weight: "heavy", temperature: "hot", occasion: ["comfort"] } };
    ok(api.validateDish(good).ok, "valid dish accepted");
    ok(!api.validateDish({ name: "", tags: {}, prepTimeMinutes: 0 }).ok, "empty dish rejected");
    ok(!api.validateDish(Object.assign({}, good, { tags: Object.assign({}, good.tags, { kosher: "" }) })).ok, "a dish must be milky, meaty or pareve");
    ok(!api.validateDish(Object.assign({}, good, { tags: Object.assign({}, good.tags, { kosher: "vegan" }) })).ok, "old dietary values are not accepted as kosher");
    ok(!api.validateDish(Object.assign({}, good, { prepTimeMinutes: 9999 })).ok, "absurd prep time rejected");

    const before = api.DISHES.length;
    const r = api.importDishesJson(JSON.stringify({ dishes: [good, { name: "bad" }] }));
    ok(r.ok && api.DISHES.length === before + 1 && /1 skipped/.test(r.message), "import adds valid dishes, skips invalid");
    const legacy = api.importDishesJson(JSON.stringify([{ name: "Old", description: "", prepTimeMinutes: 5, tags: { mealType: ["lunch"], dietary: ["vegan"], weight: "light", temperature: "cold", cuisine: "x", spiceLevel: "mild", occasion: [] } }]));
    ok(!legacy.ok && api.DISHES.length === before + 1, "an old-format file (no milky/meaty/pareve) is refused");
    const again = api.importDishesJson(api.exportDishesJson());
    ok(again.ok && api.DISHES.length === before + 1, "re-importing an export replaces rather than duplicates");
    ok(!api.importDishesJson("not json").ok, "garbage import is refused");

    const sel = api.selectPool(api.DISHES, { hour: 18, kosher: "meaty", prefs: [], sessionIds: [], softAvoidIds: [] });
    ok(sel.pool.some(function (d) { return d.name === "Lasagne"; }), "a new meaty dish is immediately in the meaty pool");
    const sel2 = api.selectPool(api.DISHES, { hour: 18, kosher: "milky", prefs: [], sessionIds: [], softAvoidIds: [] });
    ok(!sel2.pool.some(function (d) { return d.name === "Lasagne"; }), "...and never in the milky pool");

    api.persistDishes();
    const stored = api.Store.getDishes();
    ok(Array.isArray(stored) && stored.length === before + 1, "edits persist to storage");

    const PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
    const withImg = Object.assign({}, good, { image: PNG });
    ok(api.validateDish(withImg).ok && api.validateDish(withImg).dish.image === PNG, "a small base64 photo is accepted");
    ok(!api.validateDish(Object.assign({}, good, { image: "https://evil.example/x.png" })).ok, "web-address images are refused");
    ok(!api.validateDish(Object.assign({}, good, { image: 'data:image/png;base64,AAAA" onerror="x' })).ok, "attribute-injection attempt refused");
    ok(!api.validateDish(Object.assign({}, good, { image: "data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=" })).ok, "svg images are refused");
    ok(!api.validateDish(Object.assign({}, good, { image: "data:image/png;base64," + "A".repeat(250000) })).ok, "oversized photo refused");
    ok(api.validateDish(good).dish.image === "", "photo is optional");
    const rt = api.importDishesJson(JSON.stringify([Object.assign({}, withImg, { name: "Photo Dish" })]));
    ok(rt.ok && api.DISHES.filter(function (d) { return d.name === "Photo Dish"; })[0].image === PNG, "photo survives export/import");
    ok(api.bakeIntoSource("const BAKED_DISHES = null; /*BAKED_MARKER*/", api.DISHES).indexOf("data:image/png;base64") !== -1, "photos are baked into the app copy");

    const src = "const BAKED_DISHES = null; /*BAKED_MARKER*/\nfunction x(){ return 'const BAKED_DISHES = ' }";
    const baked = api.bakeIntoSource(src, [{ name: "</script><b>" }]);
    ok(baked.indexOf("</script>") === -1 && baked.indexOf("BAKED_DISHES = [") !== -1 && baked.indexOf("/*BAKED_MARKER*/") !== -1, "baking is injection-safe and keeps the marker");
    const twice = api.bakeIntoSource(baked, [{ name: "two" }]);
    ok(twice.indexOf('"two"') !== -1 && twice.indexOf("script") === -1, "re-baking replaces the previous list");
  }

  console.log("debug mode");
  {
    // off by default: nothing recorded
    let log = [];
    let api = makeEnv(mockFetch({}, log), true);
    await turn(api, api.newSession(), "something quick");
    ok(api.Trace.turns().length === 0, "nothing is recorded while Debug is off");

    // on: steps recorded, key never stored
    log = [];
    api = makeEnv(mockFetch({}, log), true);
    api.Trace.setOn(true);
    const r = await turn(api, api.newSession(), "something quick and milky");
    const t = api.Trace.turns()[0];
    ok(t && r.traceId === t.id, "turn returns its trace id");
    const titles = t.steps.map(function (x) { return x.title; }).join(" | ");
    ok(/Jev's reading/.test(titles) && /Rules: which dishes/.test(titles) && /Ranking/.test(titles) && /Jev's pick/.test(titles) && /Haiku wrote/.test(titles), "trace covers reading, rules, ranking, pick, wording");
    ok(t.steps.some(function (x) { return /API call/.test(x.title) && x.data && x.data.request && x.data.response; }), "raw request and response are kept");
    ok(api.Trace.exportJson().indexOf("test-key") === -1, "API key never appears in the trace");

    // empty chat reply: a useful error and a trace of the raw response
    const empty = async function (url, init) {
      const body = JSON.parse(init.body);
      if (url.indexOf("/chat/completions") !== -1) {
        const resp = { choices: [{ message: { content: "" }, finish_reason: "length" }], model: "anthropic/claude-haiku-x" };
        return { ok: true, status: 200, json: async function () { return resp; }, text: async function () { return JSON.stringify(resp); } };
      }
      return mockFetch({}, [])(url, init);
    };
    api = makeEnv(empty, true);
    api.Trace.setOn(true);
    const r2 = await turn(api, api.newSession(), "something quick");
    ok(r2.errors.some(function (e) { return /Empty reply from chat model.*finish_reason: length/.test(e.message); }), "empty reply error names finish_reason");
    ok(r2.reply && r2.reply.length > 0, "template wording still gives a reply");
    ok(api.Trace.turns()[0].steps.filter(function (x) { return /API call: /.test(x.title) && /chat|Haiku/i.test(x.title); }).length >= 2, "both chat attempts (retry) are traced");
  }

  console.log("negation and pareve ranking");
  {
    let log = [];
    let api = makeEnv(mockFetch({}, log), true);
    const k = function (t) { return api.extractTags(t).filter(function (x) { return x.dimension === "kosher"; }).map(function (x) { return x.value; }).join(); };
    ok(k("im meaty") === "meaty", "'im meaty' is meaty");
    ok(k("i dont want meaty") === "not-meaty", "'i dont want meaty' is not-meaty");
    ok(k("no dairy please") === "not-milky", "'no dairy' is not-milky");
    ok(k("i don\u2019t want meaty") === "not-meaty", "curly apostrophe works");
    ok(k("anything but meat") === "not-meaty", "'anything but meat' is not-meaty");
    ok(k("i'm not hungry, something meaty") === "meaty", "an unrelated 'not' does not negate");
    ok(api.kosherAllows("milky", "not-meaty") && api.kosherAllows("pareve", "not-meaty") && !api.kosherAllows("meaty", "not-meaty"), "not-meaty allows milky and pareve only");

    // the exact scenario: "im meaty" then "i dont want meaty" = still meaty (never milky), but skip meaty dishes now
    const S = api.newSession();
    await turn(api, S, "im meaty", { hour: 13 });
    ok(S.kosher === "meaty", "first turn: meaty");
    const r2 = await turn(api, S, "i dont want meaty", { hour: 13 });
    ok(S.kosher === "meaty" && S.skipKind === "meaty", "second turn: still meaty, skipping meaty dishes");
    ok(r2.decision.dish && r2.decision.dish.tags.kosher === "pareve", "second turn: suggestion is pareve (" + (r2.decision.dish && r2.decision.dish.name) + ")");
    ok(r2.decision.backups.every(function (d) { return d.tags.kosher === "pareve"; }), "backups are pareve too");
    ok(!r2.decision.dish || r2.decision.dish.tags.kosher !== "milky", "never milky for a meaty person");
    const chips2 = api.memoryChips(S, 13);
    ok(chips2.some(function (c) { return c.id === "skip" && /Does not want meaty right now/.test(c.label); }) && chips2.some(function (c) { return c.id === "kosher" && /Does not want milky/.test(c.label); }), "chips: Does not want milky + Does not want meaty right now");
    api.removeChip(S, "skip");
    ok(S.skipKind === null && S.kosher === "meaty", "removing the skip chip allows meaty dishes again");
    // saying it as the very first thing: no identity yet, so it is a plain exclusion
    const S3 = api.newSession();
    await turn(api, S3, "i dont want meaty", { hour: 13 });
    ok(S3.kosher === "not-meaty" && !S3.skipKind, "no prior requirement: plain 'not meaty'");
    // a milky person saying "no dairy"
    const S4 = api.newSession();
    await turn(api, S4, "im milky", { hour: 13 });
    await turn(api, S4, "no dairy", { hour: 13 });
    ok(S4.kosher === "milky" && S4.skipKind === "milky", "milky person: 'no dairy' skips milky, stays milky");
    await turn(api, S4, "actually im meaty", { hour: 13 });
    ok(S4.kosher === "meaty" && S4.skipKind === null, "a new positive request clears the skip");

    // phrasing the offline reader can't parse: Jev's sure reading wins
    api = makeEnv(mockFetch({ jevKosher: "pareve" }, log = []), true);
    const S2 = api.newSession();
    await turn(api, S2, "im meaty", { hour: 13 });
    await turn(api, S2, "meaty is not what I want", { hour: 13 });
    ok(S2.kosher === "pareve" && S2.kosherSrc === "jev", "unparsed negation: Jev's sure reading beats the plain keyword");

    // meaty request: pareve dishes are as good as meaty ones in the shortlist
    const sel = api.selectPool(api.DISHES, { hour: 13, kosher: "meaty", prefs: [], sessionIds: [], softAvoidIds: [] });
    const ranked = api.rankCandidates(sel.pool, [{ dimension: "kosher", value: "meaty" }], 12, function () { return 0.5; }, sel.fitMeals);
    ok(ranked.some(function (d) { return d.tags.kosher === "pareve"; }), "meaty request: pareve dishes reach the shortlist");
    const f = ranked.filter(function (d) { return d.tags.kosher === "pareve" && sel.fitMeals.some(function (m) { return d.tags.mealType.indexOf(m) !== -1; }); });
    const m = ranked.filter(function (d) { return d.tags.kosher === "meaty" && sel.fitMeals.some(function (x) { return d.tags.mealType.indexOf(x) !== -1; }); });
    ok(f.length > 0 && m.length > 0, "pareve and meaty dishes that suit the meal are both there");
  }

  console.log("turned-down dishes are session only");
  {
    const api = makeEnv(mockFetch({}, []), true);
    api.Store.recordReject("toast");
    api.Store.recordEaten("cereal");
    ok(api.storageDump().indexOf("toast") === -1 && api.storageDump().indexOf("rejected") === -1, "rejections are never written to storage");
    ok(api.storageDump().indexOf("cereal") !== -1, "meals eaten are still remembered");
    api.Store.clearRejected();
    ok(api.Store.rejectedIds().length === 0 && api.Store.recentlyEatenIds().length === 1, "starting over clears rejections but keeps what you ate");
  }

  console.log("offered-dishes chip keeps counting through rejections");
  {
    const api = makeEnv(mockFetch({}, []), true);
    const S = api.newSession();
    await turn(api, S, "something quick", { hour: 13 });
    const counts = [];
    for (let i = 0; i < 3; i++) {
      await turn(api, S, "", { hour: 13, action: "reject" });
      const c = api.memoryChips(S, 13).filter(function (x) { return x.id === "offered"; })[0];
      counts.push(c ? Number(/(\d+) dish/.exec(c.label)[1]) : 0);
    }
    ok(counts.join() === "2,3,4", "count grows 2,3,4 as each suggestion is turned down (got " + counts.join() + ")");
    const sent = [];
    ok(S.suggestedIds.length === 4 && api.memoryChips(S, 13).filter(function (x) { return /^rej:/.test(x.id); }).length === 3, "three turned-down chips as well");
  }

  console.log("\nProxy worker");
  {
    const log = [];
    const api = makeEnv(mockFetch({}, log), false, true);
    ok(api.Store.hasAi() && !api.Store.getKey(), "with the proxy set, AI is available without a key");
    const S = api.newSession();
    const res = await api.runTurn(S, "something quick", { hour: 13 });
    const urls = log.map(function (c) { return c.url; });
    ok(urls.length > 0 && urls.every(function (u) { return u.indexOf("https://my-proxy.shimon-jacobs-apps.workers.dev/") === 0; }), "all calls go to the worker");
    ok(urls.some(function (u) { return /\/decisions$/.test(u); }) && urls.some(function (u) { return /\/chat$/.test(u); }), "Jev goes to /decisions, Haiku to /chat");
    ok(log.every(function (c) { return !c.headers.Authorization; }), "no Authorization header is sent to the worker");
    const log2 = [];
    const api2 = makeEnv(mockFetch({}, log2), true, true);
    await api2.runTurn(api2.newSession(), "something quick", { hour: 13 });
    ok(log2.length > 0 && log2.every(function (c) { return c.url.indexOf("openrouter.ai") !== -1 && c.headers.Authorization === "Bearer test-key"; }), "a personal key overrides the worker and goes direct");
  }

  console.log("\n" + passed + " passed, " + failed + " failed");
  process.exit(failed ? 1 : 0);
})().catch(function (e) { console.error(e); process.exit(1); });
