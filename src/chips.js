/* The optional "What I'm using" chips: everything shaping the suggestions,
 * read straight from the real state. Removing a chip changes that state, so a
 * chip on screen is genuinely in use. Hidden unless switched on in Settings. */
const Chips = (function () {
  function prefLabel(p) {
    if (p.dimension === "kosher") return p.value === "not-meaty" ? "Does not want meat" : "Wants " + p.value;
    if (p.dimension === "occasion") return p.value === "comfort" ? "Wants comfort food" : p.value === "fancy" ? "Wants something fancy" : "Wants " + p.value;
    return "Wants " + p.value;
  }

  function agoText(ts, now) {
    const mins = Math.max(0, Math.round(((now || Date.now()) - ts) / 60000));
    if (mins < 2) return "just now";
    if (mins < 90) return mins + " min ago";
    const h = Math.round(mins / 60);
    return h < 24 ? h + "h ago" : "yesterday";
  }

  /* Each chip: { id, label, hard, restore, hint }. */
  function list(S, hour, now) {
    const clock = typeof hour === "number" ? hour : new Date().getHours();
    const chips = [S.ignoreTime
      ? { id: "time", label: "Time of day ignored", restore: true, hint: "Click to use the time of day again" }
      : { id: "time", label: "It's " + Rules.labelForHour(clock), hint: "Remove it to stop favouring dishes for this time of day." }];
    if (S.meaty) chips.push({ id: "meaty", label: "Meaty: no milky dishes", hard: true, hint: "The only hard rule. Remove it once you can have dairy again." });
    S.prefs.forEach(function (p) { chips.push({ id: "pref:" + p.dimension + ":" + p.value, label: prefLabel(p), hint: p.src === "jev" ? "Picked up from your message. Remove it if it's wrong." : "You said this" }); });
    const offered = S.offeredIds.filter(function (id) { return Dishes.byId(id); });
    if (offered.some(function (id) { return S.rejectedIds.indexOf(id) === -1; })) {
      chips.push({ id: "offered", label: "Not repeating " + offered.length + (offered.length === 1 ? " dish" : " dishes") + " already offered", hint: offered.map(Dishes.nameOf).join(", ") + ". Remove to allow the ones you haven't turned down again." });
    }
    S.rejectedIds.forEach(function (id) {
      if (Dishes.byId(id)) chips.push({ id: "rej:" + id, label: "Turned down " + Dishes.nameOf(id), hint: "Not offered again this chat. Remove to allow it again." });
    });
    Store.recentEaten(now).forEach(function (e) {
      if (Dishes.byId(e.id)) chips.push({ id: "ate:" + e.id, label: "Ate " + Dishes.nameOf(e.id) + " " + agoText(e.ts, now), hint: "Remembered meals rank a little lower for about a day and a half." });
    });
    return chips;
  }

  /* Removes (or, for the time chip, toggles) one chip. Returns true if something changed. */
  function remove(S, id) {
    if (id === "time") { S.ignoreTime = !S.ignoreTime; return true; }
    if (id === "meaty") { S.meaty = false; return true; }
    if (id === "offered") { S.offeredIds = S.offeredIds.filter(function (x) { return S.rejectedIds.indexOf(x) !== -1; }); return true; } // turned-down dishes stay excluded
    if (id.indexOf("rej:") === 0) {
      const dishId = id.slice(4);
      S.rejectedIds = S.rejectedIds.filter(function (x) { return x !== dishId; });
      S.offeredIds = S.offeredIds.filter(function (x) { return x !== dishId; });
      return true;
    }
    if (id.indexOf("pref:") === 0) {
      const parts = id.split(":");
      const before = S.prefs.length;
      S.prefs = S.prefs.filter(function (p) { return !(p.dimension === parts[1] && p.value === parts[2]); });
      return S.prefs.length !== before;
    }
    if (id.indexOf("ate:") === 0) { Store.forgetEaten(id.slice(4)); return true; }
    return false;
  }

  return { list: list, remove: remove };
})();
