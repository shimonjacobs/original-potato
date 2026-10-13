/* Logic tests. No DOM, no network: the real source files are loaded into a
 * sandbox with a fake localStorage and a fake OpenRouter.
 *   node test/test.js */
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const { LOGIC_FILES, SRC } = require("../build.js");

let passed = 0, failed = 0;
function test(name, fn) {
  return Promise.resolve().then(fn).then(function () { passed++; console.log("  ok   " + name); },
    function (e) { failed++; console.log("  FAIL " + name + "\n       " + (e && e.message)); });
}
function eq(actual, expected, what) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error((what || "value") + ": expected " + JSON.stringify(expected) + ", got " + JSON.stringify(actual));
}
function ok(cond, what) { if (!cond) throw new Error(what || "expected true"); }

/* ---- a fresh app per test: new storage, new fake network ---- */
function loadApp(fakeNet) {
  const store = {};
  const sandbox = {
    console: console, JSON: JSON, Date: Date, Math: Math, Promise: Promise,
    localStorage: { getItem: function (k) { return k in store ? store[k] : null; }, setItem: function (k, v) { store[k] = String(v); }, removeItem: function (k) { delete store[k]; } },
    fetch: fakeNet.fetch
  };
  vm.createContext(sandbox);
  const code = LOGIC_FILES.map(function (f) { return fs.readFileSync(path.join(SRC, f), "utf8"); }).join("\n") +
    "\n({ Config, Store, Debug, Dishes, Rules, Ai, Picker, Wording, Turn, Chips })";
  const app = vm.runInContext(code, sandbox);
  app.Dishes.load();
  return app;
}

/* A fake proxy. Jev "pick" answers with whatever `choose(candidateIds)` returns; Haiku answers with `haiku`. */
function fakeNet(o) {
  o = o || {};
  const net = { calls: [], pickRequests: [] };
  net.fetch = function (url, init) {
    const body = JSON.parse(init.body);
    net.calls.push({ url: url, body: body });
    const reply = function (status, data) { return Promise.resolve({ ok: status === 200, status: status, text: function () { return Promise.resolve(typeof data === "string" ? data : JSON.stringify(data)); } }); };
    if (/\/decisions$/.test(url)) {
      if (o.jevFails) return Promise.reject(new Error("blocked"));
      if (body.questions.pick) {
        net.pickRequests.push(body);
        const ids = Object.keys(body.questions.pick.criteria);
        const id = o.choose ? o.choose(ids, body) : ids[0];
        const probs = {}; ids.forEach(function (x) { probs[x] = x === id ? 0.8 : 0.2 / ids.length; });
        return reply(200, { answers: { pick: { choice: id, confidence: 0.8, probabilities: probs } } });
      }
      return reply(200, { answers: o.reading || { rejects_last: { noul: 0 }, kind: { choice: "none", confidence: 1 }, weight: { choice: "none", confidence: 1 }, temperature: { choice: "none", confidence: 1 } } });
    }
    if (o.haikuFails) return reply(500, "boom");
    return reply(200, { choices: [{ message: { content: o.haiku || "How about this one?" }, finish_reason: "stop" }] });
  };
  return net;
}

const D = function (kosher, meals, extra) { return Object.assign({ id: kosher + meals.join(""), name: kosher + " dish", description: "x", prepTimeMinutes: 5, tags: { mealType: meals, kosher: kosher, weight: "light", temperature: "hot", occasion: [] } }, extra || {}); };

