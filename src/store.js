/* Small memory kept in this browser (localStorage): meals eaten, edited dishes,
 * settings. If storage is blocked, values live in memory for this page load. */
const Store = (function () {
  const KEYS = { eaten: "fc_eaten", dishes: "fc_dishes_v3", devKey: "fc_key", debug: "fc_debug", chips: "fc_chips" };
  const mem = {};

  function read(name, fallback) {
    let raw = null;
    try { raw = localStorage.getItem(KEYS[name]); } catch (e) { /* storage blocked */ }
    if (raw === null && mem[name] !== undefined) raw = mem[name];
    if (raw === null) return fallback;
    try { return JSON.parse(raw); } catch (e) { return fallback; }
  }

  // Returns false if the browser refused (storage full or blocked).
  function write(name, value) {
    const raw = value === null || value === undefined ? null : JSON.stringify(value);
    mem[name] = raw;
    try {
      if (raw === null) localStorage.removeItem(KEYS[name]); else localStorage.setItem(KEYS[name], raw);
      return true;
    } catch (e) { return false; }
  }

  function recentCutoff(now) { return (now || Date.now()) - Config.RECENT_HOURS * 3600 * 1000; }

  return {
    devKey: function () { return read("devKey", ""); },
    setDevKey: function (key) { return write("devKey", key || null); },
    dishes: function () { return read("dishes", null); },
    setDishes: function (list) { return write("dishes", list); },
    flag: function (name) { return read(name, false) === true; },
    setFlag: function (name, on) { return write(name, !!on); },

    recordEaten: function (id) {
      const eaten = read("eaten", []);
      eaten.push({ id: id, ts: Date.now() });
      write("eaten", eaten.slice(-200));
    },
    /* One entry per dish, newest first, only within RECENT_HOURS. */
    recentEaten: function (now) {
      const cutoff = recentCutoff(now);
      const latest = {};
      read("eaten", []).forEach(function (e) { if (e.ts >= cutoff && (!latest[e.id] || e.ts > latest[e.id])) latest[e.id] = e.ts; });
      return Object.keys(latest).map(function (id) { return { id: id, ts: latest[id] }; }).sort(function (a, b) { return b.ts - a.ts; });
    },
    forgetEaten: function (id) { write("eaten", read("eaten", []).filter(function (e) { return e.id !== id; })); },
    clearEaten: function () { write("eaten", null); }
  };
})();
