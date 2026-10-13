/* Debug recorder. When Debug mode is on, each chat turn records the steps the
 * app took. When off, nothing is recorded. Only Turn and Ai write to it and
 * nothing reads it while deciding. Keys and photos are never stored. */
const Debug = (function () {
  let enabled = Store.flag("debug");
  let turns = [];
  let cur = null;
  let seq = 0;

  function clean(data) {
    if (data === undefined) return undefined;
    try {
      return JSON.parse(JSON.stringify(data, function (k, v) {
        if (typeof v === "string" && v.indexOf("data:image") === 0) return "[photo omitted]";
        if (/^authorization$/i.test(k)) return "[hidden]";
        return v;
      }));
    } catch (e) { return String(data); }
  }

  return {
    isOn: function () { return enabled; },
    setOn: function (on) { enabled = !!on; Store.setFlag("debug", enabled); },
    begin: function (input) {
      if (!enabled) { cur = null; return null; }
      cur = { id: ++seq, t0: Date.now(), input: clean(input), steps: [], result: null, totalMs: null };
      turns.unshift(cur);
      if (turns.length > 25) turns.pop();
      return cur.id;
    },
    // status: ok | skip | warn | error | info
    step: function (title, status, detail, data) {
      if (!cur) return;
      cur.steps.push({ title: title, status: status || "info", detail: detail || "", data: clean(data), ms: Date.now() - cur.t0 });
    },
    end: function (result) {
      if (!cur) return;
      cur.totalMs = Date.now() - cur.t0;
      cur.result = clean(result);
      cur = null;
    },
    turns: function () { return turns; },
    clear: function () { turns = []; cur = null; },
    exportJson: function () { return JSON.stringify({ app: "what-should-i-eat", exportedAt: new Date().toISOString(), turns: turns }, null, 2); }
  };
})();