async function main() {
  const A = loadApp(fakeNet());
  const R = A.Rules, S = A.Store;

  console.log("rules");
  await test("meals suit the time of day", function () {
    eq(R.mealsForHour(8), ["breakfast"]); eq(R.mealsForHour(13), ["lunch"]); eq(R.mealsForHour(19), ["dinner"]); eq(R.mealsForHour(23), ["snack", "dessert"]); eq(R.mealsForHour(3), ["snack", "dessert"]);
  });
  await test("meaty blocks milky dishes only", function () {
    eq(R.isBlocked(D("milky", ["lunch"]), true), true);
    eq(R.isBlocked(D("pareve", ["lunch"]), true), false);
    eq(R.isBlocked(D("meaty", ["lunch"]), true), false);
    eq(R.isBlocked(D("milky", ["lunch"]), false), false);
  });
  await test("pool: meaty leaves no milky dish, whatever was offered", function () {
    const all = A.Dishes.all();
    const pool = R.pool(all, { meaty: true, offeredIds: [] });
    ok(pool.length > 0 && pool.every(function (d) { return d.tags.kosher !== "milky"; }), "a milky dish got through");
  });
  await test("pool: dishes already offered are skipped, then start over when all used", function () {
    const dishes = [D("pareve", ["lunch"], { id: "a" }), D("pareve", ["lunch"], { id: "b" })];
    eq(R.pool(dishes, { meaty: false, offeredIds: ["a"] }).map(function (d) { return d.id; }), ["b"]);
    eq(R.pool(dishes, { meaty: false, offeredIds: ["a", "b"] }).length, 2, "recycled pool");
  });
  await test("score: preference +1, time fit +0.75, recent meal -0.5", function () {
    const d = D("pareve", ["lunch"], { id: "x" });
    const base = { prefs: [], meals: [], recentIds: [] };
    eq(R.score(d, base), 0);
    eq(R.score(d, Object.assign({}, base, { prefs: [{ dimension: "weight", value: "light" }] })), 1);
    eq(R.score(d, Object.assign({}, base, { meals: ["lunch"] })), 0.75);
    eq(R.score(d, Object.assign({}, base, { recentIds: ["x"] })), -0.5);
  });
  await test("a recent meal ranks lower but stays on the shortlist", function () {
    const dishes = ["a", "b", "c", "d", "e"].map(function (id) { return D("pareve", ["lunch"], { id: id }); });
    const sl = R.shortlist(dishes, { prefs: [], meals: ["lunch"], recentIds: ["a"] }, 12, function () { return 0.5; });
    ok(sl.length === 5 && sl[sl.length - 1].id === "a", "recent dish should be last but present");
  });
  await test("soft preferences: not-meaty matches milky and pareve", function () {
    const p = { dimension: "kosher", value: "not-meaty" };
    eq([R.matchesPref(D("milky", []), p), R.matchesPref(D("pareve", []), p), R.matchesPref(D("meaty", []), p)], [true, true, false]);
  });
  await test("mergePrefs: newest wins per dimension, occasions stack", function () {
    let p = R.mergePrefs([], [{ dimension: "weight", value: "light" }, { dimension: "occasion", value: "quick" }]);
    p = R.mergePrefs(p, [{ dimension: "weight", value: "heavy" }, { dimension: "occasion", value: "comfort" }]);
    eq(p.map(function (x) { return x.dimension + ":" + x.value; }).sort(), ["occasion:comfort", "occasion:quick", "weight:heavy"]);
  });
  await test("named: finds dishes by name, longest name wins", function () {
    const all = A.Dishes.all();
    eq(R.named("pizza please", all).map(function (d) { return d.id; }), ["pizza"]);
    eq(R.named("steak burgers", all).map(function (d) { return d.id; }), ["steak-burgers"]);
    eq(R.named("fish and chips", all).map(function (d) { return d.id; }), ["fish-and-chips"]);
    eq(R.named("something quick", all), []);
  });

  console.log("dishes and store");
  await test("starter list: toast is made with margarine", function () { ok(/margarine/i.test(A.Dishes.byId("toast").name)); });
  await test("validate: accepts a good dish, rejects one with no name or label", function () {
    ok(A.Dishes.validate(D("pareve", ["lunch"])).ok);
    ok(!A.Dishes.validate(Object.assign(D("pareve", ["lunch"]), { name: "" })).ok);
    const noLabel = D("pareve", ["lunch"]); noLabel.tags.kosher = "";
    ok(!A.Dishes.validate(noLabel).ok);
  });
  await test("save app copy: the dish list is baked into the script and reads back", function () {
    const src = fs.readFileSync(path.join(SRC, "dishes.js"), "utf8");
    const baked = A.Dishes.bake(src);
    ok(baked !== src && /const BAKED_DISHES = \[/.test(baked), "list not baked in");
    ok(/\/\*BAKED_MARKER\*\//.test(baked), "marker lost, a second save would fail");
  });
  await test("recent meals expire after RECENT_HOURS and can be forgotten", function () {
    S.recordEaten("pizza");
    eq(S.recentEaten().map(function (e) { return e.id; }), ["pizza"]);
    eq(S.recentEaten(Date.now() + (A.Config.RECENT_HOURS + 1) * 3600 * 1000), [], "should have expired");
    S.forgetEaten("pizza");
    eq(S.recentEaten(), []);
  });

  console.log("a chat turn (fake Jev and Haiku)");
  await test("opening gives a dish from the list, worded by Haiku", async function () {
    const net = fakeNet({ haiku: "How about Cereal?" });
    const app = loadApp(net);
    const res = await app.Turn.run(app.Turn.newSession(), "", { action: "open", hour: 8 });
    ok(app.Dishes.byId(res.decision.dish.id), "dish not from the list");
    eq(res.reply, "How about Cereal?"); eq(res.usedHaiku, true);
  });
  await test("meaty: Jev is never shown a milky dish", async function () {
    const net = fakeNet(), app = loadApp(net), S2 = app.Turn.newSession();
    S2.meaty = true;
    await app.Turn.run(S2, "", { action: "open", hour: 19 });
    const shown = Object.keys(net.pickRequests[0].questions.pick.criteria);
    ok(shown.length > 0 && shown.every(function (id) { return app.Dishes.byId(id).tags.kosher !== "milky"; }), "milky dish reached Jev");
  });
  await test("a named dish always reaches Jev, marked as asked for", async function () {
    const net = fakeNet({ choose: function () { return "pizza"; } }), app = loadApp(net);
    const res = await app.Turn.run(app.Turn.newSession(), "pizza", { hour: 8 });
    ok(/\[the user asked for this dish\]/.test(net.pickRequests[0].questions.pick.criteria.pizza), "pizza not flagged");
    eq(res.decision.dish.id, "pizza"); eq(res.decision.blocked, null);
  });
  await test("a named milky dish while meaty is blocked, and something allowed is offered", async function () {
    const net = fakeNet(), app = loadApp(net), S2 = app.Turn.newSession();
    S2.meaty = true;
    const res = await app.Turn.run(S2, "pizza", { hour: 19 });
    eq(res.decision.blocked.id, "pizza");
    ok(res.decision.dish.tags.kosher !== "milky", "offered a milky dish");
    ok(!("pizza" in net.pickRequests[0].questions.pick.criteria), "pizza reached Jev");
  });
  await test("'Not this one' never repeats, and the list is offered after 3", async function () {
    const net = fakeNet(), app = loadApp(net), S2 = app.Turn.newSession();
    const seen = [];
    let res = await app.Turn.run(S2, "", { action: "open", hour: 13 });
    seen.push(res.decision.dish.id);
    for (let i = 0; i < 3; i++) {
      res = await app.Turn.run(S2, "", { action: "reject", hour: 13 });
      ok(seen.indexOf(res.decision.dish.id) === -1, "repeated " + res.decision.dish.id);
      seen.push(res.decision.dish.id);
    }
    eq(res.decision.offerList, true); eq(res.decision.rejectedPrevious, true);
  });
  await test("typed words become soft preferences", async function () {
    const net = fakeNet({ reading: { rejects_last: { noul: 0 }, kind: { choice: "none", confidence: 1 }, weight: { choice: "light", confidence: 0.9 }, temperature: { choice: "none", confidence: 1 } } });
    const app = loadApp(net), S2 = app.Turn.newSession();
    await app.Turn.run(S2, "something light", { hour: 13 });
    eq(S2.prefs.map(function (p) { return p.dimension + ":" + p.value; }), ["weight:light"]);
  });
  await test("recent meals are told to Jev but never removed from the choice", async function () {
    const net = fakeNet(), app = loadApp(net);
    app.Store.recordEaten("chips");
    await app.Turn.run(app.Turn.newSession(), "", { action: "open", hour: 13 });
    const req = net.pickRequests[0];
    eq(req.state.recently_eaten, ["Chips"]);
    ok("chips" in req.questions.pick.criteria || Object.keys(req.questions.pick.criteria).length >= 4, "shortlist too small");
  });
  await test("Jev unreachable: the turn comes back offline (list only)", async function () {
    const app = loadApp(fakeNet({ jevFails: true }));
    const res = await app.Turn.run(app.Turn.newSession(), "", { action: "open", hour: 13 });
    eq(res.offline, true);
  });
  await test("Haiku down: Jev still decides and a template words it", async function () {
    const app = loadApp(fakeNet({ haikuFails: true }));
    const res = await app.Turn.run(app.Turn.newSession(), "", { action: "open", hour: 13 });
    eq(res.usedHaiku, false);
    ok(res.reply.indexOf(res.decision.dish.name) !== -1, "template should name the dish");
  });
  await test("replies name only the chosen dish: template, blocked and nothing-left cases", function () {
    const A2 = loadApp(fakeNet()), W = A2.Wording, pizza = A2.Dishes.byId("pizza"), chips = A2.Dishes.byId("chips");
    ok(/How about Chips\?/.test(W.template({ action: "recommend", dish: chips })));
    ok(/^OK\./.test(W.template({ action: "recommend", dish: chips, rejectedPrevious: true })));
    const t = W.template({ action: "recommend", dish: chips, blocked: pizza });
    ok(/Pizza has dairy/.test(t) && /How about Chips/.test(t));
    ok(/meaty/.test(W.template({ action: "nothing" })));
  });

  console.log("\n" + passed + " passed, " + failed + " failed");
  process.exit(failed ? 1 : 0);
}
main();
