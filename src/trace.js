/* ===================================================================
 * TRACE - the debug log behind Debug mode.
 * -------------------------------------------------------------------
 * When Debug mode is on, every chat turn records each step the app
 * took (what it heard, what the rules allowed, what Jev and Haiku were
 * sent and what they sent back, and why it chose what it chose).
 * When it is off, nothing is recorded. API keys are never stored in a
 * trace, and photo data is replaced by a placeholder.
 * =================================================================== */
const Trace = (function () {
  const FLAG = "fc_debug";
  let enabled = false;
  let turns = [];
  let cur = null;
  let seq = 0;
  try { enabled = localStorage.getItem(FLAG) === "1"; } catch (e) { /* ignore */ }

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
    setOn: function (on) {
      enabled = !!on;
      try { localStorage.setItem(FLAG, enabled ? "1" : "0"); } catch (e) { /* ignore */ }
    },
    begin: function (input) {
      if (!enabled) { cur = null; return null; }
      cur = { id: ++seq, at: Date.now(), t0: Date.now(), input: clean(input), steps: [], result: null, totalMs: null };
      turns.unshift(cur);
      if (turns.length > 25) turns.pop();
      return cur.id;
    },
    // status: ok | skip | warn | error | info
    step: function (title, status, detail, data) {
      if (!cur) return;
      cur.steps.push({ n: cur.steps.length + 1, title: title, status: status || "info", detail: detail || "", data: clean(data), ms: Date.now() - cur.t0 });
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
