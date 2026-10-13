/* ===================================================================
 * MEMORY CHIPS - a window onto everything the app is using to decide.
 * -------------------------------------------------------------------
 * Nothing here is a copy: each chip is read straight from the real
 * state (the chat session S, and the remembered history in Store), and
 * removing a chip changes that real state. So a chip that is on screen
 * is genuinely being used, and a chip you remove genuinely stops
 * influencing suggestions.
 *
 * group:  now (context) | chat (this conversation) | remembered (kept across chats)
 * source: typed (you said it) | jev (Jev read it from your message)
 *         | auto (worked out by the app) | mem (remembered from before)
 * =================================================================== */
const SOURCE_HINTS = {
  typed: "You said this",
  jev: "Jev picked this up from your message. Remove it if it's wrong.",
  auto: "Worked out by the app",
  mem: "Remembered from earlier"
};

function prefLabel(p) {
  if (p.dimension === "occasion") return p.value === "comfort" ? "Wants comfort food" : p.value === "fancy" ? "Wants something fancy" : "Wants " + p.value;
  if (p.dimension === "mealType") return "Wants " + p.value;
  return "Wants " + p.value; // weight / temperature
}

function agoText(ts, now) {
  const mins = Math.max(0, Math.round(((now || Date.now()) - ts) / 60000));
  if (mins < 2) return "just now";
  if (mins < 90) return mins + " min ago";
  const h = Math.round(mins / 60);
  return h < 24 ? h + "h ago" : "yesterday";
}

function memoryChips(S, hour, now) {
  const chips = [];
  const clock = typeof hour === "number" ? hour : new Date().getHours();

  // ---- right now
  chips.push(S.ignoreTime
    ? { id: "time", group: "now", label: "Time of day ignored", source: "auto", restore: true, hint: "Click to use the time of day again" }
    : { id: "time", group: "now", label: "It's " + labelForHour(clock), source: "auto", hint: SOURCE_HINTS.auto + ". Remove it to stop favouring dishes for this time of day." });

  // ---- this chat
  if (S.kosher) {
    const k = S.kosher;
    const label = k === "meaty" ? "Does not want milky" : k === "milky" ? "Does not want meaty" : k === "pareve" ? "Wants pareve only" : "Does not want " + k.slice(4);
    const rule = k === "pareve" ? "Hard rule: pareve dishes only. " : k.indexOf("not-") === 0 ? "Hard rule: never shows a " + k.slice(4) + " dish. "
      : "You're " + k + ". Hard rule: never shows a " + (k === "meaty" ? "milky" : "meaty") + " dish; pareve dishes are fine. ";
    chips.push({ id: "kosher", group: "chat", label: label, source: S.kosherSrc || "typed", hard: true, hint: rule + SOURCE_HINTS[S.kosherSrc || "typed"] });
  }
  if (S.skipKind) chips.push({ id: "skip", group: "chat", label: "Does not want " + S.skipKind + " right now", source: "typed", hint: "You said you don't want " + S.skipKind + " right now. Your " + S.kosher + " rule stays. Remove to allow " + S.skipKind + " dishes again." });
  S.prefs.forEach(function (p) {
    chips.push({ id: "pref:" + p.dimension + ":" + p.value, group: "chat", label: prefLabel(p), source: p.src || "typed", hint: SOURCE_HINTS[p.src || "typed"] });
  });

  const rejected = Store.rejectedCounts();
  const eaten = Store.recentEaten(now);
  const eatenIds = eaten.map(function (e) { return e.id; });
  // Everything offered this chat, including dishes you turned down (they are never repeated either).
  const offeredAll = S.suggestedIds.filter(function (id, i, a) { return a.indexOf(id) === i && dishById(id); });
  const offeredOpen = offeredAll.filter(function (id) { return !(id in rejected) && eatenIds.indexOf(id) === -1; });
  if (offeredOpen.length) {
    chips.push({ id: "offered", group: "chat", label: "Not repeating " + offeredAll.length + (offeredAll.length === 1 ? " dish" : " dishes") + " already offered", source: "auto",
      hint: offeredAll.map(nameOf).join(", ") + ". Remove to allow the ones you haven't turned down again." });
  }

  // ---- remembered across chats
  Object.keys(rejected).forEach(function (id) {
    const d = dishById(id);
    if (!d) return;
    const n = rejected[id];
    chips.push({ id: "rej:" + id, group: "chat", label: "Turned down " + d.name + (n > 1 ? " ×" + n : "") + (n >= CONFIG.DISLIKE_AFTER ? " (avoiding)" : ""), source: "typed",
      hint: "You turned this down in this chat" + (n >= CONFIG.DISLIKE_AFTER ? ". It is skipped for the rest of this chat." : ". Counts against it when choosing.") + " Forgotten when you start over." });
  });
  eaten.forEach(function (e) {
    const d = dishById(e.id);
    if (!d) return;
    chips.push({ id: "ate:" + e.id, group: "remembered", label: "Ate " + d.name + " " + agoText(e.ts, now), source: "mem", hint: SOURCE_HINTS.mem + ". Skipped for about a day and a half." });
  });
  return chips;
}

/* Remove (or, for the time chip, toggle) one chip. Returns true if something changed. */
function removeChip(S, id) {
  if (id === "time") { S.ignoreTime = !S.ignoreTime; return true; }
  if (id === "kosher") { S.kosher = null; S.kosherSrc = null; S.skipKind = null; return true; }
  if (id === "skip") { S.skipKind = null; return true; }
  if (id === "offered") {
    const rejected = Store.rejectedCounts();
    const eatenIds = Store.recentEaten().map(function (e) { return e.id; });
    S.suggestedIds = S.suggestedIds.filter(function (x) { return x in rejected || eatenIds.indexOf(x) !== -1; });
    return true;
  }
  if (id.indexOf("pref:") === 0) {
    const parts = id.split(":");
    const before = S.prefs.length;
    S.prefs = S.prefs.filter(function (p) { return !(p.dimension === parts[1] && p.value === parts[2]); });
    return S.prefs.length !== before;
  }
  if (id.indexOf("rej:") === 0) {
    const dishId = id.slice(4);
    Store.forgetRejected(dishId);
    S.suggestedIds = S.suggestedIds.filter(function (x) { return x !== dishId; });
    return true;
  }
  if (id.indexOf("ate:") === 0) {
    Store.forgetEaten(id.slice(4));
    return true;
  }
  return false;
}
